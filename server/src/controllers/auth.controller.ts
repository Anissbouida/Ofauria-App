import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { env } from '../config/env.js';
import { userRepository } from '../repositories/user.repository.js';
import { revokedTokenRepository } from '../repositories/revoked-token.repository.js';
import { loginRoleContext } from '../services/access-rights.js';
import { authEventRepository } from '../repositories/auth-event.repository.js';
import { hashPassword, comparePassword, comparePin } from '../utils/hash.js';
import { meetsPasswordPolicy } from '../validators/auth.validator.js';
import { generateToken } from '../utils/jwt.js';

// OWASP A07-4 : hash bcrypt factice (reel, parsable) utilise pour uniformiser
// le temps de reponse entre un email inexistant et un password incorrect.
// Le hash vient d'un password placeholder inutilisable. bcrypt.compare rejette
// toute entree contre ce hash en ~200-400ms (cost 12), identique au cas nominal.
const DUMMY_HASH = '$2b$12$UxU1Tp4KJsAmO.WHvNvvveuwXdUvUlXrtWSW61B3P/ZS4ArHjAgt6';

// OWASP A04-2 : politique de lockout.
// Apres LOGIN_FAIL_THRESHOLD echecs consecutifs, le compte est
// verrouille pour LOGIN_LOCK_DURATION_MS.
const LOGIN_FAIL_THRESHOLD = 5;
const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

function lockoutErrorMessage(lockedUntil: Date): string {
  const secs = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 1000));
  const mins = Math.ceil(secs / 60);
  return `Compte temporairement verrouille (reessayez dans ~${mins} min)`;
}

// OWASP A02-5 : cookie d'auth HttpOnly, non accessible via JS (XSS-proof).
// SameSite=Strict bloque la majorite des CSRF. Secure impose HTTPS en prod.
const AUTH_COOKIE_NAME = 'ofauria_auth';
const IS_PROD = env.NODE_ENV === 'production';

// Convertit '8h' / '7d' / '15m' en millisecondes pour le cookie maxAge.
function parseDurationMs(v: string): number {
  const match = /^(\d+)([smhd])$/.exec(v.trim());
  if (!match) return 8 * 60 * 60 * 1000; // defaut 8h
  const n = parseInt(match[1], 10);
  switch (match[2]) {
    case 's': return n * 1000;
    case 'm': return n * 60 * 1000;
    case 'h': return n * 60 * 60 * 1000;
    case 'd': return n * 24 * 60 * 60 * 1000;
    default: return 8 * 60 * 60 * 1000;
  }
}

function setAuthCookie(res: Response, token: string) {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: IS_PROD, // HTTPS only en prod ; en dev HTTP accepte le cookie
    sameSite: 'strict',
    path: '/',
    maxAge: parseDurationMs(env.JWT_EXPIRES_IN),
  });
}

function clearAuthCookie(res: Response) {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'strict',
    path: '/',
  });
}

