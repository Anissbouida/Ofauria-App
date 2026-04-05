import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt.js';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    role: string;
    storeId?: string;
  };
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: { message: 'Token manquant' } });
    return;
  }

  try {
    const token = header.slice(7);
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ success: false, error: { message: 'Token invalide ou expiré' } });
  }
}
