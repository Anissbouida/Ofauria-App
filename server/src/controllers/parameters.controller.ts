import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { settingsAccess } from '../middleware/settings-access.middleware.js';
import { DOMAIN_LABELS, PARAMETERS, parameterByKey, validateParameter } from '../services/parameters-catalog.js';
import { history, lockCompanyConfiguration, readAll, write } from '../services/settings-center.js';
import { withCurrency } from '../services/currency.js';
import { withTransaction } from '../config/database.js';

/** Paramètres métier (Paramètres › Paramètres métier, lot 4). */
export const parametersController = {
  async list(req: AuthRequest, res: Response) {
    const access = await settingsAccess(req.user!);
    const origins = new Map<string, 'company' | 'default' | 'unavailable'>();
    const values = await readAll(origins);
    // Une politique dont le niveau société est une colonne historique (companyColumns) se
    // règle sur son écran d'origine et dans Production › Politiques, pas ici.
    const visible = PARAMETERS.filter(p => access.canView(p.section) && !(p.storage.kind === 'policy' && !(p.scopes ?? ['company']).includes('company')));
    const data = await Promise.all(visible.map(async p => ({
      key: p.key,
      domain: p.domain,
      domainLabel: DOMAIN_LABELS[p.domain],
      label: withCurrency(p.label),
      help: withCurrency(p.help),
      fields: withCurrency(p.fields),
      defaults: p.defaults,
      value: values.get(p.key) ?? null,
      source: origins.get(p.key) ?? 'unavailable',
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
    const result=await withTransaction(async()=>{
      await lockCompanyConfiguration();
      const current=(await readAll()).get(def.key);
      if(current==null)return {status:409,error:'Paramètre non disponible sur cette base'} as const;
      const value=validateParameter(def,req.body?.value,current);
      if(typeof value==='string')return {status:400,error:value} as const;
      if(!(await write(def,value,req.user?.userId)))return {status:409,error:'Paramètre non disponible sur cette base'} as const;
      return {value};
    });
    if('error' in result){res.status(result.status??409).json({success:false,error:{message:result.error}});return;}
    res.json({ success: true, data: { key: def.key, value:result.value, history: await history(def) } });
  },
};
