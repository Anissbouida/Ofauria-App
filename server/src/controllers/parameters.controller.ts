import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { settingsAccess } from '../middleware/settings-access.middleware.js';
import { DOMAIN_LABELS, PARAMETERS, parameterByKey, validateParameter } from '../services/parameters-catalog.js';
import { history, readAll, write } from '../services/settings-center.js';

/** Paramètres métier (Paramètres › Paramètres métier, lot 4). */
export const parametersController = {
  async list(req: AuthRequest, res: Response) {
    const access = await settingsAccess(req.user!);
    const values = await readAll();
    const visible = PARAMETERS.filter(p => access.canView(p.section));
    const data = await Promise.all(visible.map(async p => ({
      key: p.key,
      domain: p.domain,
      domainLabel: DOMAIN_LABELS[p.domain],
      label: p.label,
      help: p.help,
      fields: p.fields,
      defaults: p.defaults,
      value: values.get(p.key) ?? null,
      // Stockage absent de cette base (migration non appliquée) : affiché grisé.
      available: values.get(p.key) !== null,
      editable: access.canEdit(p.section),
      history: await history(p),
    })));
    res.json({ success: true, data });
  },

  async update(req: AuthRequest, res: Response) {
    const def = parameterByKey(req.params.key);
    if (!def) { res.status(404).json({ success: false, error: { message: 'Paramètre inconnu' } }); return; }
    const access = await settingsAccess(req.user!);
    if (!access.canEdit(def.section)) {
      res.status(403).json({ success: false, error: { message: 'Accès interdit à ce paramètre' } });
      return;
    }
    const current = (await readAll()).get(def.key);
    if (current === null || current === undefined) {
      res.status(409).json({ success: false, error: { message: 'Paramètre non disponible sur cette base' } });
      return;
    }
    const value = validateParameter(def, req.body?.value, current);
    if (typeof value === 'string') { res.status(400).json({ success: false, error: { message: value } }); return; }
    if (!(await write(def, value, req.user?.userId))) {
      res.status(409).json({ success: false, error: { message: 'Paramètre non disponible sur cette base' } });
      return;
    }
    res.json({ success: true, data: { key: def.key, value, history: await history(def) } });
  },
};
