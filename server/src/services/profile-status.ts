import { db } from '../config/database.js';
import { sectorRepository } from '../repositories/sector.repository.js';

/**
 * État de configuration du profil d'industrie (C-03) : une tuile par couche, avec son état
 * et l'écran où la régler. Comptages seulement, rien n'est écrit.
 *   configured — la société a réglé cette couche ;
 *   default    — la valeur par défaut du profil s'applique (rien à faire si elle convient) ;
 *   todo       — il manque quelque chose pour produire.
 */
export type LayerState = 'configured' | 'default' | 'todo';
export interface ProfileLayer { key: string; label: string; state: LayerState; detail: string; to: string }

async function count(sql: string, params: unknown[] = []): Promise<number> {
  try { return Number((await db.query(sql, params)).rows[0].count) || 0; } catch { return 0; } // table absente d'une ancienne base
}

export async function profileStatus(): Promise<{ sector: { code: string; label: string }; layers: ProfileLayer[]; configured: number; total: number }> {
  const act = await sectorRepository.activation();
  const labels = await sectorRepository.labels(act.sector.code);
  const layers: ProfileLayer[] = [];
  const batchMode = act.features.has('mode_fournee');

  layers.push({ key: 'modules', label: 'Modules et capacités', state: 'configured',
    detail: `${act.modules.size} modules, ${act.features.size} option(s)`, to: '/settings?page=sector' });
  const overrides = await count(`SELECT count(*) FROM company_label_overrides`);
  layers.push({ key: 'vocabulary', label: 'Vocabulaire',
    state: overrides ? 'configured' : (labels.production_plan || batchMode ? 'default' : 'todo'),
    detail: overrides ? `${overrides} terme(s) renommé(s)` : labels.production_plan || batchMode ? 'Termes du secteur' : 'Termes de boulangerie par défaut',
    to: '/settings?page=sector' });

  if (act.modules.has('production')) {
    const workshops = await count(`SELECT count(*) FROM production_workshops WHERE is_active`);
    layers.push({ key: 'workshops', label: 'Ateliers', state: workshops ? 'configured' : 'todo',
      detail: workshops ? `${workshops} atelier(s)` : 'Aucun atelier actif', to: '/settings?page=production' });
    const types = await count(`SELECT count(*) FROM production_order_types WHERE is_active`);
    const ownTypes = await count(`SELECT count(*) FROM production_order_types WHERE is_active AND (code <> 'PLAN_JOUR' OR updated_by IS NOT NULL)`);
    layers.push({ key: 'order_types', label: 'Types d\'ordre', state: ownTypes ? 'configured' : 'default',
      detail: `${types} type(s) actif(s)`, to: '/production/settings' });
    const policies = await count(`SELECT count(*) FROM policy_values WHERE key LIKE 'production.%' OR key LIKE 'quality.%'`);
    layers.push({ key: 'policies', label: 'Politiques de production', state: policies ? 'configured' : 'default',
      detail: policies ? `${policies} valeur(s) posée(s)` : 'Valeurs par défaut', to: '/production/settings' });
    const prints = await count(`SELECT count(*) FROM document_templates WHERE category = 'production' AND (title IS NOT NULL OR layout <> '{}'::jsonb OR footer_note IS NOT NULL)`)
      + await count(`SELECT count(*) FROM document_template_variants`);
    layers.push({ key: 'prints', label: 'Impressions', state: prints ? 'configured' : 'default',
      detail: prints ? `${prints} gabarit(s) réglé(s)` : 'Gabarits par défaut', to: '/production/settings' });
    const routings = await count(`SELECT count(*) FROM routings WHERE is_active`);
    layers.push({ key: 'routings', label: 'Postes et gammes', state: routings ? 'configured' : batchMode ? 'default' : 'todo',
      detail: routings ? `${routings} gamme(s) active(s)` : 'Aucune gamme : étapes des fiches', to: '/production/work-centers' });
  }
  const units = await count(`SELECT count(*) FROM ref_entries WHERE table_id = 'units' AND is_active`);
  layers.push({ key: 'units', label: 'Unités', state: units ? 'configured' : 'todo', detail: `${units} unité(s) active(s)`, to: '/settings?page=units' });
  if (act.modules.has('stock')) {
    const locations = await count(`SELECT count(*) FROM stock_locations WHERE is_active`);
    layers.push({ key: 'locations', label: 'Emplacements', state: locations ? 'configured' : 'default',
      detail: locations ? `${locations} emplacement(s)` : 'Zones par défaut', to: '/stock' });
  }
  if (act.modules.has('controle')) {
    const plans = await count(`SELECT count(*) FROM quality_control_plan_lines`);
    layers.push({ key: 'control', label: 'Plans de contrôle', state: plans ? 'configured' : 'default',
      detail: plans ? `${plans} point(s) de contrôle` : 'Aucun plan de contrôle', to: '/controle' });
  }
  return {
    sector: { code: act.sector.code, label: act.sector.label },
    layers, configured: layers.filter(l => l.state === 'configured').length, total: layers.length,
  };
}
