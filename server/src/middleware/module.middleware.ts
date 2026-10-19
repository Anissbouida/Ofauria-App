import type { Response, NextFunction } from 'express';
import type { AuthRequest } from './auth.middleware.js';
import * as shared from '@ofauria/shared';
import { DEFAULT_ROLE_MODULES, type AppModule } from '@ofauria/shared';
import { permissionRepository } from '../repositories/permission.repository.js';

export type ModuleAction = 'view' | 'create' | 'edit' | 'delete';

/**
 * Autorise l'acces selon les droits par module (meme regle que PermissionsContext
 * cote client) :
 *   - admin : tout ;
 *   - droits personnalises (user_permissions) : can_view/create/edit/delete ;
 *   - sinon DEFAULT_ROLE_MODULES : view/create/edit si le role a le module,
 *     delete jamais (reserve aux droits explicites ou a l'admin).
 * Remplace les listes de roles codees en dur : donner le module « Personnel »
 * a un role suffit, sans toucher au code.
 */
// Cles historiques d'un module (fusion Stock, cf. PermissionsContext). Lu par
// espace de noms : MODULE_ALIASES n'existe pas dans toutes les versions de shared.
const MODULE_ALIASES: Partial<Record<string, string[]>> =
  (shared as unknown as { MODULE_ALIASES?: Partial<Record<string, string[]>> }).MODULE_ALIASES ?? {};

export function authorizeModule(module: AppModule, action: ModuleAction = 'view') {
  const keys: string[] = [module, ...(MODULE_ALIASES[module] ?? [])];
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ success: false, error: { message: 'Non authentifié' } });
      return;
    }
    if (req.user.role === 'admin') { next(); return; }

    try {
      const perms = await permissionRepository.findByUserId(req.user.userId);
      let allowed: boolean;
      if (perms.length > 0) {
        const p = perms.find(x => keys.includes(x.module));
        allowed = !!p && (
          action === 'view' ? p.can_view
          : action === 'create' ? p.can_create
          : action === 'edit' ? p.can_edit
          : p.can_delete
        );
      } else {
        const defaults = DEFAULT_ROLE_MODULES[req.user.role] || [];
        allowed = action !== 'delete' && keys.some(k => (defaults as string[]).includes(k));
      }
      if (!allowed) {
        res.status(403).json({ success: false, error: { message: 'Accès interdit' } });
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