export const authController = {
  async login(req: AuthRequest, res: Response) {
    const { email, password } = req.body;

    const user = await userRepository.findByEmail(email);
    if (!user || !user.is_active) {
      // OWASP A07-4 : execute un compare factice pour uniformiser le timing
      // et empecher l'enumeration d'emails existants via analyse de latence.
      await comparePassword(password, DUMMY_HASH);
      await authEventRepository.recordFromRequest(req, {
        eventType: 'login_failed',
        email: String(email || '').slice(0, 255),
        success: false,
        details: { reason: 'unknown_or_inactive' },
      });
      res.status(401).json({ success: false, error: { message: 'Email ou mot de passe incorrect' } });
      return;
    }

    // Refus si compte verrouille (A04-2).
    const lockedUntil = await userRepository.isLocked(user.id);
    if (lockedUntil) {
      await authEventRepository.recordFromRequest(req, {
        eventType: 'login_failed',
        userId: user.id, email: user.email, success: false,
        details: { reason: 'locked', until: lockedUntil.toISOString() },
      });
      res.status(423).json({ success: false, error: { message: lockoutErrorMessage(lockedUntil) } });
      return;
    }

    const valid = await comparePassword(password, user.password_hash);
    if (!valid) {
      const { count, lockedUntil: newLock } = await userRepository.recordFailedLogin(
        user.id, LOGIN_FAIL_THRESHOLD, LOGIN_LOCK_DURATION_MS
      );
      await authEventRepository.recordFromRequest(req, {
        eventType: 'login_failed',
        userId: user.id, email: user.email, success: false,
        details: { reason: 'bad_password', failedCount: count },
      });
      if (newLock && newLock > new Date()) {
        await authEventRepository.recordFromRequest(req, {
          eventType: 'account_locked',
          userId: user.id, email: user.email, success: false,
          details: { until: newLock.toISOString(), threshold: LOGIN_FAIL_THRESHOLD },
        });
        res.status(423).json({ success: false, error: { message: lockoutErrorMessage(newLock) } });
        return;
      }
      const remaining = Math.max(0, LOGIN_FAIL_THRESHOLD - count);
      res.status(401).json({
        success: false,
        error: { message: `Email ou mot de passe incorrect (${remaining} tentative(s) restante(s))` },
      });
      return;
    }

    // Reset compteur sur login reussi.
    await userRepository.resetFailedLogins(user.id);
    // G0-06 : un mot de passe antérieur à la politique (trop court, sans
    // majuscule…) laisse entrer, mais impose son changement avant toute autre action.
    const mustChange = !!user.must_change_password || !meetsPasswordPolicy(password);
    if (mustChange) await userRepository.setMustChangePassword(user.id, true);
    await authEventRepository.recordFromRequest(req, {
      eventType: 'login_success',
      userId: user.id, email: user.email, success: true,
      ...(mustChange ? { details: { mustChangePassword: true } } : {}),
    });

    // Le jeton porte le role de BASE (perimetre technique des routes) ; un role cree
    // dans Utilisateurs > Roles garde ses propres droits par module (mig 330).
    const roleCtx = await loginRoleContext(user.id);
    const token = generateToken({ userId: user.id, role: roleCtx.primaryBaseRole, baseRoles: roleCtx.baseRoles, storeId: user.store_id || undefined, tokenVersion: user.token_version ?? 0 });
    setAuthCookie(res, token);
    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: roleCtx.primaryBaseRole,
          roleCode: roleCtx.roleCode,
          roleLabel: roleCtx.roleLabel,
          roles: roleCtx.roles,
          isActive: user.is_active,
          storeId: user.store_id || null,
          mustChangePassword: mustChange,
        },
      },
    });
  },

  /**
   * G0-06 : changement de son propre mot de passe (obligatoire quand le compte
   * porte must_change_password). Invalide les autres sessions du compte.
   */
  async changePassword(req: AuthRequest, res: Response) {
    const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
    const user = await userRepository.findById(req.user!.userId);
    if (!user || !user.is_active) {
      res.status(404).json({ success: false, error: { message: 'Utilisateur non trouvé' } });
      return;
    }
    if (!(await comparePassword(currentPassword, user.password_hash))) {
      await authEventRepository.recordFromRequest(req, {
        eventType: 'login_failed', userId: user.id, email: user.email, success: false,
        details: { reason: 'password_change_bad_current' },
      });
      res.status(400).json({ success: false, error: { message: 'Mot de passe actuel incorrect' } });
      return;
    }
    if (currentPassword === newPassword) {
      res.status(400).json({ success: false, error: { message: 'Le nouveau mot de passe doit être différent de l\'actuel' } });
      return;
    }
    await userRepository.update(user.id, { passwordHash: await hashPassword(newPassword), mustChangePassword: false }, user.id);
    // Les jetons déjà émis deviennent invalides ; on en réémet un pour cette session.
    const tokenVersion = await userRepository.bumpTokenVersion(user.id);
    await authEventRepository.recordFromRequest(req, {
      eventType: 'user_updated', userId: user.id, targetUserId: user.id, email: user.email, success: true,
      details: { changed: ['passwordHash'], self: true },
    });
    const roleCtx = await loginRoleContext(user.id);
    const token = generateToken({ userId: user.id, role: roleCtx.primaryBaseRole, baseRoles: roleCtx.baseRoles, storeId: user.store_id || undefined, tokenVersion });
    setAuthCookie(res, token);
    res.json({ success: true, data: { token, mustChangePassword: false } });
  },

  /** G0-06 : tuiles de l'écran de connexion par PIN (prénom + initiale du nom). */
  async pinUsers(_req: AuthRequest, res: Response) {
    const users = await userRepository.findPinUsers();
    res.json({
      success: true,
      data: users.map(u => ({ id: u.id, firstName: u.first_name, lastInitial: u.last_initial })),
    });
  },

  async register(req: AuthRequest, res: Response) {
    const { email, password, firstName, lastName, role } = req.body;

    const existing = await userRepository.findByEmail(email);
    if (existing) {
      res.status(409).json({ success: false, error: { message: 'Cet email est déjà utilisé' } });
      return;
    }

    const passwordHash = await hashPassword(password);
    const user = await userRepository.create({ email, passwordHash, firstName, lastName, role }, req.user?.userId);

    res.status(201).json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        isActive: user.is_active,
      },
    });
  },

  async pinLogin(req: AuthRequest, res: Response) {
    // G0-06 : le compte est désigné par la tuile choisie ; UNE seule comparaison
    // de hachage, puis le verrouillage du compte comme pour le mot de passe.
    const { userId, pinCode } = req.body as { userId: string; pinCode: string };

    const user = await userRepository.findById(userId);
    if (!user || !user.is_active || !user.pin_code) {
      // Comparaison factice : même durée qu'un compte réel (pas d'énumération).
      await comparePin(pinCode, DUMMY_HASH);
      await authEventRepository.recordFromRequest(req, {
        eventType: 'pin_login_failed', success: false, details: { reason: 'unknown_or_no_pin' },
      });
      res.status(401).json({ success: false, error: { message: 'Code PIN incorrect' } });
      return;
    }

    // Refus si compte verrouille (A04-2) — avant toute comparaison.
    const lockedUntil = await userRepository.isLocked(user.id);
    if (lockedUntil) {
      await authEventRepository.recordFromRequest(req, {
        eventType: 'pin_login_failed', userId: user.id, email: user.email, success: false,
        details: { reason: 'locked', until: lockedUntil.toISOString() },
      });
      res.status(423).json({ success: false, error: { message: lockoutErrorMessage(lockedUntil) } });
      return;
    }

    const valid = await comparePin(pinCode, user.pin_code);
    if (!valid) {
      const { count, lockedUntil: newLock } = await userRepository.recordFailedLogin(
        user.id, LOGIN_FAIL_THRESHOLD, LOGIN_LOCK_DURATION_MS
      );
      await authEventRepository.recordFromRequest(req, {
        eventType: 'pin_login_failed', userId: user.id, email: user.email, success: false,
        details: { reason: 'bad_pin', failedCount: count },
      });
      if (newLock && newLock > new Date()) {
        await authEventRepository.recordFromRequest(req, {
          eventType: 'account_locked', userId: user.id, email: user.email, success: false,
          details: { until: newLock.toISOString(), threshold: LOGIN_FAIL_THRESHOLD, via: 'pin' },
        });
        res.status(423).json({ success: false, error: { message: lockoutErrorMessage(newLock) } });
        return;
      }
      const remaining = Math.max(0, LOGIN_FAIL_THRESHOLD - count);
      res.status(401).json({ success: false, error: { message: `Code PIN incorrect (${remaining} tentative(s) restante(s))` } });
      return;
    }

    // Reset sur login PIN reussi ; on apprend la longueur d'un PIN antérieur.
    await userRepository.resetFailedLogins(user.id);
    await userRepository.learnPinLength(user.id, pinCode.length);
    await authEventRepository.recordFromRequest(req, {
      eventType: 'pin_login_success', userId: user.id, email: user.email, success: true,
    });

    // Le jeton porte le role de BASE (perimetre technique des routes) ; un role cree
    // dans Utilisateurs > Roles garde ses propres droits par module (mig 330).
    const roleCtx = await loginRoleContext(user.id);
    const token = generateToken({ userId: user.id, role: roleCtx.primaryBaseRole, baseRoles: roleCtx.baseRoles, storeId: user.store_id || undefined, tokenVersion: user.token_version ?? 0 });
    setAuthCookie(res, token);
    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: roleCtx.primaryBaseRole,
          roleCode: roleCtx.roleCode,
          roleLabel: roleCtx.roleLabel,
          roles: roleCtx.roles,
          isActive: user.is_active,
          storeId: user.store_id || null,
        },
      },
    });
  },

  async activeUsers(_req: AuthRequest, res: Response) {
    const users = await userRepository.findAllActive();
    res.json({
      success: true,
      data: users.map(u => ({
        id: u.id,
        firstName: u.first_name,
        lastName: u.last_name,
        role: u.role,
      })),
    });
  },

  async logout(req: AuthRequest, res: Response) {
    // OWASP A07-3 : invalide le token cote serveur via blacklist jti.
    const jti = req.user?.jti;
    const userId = req.user?.userId;
    const exp = req.user?.exp;
    if (jti && userId && exp) {
      await revokedTokenRepository.revoke(jti, userId, exp);
    }
    if (userId) {
      await authEventRepository.recordFromRequest(req, {
        eventType: 'logout', userId, success: true, details: { jti },
      });
    }
    // A02-5 : efface le cookie HttpOnly.
    clearAuthCookie(res);
    res.json({ success: true });
  },

  async me(req: AuthRequest, res: Response) {
    const user = await userRepository.findById(req.user!.userId);
    if (!user) {
      res.status(404).json({ success: false, error: { message: 'Utilisateur non trouvé' } });
      return;
    }

    const roleCtx = await loginRoleContext(user.id);
    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: roleCtx.primaryBaseRole,
        roleCode: roleCtx.roleCode,
        roleLabel: roleCtx.roleLabel,
        roles: roleCtx.roles,
        isActive: user.is_active,
        storeId: user.store_id || null,
        mustChangePassword: !!user.must_change_password,
      },
    });
  },
};
