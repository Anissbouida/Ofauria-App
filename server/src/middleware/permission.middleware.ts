import type { Response, NextFunction } from 'express';
import type { PermissionKey } from '@ofauria/shared';
import type { AuthRequest } from './auth.middleware.js';
import { hasPermission } from '../services/permissions.js';

/**
 * Garde par permission (M2-04) : remplace authorize(...groupes de rôles).
 * La décision vient de role_action_permissions / user_action_permissions
 * (services/permissions.ts) et se règle depuis l'écran des rôles.
 * Étiquetée pour l'inventaire des droits par route (utils/route-rights.ts).
 */
export function can(key: PermissionKey) {
  const guard = async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ success: false, error: { message: 'Non authentifié' } });
      return;
    }
    try {
      if (!(await hasPermission(req.user, key))) {
        res.status(403).json({ success: false, error: { message: 'Accès interdit', permission: key } });
        return;
      }
    } catch (err) {
      next(err);
      return;
    }
    next();
  };
  return Object.assign(guard, { permissionKey: key as string });
}
