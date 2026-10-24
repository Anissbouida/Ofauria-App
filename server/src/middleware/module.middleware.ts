import type { Response, NextFunction } from 'express';
import type { AuthRequest } from './auth.middleware.js';
import type { AppModule } from '@ofauria/shared';
import { effectiveRights, enforcementMode } from '../services/access-rights.js';
import { hasRight, hasVerb } from '../services/access-rules.js';
import { authEventRepository } from '../repositories/auth-event.repository.js';

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

/**
 * Exige un VERBE MÉTIER (approuver, valider, comptabiliser, clôturer…) sur un
 * module, en plus de la garde CRUD. Suit le mode de contrôle des droits
 * (company_settings.security_module_enforcement) :
 *   - 'off'     : passe ;
 *   - 'log'     : journalise l'action hors droit (Journal › Connexions) sans bloquer ;
 *   - 'enforce' : répond 403.
 * L'administrateur est court-circuité. Les droits par rôle (verbes) se règlent
 * dans Utilisateurs › Rôles.
 */
export function requireVerb(module: AppModule, verb: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ success: false, error: { message: 'Non authentifié' } });
      return;
    }
    if (req.user.role === 'admin') { next(); return; }
    try {
      const mode = await enforcementMode();
      if (mode === 'off') { next(); return; }
      const rights = await effectiveRights(req.user.userId);
      if (hasVerb(rights, [module], verb)) { next(); return; }
      await authEventRepository.recordFromRequest(req, {
        eventType: 'access_denied', userId: req.user.userId, success: false,
        details: { kind: 'verb', module, verb, role: rights.roleCode, mode },
      });
      if (mode === 'enforce') {
        res.status(403).json({ success: false, error: { message: `Action « ${verb} » non autorisée sur ce module` } });
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
