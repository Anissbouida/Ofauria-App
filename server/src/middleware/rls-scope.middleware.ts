import type { Response, NextFunction } from 'express';
import { resolveRequestUser, type AuthRequest } from './auth.middleware.js';
import { runWithStoreScope } from '../config/database.js';
import { effectiveScopeFor } from '../services/access-rights.js';
import { FLAGS } from '../config/feature-flags.js';

/**
 * Périmètre magasin déclaré à Postgres (RLS, mig 436) pour les routes d'un
 * module : un utilisateur dont la portée sur le module est « store » voit ses
 * requêtes filtrées par la base elle-même, en plus des WHERE du code. Admin,
 * portée « tous » ou drapeau RLS_STORE_SCOPE éteint : rien ne change.
 * L'authentification reste le rôle de authenticate (route par route).
 */
export function rlsStoreScope(module: string) {
  return async (req: AuthRequest, _res: Response, next: NextFunction): Promise<void> => {
    if (!FLAGS.RLS_STORE_SCOPE) { next(); return; }
    const resolved = req.user ? { user: req.user } : await resolveRequestUser(req);
    if (!('user' in resolved) || resolved.user.role === 'admin' || !resolved.user.storeId) { next(); return; }
    const scope = await effectiveScopeFor(resolved.user.userId, module).catch(() => 'store' as const);
    if (scope !== 'store') { next(); return; }
    runWithStoreScope(resolved.user.storeId, () => next());
  };
}
