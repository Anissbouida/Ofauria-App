import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt.js';
import { revokedTokenRepository } from '../repositories/revoked-token.repository.js';
import { userRepository } from '../repositories/user.repository.js';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    role: string;
    /** Tous les rôles de base de l'utilisateur (mig 335), pour authorize. */
    baseRoles?: string[];
    storeId?: string;
    jti?: string;
    exp?: number;
    tokenVersion?: number;
  };
}

// OWASP A02-5 : nom du cookie d'auth (doit matcher auth.controller).
const AUTH_COOKIE_NAME = 'ofauria_auth';

function extractToken(req: AuthRequest): string | null {
  // Priorite au cookie HttpOnly (web/prod). Fallback Bearer header pour
  // clients legacy (mobile Capacitor existant, tests curl, integrations).
  const cookies = (req as AuthRequest & { cookies?: Record<string, string> }).cookies;
  if (cookies?.[AUTH_COOKIE_NAME]) {
    return cookies[AUTH_COOKIE_NAME];
  }
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice(7);
  }
  return null;
}

/**
 * Utilisateur porte par le jeton de la requete, ou null si absent, invalide,
 * revoque ou obsolete. Partage par authenticate et la garde des modules
 * (module-guard.middleware.ts), qui s'execute avant l'authentification des routes.
 */
export async function resolveRequestUser(req: AuthRequest): Promise<{ user: NonNullable<AuthRequest['user']> } | { error: string }> {
  const token = extractToken(req);
  if (!token) return { error: 'Token manquant' };
  try {
    const payload = verifyToken(token);

    // OWASP A07-2 : refuse les tokens revoques (blacklist).
    if (payload.jti && await revokedTokenRepository.isRevoked(payload.jti)) {
      return { error: 'Token revoque' };
    }

    // OWASP A07-5 : refuse les tokens dont la version est obsolete
    // (changement de role, storeId, desactivation compte).
    // Tokens legacy sans tokenVersion claim continuent de fonctionner
    // jusqu'a leur expiration naturelle (transition douce).
    if (typeof payload.tokenVersion === 'number') {
      const currentVersion = await userRepository.getTokenVersion(payload.userId);
      if (currentVersion === null) return { error: 'Utilisateur introuvable' };
      if (payload.tokenVersion !== currentVersion) return { error: 'Token obsolete (privileges modifies)' };
    }

    return {
      user: {
        userId: payload.userId,
        role: payload.role,
        baseRoles: payload.baseRoles && payload.baseRoles.length ? payload.baseRoles : [payload.role],
        storeId: payload.storeId,
        jti: payload.jti,
        exp: payload.exp,
        tokenVersion: payload.tokenVersion,
      },
    };
  } catch {
    return { error: 'Token invalide ou expire' };
  }
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  // Deja authentifie par la garde des modules en amont : pas de second controle.
  if (req.user) { next(); return; }
  const r = await resolveRequestUser(req);
  if ('error' in r) {
    res.status(401).json({ success: false, error: { message: r.error } });
    return;
  }
  req.user = r.user;
  next();
}
