import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { SETTINGS_SECTIONS, type SettingsSection } from '@ofauria/shared';
import { settingsAccess } from '../middleware/settings-access.middleware.js';
import { setupStatus } from '../services/setup-status.js';
import { effectiveRights, hasRight, moduleKeys } from '../services/access-rights.js';
import { auditLogRepository } from '../repositories/audit-log.repository.js';

/**
 * GET /settings/setup : accueil de la configuration (refonte lot B). Chaque
 * point n'est renvoyé que si l'utilisateur voit la section qui le règle ; les
 * comptes utilisateurs relèvent du droit « Utilisateurs ».
 */
export const setupController = {
  async status(req: AuthRequest, res: Response) {
    const user = req.user!;
    const access = await settingsAccess(user);
    if (!(Object.keys(SETTINGS_SECTIONS) as SettingsSection[]).some(s => access.canView(s))) {
      res.status(403).json({ success: false, error: { message: 'Accès interdit' } });
      return;
    }
    const seesUsers = user.role === 'admin' || hasRight(await effectiveRights(user.userId), moduleKeys('users'), 'view');
    const checks = (await setupStatus()).filter(c => (c.section ? access.canView(c.section) : seesUsers));
    const recent = access.canView('audit')
      ? (await auditLogRepository.list({ limit: 6, offset: 0 })).rows.map(r => ({
        id: r.id, table_name: r.table_name, operation: r.operation, record_label: r.record_label,
        changed_at: r.changed_at, changed_by_name: r.changed_by_name,
      }))
      : null;
    res.json({ success: true, data: { checks, recent } });
  },
};
