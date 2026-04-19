import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { userRepository } from '../repositories/user.repository.js';
import { hashPassword, comparePassword } from '../utils/hash.js';
import { generateToken } from '../utils/jwt.js';

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

export const authController = {
  async login(req: AuthRequest, res: Response) {
    const { email, password } = req.body;

    const user = await userRepository.findByEmail(email);
    if (!user || !user.is_active) {
      res.status(401).json({ success: false, error: { message: 'Email ou mot de passe incorrect' } });
      return;
    }

    // Refus si compte verrouille (A04-2).
    const lockedUntil = await userRepository.isLocked(user.id);
    if (lockedUntil) {
      res.status(423).json({ success: false, error: { message: lockoutErrorMessage(lockedUntil) } });
      return;
    }

    const valid = await comparePassword(password, user.password_hash);
    if (!valid) {
      const { count, lockedUntil: newLock } = await userRepository.recordFailedLogin(
        user.id, LOGIN_FAIL_THRESHOLD, LOGIN_LOCK_DURATION_MS
      );
      if (newLock && newLock > new Date()) {
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

    const token = generateToken({ userId: user.id, role: user.role, storeId: user.store_id || undefined });
    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role,
          isActive: user.is_active,
          storeId: user.store_id || null,
        },
      },
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
    const user = await userRepository.create({ email, passwordHash, firstName, lastName, role });

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
    const { pinCode } = req.body;
    if (!pinCode) {
      res.status(400).json({ success: false, error: { message: 'Code PIN requis' } });
      return;
    }

    const user = await userRepository.findByPinCode(pinCode);
    if (!user || !user.is_active) {
      // Pas d'utilisateur a verrouiller (le PIN ne matche aucun user), on retourne 401 generique.
      res.status(401).json({ success: false, error: { message: 'Code PIN incorrect' } });
      return;
    }

    // Refus si compte verrouille (A04-2).
    const lockedUntil = await userRepository.isLocked(user.id);
    if (lockedUntil) {
      res.status(423).json({ success: false, error: { message: lockoutErrorMessage(lockedUntil) } });
      return;
    }

    // Reset sur login PIN reussi.
    await userRepository.resetFailedLogins(user.id);

    const token = generateToken({ userId: user.id, role: user.role, storeId: user.store_id || undefined });
    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role,
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

  async me(req: AuthRequest, res: Response) {
    const user = await userRepository.findById(req.user!.userId);
    if (!user) {
      res.status(404).json({ success: false, error: { message: 'Utilisateur non trouvé' } });
      return;
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        isActive: user.is_active,
        storeId: user.store_id || null,
      },
    });
  },
};
