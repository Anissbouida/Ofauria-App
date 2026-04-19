import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt.js';
import { revokedTokenRepository } from '../repositories/revoked-token.repository.js';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    role: string;
    storeId?: string;
    jti?: string;
    exp?: number;
  };
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: { message: 'Token manquant' } });
    return;
  }

  try {
    const token = header.slice(7);
    const payload = verifyToken(token);

    // OWASP A07-2 : refuse les tokens revoques (blacklist).
    if (payload.jti && await revokedTokenRepository.isRevoked(payload.jti)) {
      res.status(401).json({ success: false, error: { message: 'Token revoque' } });
      return;
    }

    req.user = {
      userId: payload.userId,
      role: payload.role,
      storeId: payload.storeId,
      jti: payload.jti,
      exp: payload.exp,
    };
    next();
  } catch {
    res.status(401).json({ success: false, error: { message: 'Token invalide ou expire' } });
  }
}
