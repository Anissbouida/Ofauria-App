import type { Response, NextFunction } from 'express';
import type { AuthRequest } from './auth.middleware.js';

export interface TenantRequest extends AuthRequest {
  effectiveStoreId?: string;
}

/**
 * Force un contexte store explicite.
 * - Utilisateur avec storeId : req.effectiveStoreId = user.storeId (filtrage automatique).
 * - Utilisateur admin sans storeId : req.effectiveStoreId = undefined (acces global explicite).
 * - Tout autre cas (non-admin sans storeId) : 403, pas d'acces global implicite.
 */
export function requireStoreContext(req: TenantRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ success: false, error: { message: 'Non authentifie' } });
    return;
  }

  if (req.user.storeId) {
    req.effectiveStoreId = req.user.storeId;
    next();
    return;
  }

  if (req.user.role === 'admin') {
    req.effectiveStoreId = undefined; // admin global
    next();
    return;
  }

  res.status(403).json({
    success: false,
    error: { message: 'Utilisateur non rattache a un magasin' },
  });
}

/**
 * Helper pour verifier qu'une ressource appartient au store de l'utilisateur.
 * - admin global (userStoreId undefined) -> true
 * - sinon, verifie egalite stricte
 */
export function checkStoreOwnership(resourceStoreId: string | null, userStoreId?: string): boolean {
  if (!userStoreId) return true; // admin global
  return resourceStoreId === userStoreId;
}
