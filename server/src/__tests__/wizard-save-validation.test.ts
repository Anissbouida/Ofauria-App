import { describe, it, expect } from 'vitest';
import { wizardSave } from '../routes/settings.routes.js';

/** Contrôle réel de la route d'enregistrement d'un brouillon (PUT /settings/assistant/:id),
 *  avec des réponses de toutes les étapes telles que l'écran les envoie. */
describe('Assistant — validation de l’enregistrement d’un brouillon', () => {
  const answers = {
    company: { reviewed: true, data: { name: 'KALUM SARL', legalForm: 'SARL', locale: 'fr', timezone: 'Africa/Casablanca', size: 'PME', country: 'MA', currency: 'MAD', sites: '2', 'store:1:name': 'Dépôt', 'store:1:kind': 'warehouse', 'store:1:city': 'Rabat' } },
    sector: { reviewed: true, data: { primary: 'btp', secondary: ['negoce'] } },
    specialties: { reviewed: true, data: { selected: ['gros_oeuvre'] } },
    modules: { reviewed: true, data: { selected: ['dashboard', 'users', 'settings', 'stock', 'projects'], features: ['lots', 'dlc_ddm', 'series', 'tracabilite', 'quarantaine'] } },
    operations: { reviewed: true, data: { 'production.demand_source:mode': 'orders', 'production.rhythm:mode': 'industrial', 'production.mrp_horizon:days': '14', 'stock.organization:mode': 'central', 'stock.low_stock_alerts:enabled': true, 'sales.channel:channel': 'wholesale' } },
    vocabulary: { reviewed: true, data: { recipe: 'Nomenclature', product: 'Ouvrage', batch: 'Lot' } },
    rules: { reviewed: true, data: { 'production.flow:recipe_required': true, 'approval:po_over_threshold:value': '8000', 'approval:po_over_threshold:enabled': true, 'sales.pricing:max_discount_pct_sales': '12' } },
    interfaces: { reviewed: true, data: { workspace: 'direction', density: 'compact' } },
    finance: { reviewed: true, data: { 'accounting.vat_periodicity:mode': 'quarterly' } },
    roles: { reviewed: true, data: { selected: ['direction', 'comptable'] } },
    data: { reviewed: true, data: { referentials: true, demo: false } },
    review: { reviewed: false },
  };

  it('accepte des réponses complètes, capacités des modules comprises', () => {
    const r = wizardSave.safeParse({ mode: 'advanced', current_step: 'modules', revision: 3, answers });
    expect(r.success ? [] : r.error.issues.map(i => `${i.path.join('.')} : ${i.message}`)).toEqual([]);
  });

  it('refuse un type faux ou un champ inconnu, en nommant le champ', () => {
    const bad = { ...answers, modules: { reviewed: true, data: { selected: 'stock', features: ['lots'] } }, vocabulary: { data: { inconnu: 'x' } } };
    const r = wizardSave.safeParse({ mode: 'advanced', current_step: 'modules', revision: 3, answers: bad });
    expect(r.success).toBe(false);
    const paths = r.success ? [] : r.error.issues.map(i => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['answers.modules.data.selected', 'answers.vocabulary.data.inconnu']));
  });
});
