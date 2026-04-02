import type { Response, NextFunction } from 'express';
import type { AuthRequest } from './auth.middleware.js';
import type { Role } from '@ofauria/shared';

export function authorize(...roles: Role[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ success: false, error: { message: 'Non authentifié' } });
      return;
    }

    if (!roles.includes(req.user.role as Role)) {
      res.status(403).json({ success: false, error: { message: 'Accès interdit' } });
      return;
    }

    next();
  };
}
