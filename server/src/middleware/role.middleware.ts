import type { Response, NextFunction } from 'express';
import type { AuthRequest } from './auth.middleware.js';
import type { Role } from '@ofauria/shared';

export function authorize(...roles: Role[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ success: false, error: { message: 'Non authentifié' } });
      return;
    }

    // Rôles multiples (mig 335) : accès accordé si l'un des rôles de base de
    // l'utilisateur figure dans la liste autorisée. Repli sur le rôle principal
    // pour les anciens jetons sans baseRoles.
    const have = req.user.baseRoles && req.user.baseRoles.length ? req.user.baseRoles : [req.user.role];
    if (!have.some(r => roles.includes(r as Role))) {
      res.status(403).json({ success: false, error: { message: 'Accès interdit' } });
      return;
    }

    next();
  };
}
