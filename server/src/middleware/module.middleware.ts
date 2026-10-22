import type { Response, NextFunction } from 'express';
import type { AuthRequest } from './auth.middleware.js';
import type { AppModule } from '@ofauria/shared';
import { effectiveRights, hasRight } from '../services/access-rights.js';

export type ModuleAction = 'view' | 'create' | 'edit' | 'delete';

/**
 * Autorise l'acces selon les droits par module (meme regle que PermissionsContext
 * cote client) :
 *   - admin : tout ;
 *   - droits personnalises (user_permissions) : can_view/create/edit/delete ;
 *   - sinon droits du role (role_permissions, mig 330), editables dans
 *     Utilisateurs > Roles.
 * Remplace les listes de roles codees en dur : donner le module « Personnel »
 * a un role suffit, sans toucher au code.
 */
export function authorizeModule(module: AppModule, action: ModuleAction = 'view') {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ success: false, error: { message: 'Non authentifié' } });
      return;
    }
    if (req.user.role === 'admin') { next(); return; }

    try {
      const rights = await effectiveRights(req.user.userId);
      if (!hasRight(rights, [module], action)) {
        res.status(403).json({ success: false, error: { message: 'Accès interdit' } });
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
