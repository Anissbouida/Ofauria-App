/**
 * C-01 / C-05 — profils d'industrie (mig 586).
 *  - « Charger les données de départ » du profil « discret » crée ses types d'ordre (série,
 *    sous-traitance), ses politiques société et son gabarit d'impression ; un second chargement
 *    ne crée rien (rien n'est écrasé) ; le type par défaut ne change pas quand il a des ordres ;
 *  - export → import du modèle de configuration v2 conserve les couches ; un modèle v1 reste accepté ;
 *  - une couche importée invalide est filtrée avec un avertissement.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories } from './helpers.js';

describe.skipIf(!hasTestDb)('Profils d\'industrie (C-01, C-05)', () => {
  let starter: typeof import('../../services/sector-starter.service.js');
  let tpl: typeof import('../../services/config-templates.js');
  let prof: typeof import('../../services/industry-profile.js');
  const p = () => testPool();
  let before: {
    types: string[]; policies: string[]; fiche: { title: string | null; layout: object; footer_note: string | null };
    /** Données de départ de « Fabrication » (secteur de base du profil) déjà présentes avant le test. */
    demo: boolean; refs: string[]; categories: string[]; workshop: boolean; ingredients: string[];
    /** Postes et emplacements (couches C-01) déjà présents. */
    centers: string[]; locations: string[];
  };

  beforeAll(async () => {
    await importRepositories();
    starter = await import('../../services/sector-starter.service.js');
    tpl = await import('../../services/config-templates.js');
    prof = await import('../../services/industry-profile.js');
    before = {
      types: (await p().query(`SELECT code FROM production_order_types WHERE code IN ('ORDRE_SERIE', 'SOUS_TRAITANCE')`)).rows.map(r => r.code),
      policies: (await p().query(`SELECT key FROM policy_values WHERE scope_type = 'company' AND key IN ('production.cost_allocation_key', 'production.steps_source')`)).rows.map(r => r.key),
      fiche: (await p().query(`SELECT title, layout, footer_note FROM document_templates WHERE doc_type = 'production_fiche'`)).rows[0],
      demo: (await p().query(`SELECT 1 FROM products WHERE slug = 'starter-demo-etagere'`)).rows.length > 0,
      refs: (await p().query(`SELECT table_id || ':' || code AS k FROM ref_entries WHERE table_id IN ('production_step_types', 'production_equipment_types')`)).rows.map(r => r.k),
      categories: (await p().query(`SELECT slug FROM categories WHERE slug LIKE 'starter-%'`)).rows.map(r => r.slug),
      workshop: (await p().query(`SELECT 1 FROM production_workshops WHERE code = 'atelier_principal'`)).rows.length > 0,
      ingredients: (await p().query(`SELECT name FROM ingredients WHERE name LIKE '%(démo)'`)).rows.map(r => r.name),
      centers: (await p().query(`SELECT id FROM work_centers`)).rows.map(r => r.id),
      locations: (await p().query(`SELECT id FROM stock_locations`)).rows.map(r => r.id),
    };
  });

  afterAll(async () => {
    const run = async (sql: string, params: unknown[]) => { try { await p().query(sql, params); } catch { /* best effort */ } };
    await run(`DELETE FROM production_order_types WHERE code = ANY($1::text[]) AND NOT (code = ANY($2::text[]))
                 AND NOT EXISTS (SELECT 1 FROM production_plans pp WHERE pp.order_type_id = production_order_types.id)`,
      [['ORDRE_SERIE', 'SOUS_TRAITANCE'], before.types]);
    await run(`DELETE FROM policy_values WHERE scope_type = 'company' AND key = ANY($1::text[]) AND NOT (key = ANY($2::text[]))`,
      [['production.cost_allocation_key', 'production.steps_source'], before.policies]);
    if (before.fiche) await run(`UPDATE document_templates SET title = $1, layout = $2, footer_note = $3 WHERE doc_type = 'production_fiche'`,
      [before.fiche.title, JSON.stringify(before.fiche.layout), before.fiche.footer_note]);
    // Données de départ de « Fabrication » chargées avec le profil : seulement ce que le test a créé.
    if (!before.demo) {
      await run(`DELETE FROM recipe_ingredients WHERE recipe_id IN (SELECT r.id FROM recipes r JOIN products pr ON pr.id = r.product_id WHERE pr.slug = 'starter-demo-etagere')`, []);
      await run(`DELETE FROM recipes WHERE product_id IN (SELECT id FROM products WHERE slug = 'starter-demo-etagere')`, []);
      await run(`DELETE FROM products WHERE slug = 'starter-demo-etagere'`, []);
    }
    await run(`DELETE FROM ingredients WHERE name LIKE '%(démo)' AND NOT (name = ANY($1::text[]))`, [before.ingredients]);
    await run(`DELETE FROM ref_entries WHERE table_id IN ('production_step_types', 'production_equipment_types') AND NOT ((table_id || ':' || code) = ANY($1::text[]))`, [before.refs]);
    if (!before.workshop) await run(`DELETE FROM production_workshops WHERE code = 'atelier_principal'`, []);
    await run(`DELETE FROM categories WHERE slug LIKE 'starter-%' AND NOT (slug = ANY($1::text[]))`, [before.categories]);
    await run(`DELETE FROM work_centers WHERE NOT (id = ANY($1::uuid[]))`, [before.centers]);
    await run(`DELETE FROM stock_locations WHERE NOT (id = ANY($1::uuid[]))`, [before.locations]);
    await closeTestPool();
  });

  it('trois profils de référence livrés, bâtis sur Fabrication', async () => {
    const rows = (await p().query(`SELECT code, base_sector, profile FROM sector_packs WHERE code IN ('process', 'discret', 'atelier') ORDER BY code`)).rows;
    expect(rows.map(r => [r.code, r.base_sector])).toEqual([['atelier', 'fabrication'], ['discret', 'fabrication'], ['process', 'fabrication']]);
    const def = Object.fromEntries(rows.map(r => [r.code, r.profile.order_types.find((t: { is_default: boolean }) => t.is_default)]));
    expect(def.process).toMatchObject({ code: 'ORDRE_LOT', consumption_mode: 'au_bon_de_sortie', requires_weighing: true });
    expect(def.discret).toMatchObject({ code: 'ORDRE_SERIE', consumption_mode: 'a_la_declaration', requires_bon_sortie: false });
    expect(def.atelier).toMatchObject({ code: 'ORDRE_AFFAIRE', consumption_mode: 'manuel' });
  });

  it('acceptation (C-06) : aucun terme ni option de boulangerie dans les profils livrés', async () => {
    const sector = (await import('../../repositories/sector.repository.js')).sectorRepository;
    const BAKERY = /fournée|recette|plan de production|préparation de base|vitrine|pâton/i;
    for (const code of ['process', 'discret', 'atelier']) {
      const labels = await sector.labels(code);
      for (const k of ['production_plan', 'production_plans', 'new_plan', 'recipe', 'recipes', 'batch', 'base_preps', 'yield']) {
        expect(labels[k], `${code}.${k}`).toBeTruthy();
        expect(labels[k], `${code}.${k}`).not.toMatch(BAKERY);
      }
      const pack = (await p().query(`SELECT features, profile FROM sector_packs WHERE code = $1`, [code])).rows[0];
      expect(pack.features.filter((f: string) => ['mode_fournee', 'vitrine', 'dlc_jour', 'fiche_masterclass', 'ccp_cuisson'].includes(f)), code).toEqual([]);
      const warnings: string[] = [];
      const layers = prof.cleanLayers(pack.profile, warnings);
      expect(warnings, code).toEqual([]);
      expect(layers.order_types.filter(t => t.is_default)).toHaveLength(1);
    }
  });

  it('chargement du profil « discret » : couches créées une fois, rien d\'écrasé', async () => {
    const preview = await starter.sectorStarterPreview('discret');
    expect(preview.items.join(' | ')).toMatch(/Types d'ordre : Ordre de série \(par défaut\), Sous-traitance/);
    const defBefore = (await p().query(`SELECT code FROM production_order_types WHERE is_default`)).rows[0].code;
    const r1 = await starter.loadSectorStarter('discret');
    expect(r1.orderTypes).toBe(2 - before.types.length);
    const t = (await p().query(`SELECT code, requires_bon_sortie, consumption_mode, is_subcontracting FROM production_order_types WHERE code IN ('ORDRE_SERIE', 'SOUS_TRAITANCE') ORDER BY code`)).rows;
    expect(t).toEqual([
      { code: 'ORDRE_SERIE', requires_bon_sortie: false, consumption_mode: 'a_la_declaration', is_subcontracting: false },
      { code: 'SOUS_TRAITANCE', requires_bon_sortie: false, consumption_mode: 'a_la_declaration', is_subcontracting: true },
    ]);
    // La base de test a des ordres sur le type par défaut : il reste en place.
    expect((await p().query(`SELECT code FROM production_order_types WHERE is_default`)).rows[0].code).toBe(defBefore);
    // Couches C-01 : postes ajoutés s'ils manquent, emplacements dans chaque établissement actif.
    const centers = (await p().query(`SELECT name FROM work_centers WHERE name = ANY($1::text[])`, [['Débit', 'Assemblage', 'Finition']])).rows.map(r => r.name).sort();
    expect(centers).toEqual(['Assemblage', 'Débit', 'Finition']);
    const missing = (await p().query(
      `SELECT COUNT(*)::int AS n FROM stores s WHERE s.is_active AND NOT EXISTS (SELECT 1 FROM stock_locations l WHERE l.store_id = s.id AND l.code = 'EXPEDITION')`)).rows[0].n;
    expect(missing).toBe(0);
    const nCenters = (await p().query(`SELECT COUNT(*)::int AS n FROM work_centers`)).rows[0].n;
    const r2 = await starter.loadSectorStarter('discret');
    expect([r2.orderTypes, r2.policies, r2.printTemplates]).toEqual([0, 0, 0]);
    expect((await p().query(`SELECT COUNT(*)::int AS n FROM work_centers`)).rows[0].n).toBe(nCenters); // rejeu : rien de neuf
  });

  it('modèle v2 : export → import conserve les couches ; v1 accepté ; couche invalide filtrée', async () => {
    const model = await tpl.exportCurrentConfig('C01 round trip');
    expect(model.version).toBe(2);
    expect(model.layers.order_types.map(t => t.code)).toEqual(expect.arrayContaining(['ORDRE_SERIE', 'SOUS_TRAITANCE']));
    const parsed = await tpl.parseConfigModel(JSON.parse(JSON.stringify(model)));
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.model.layers.order_types.length).toBe(model.layers.order_types.length);
    expect(parsed.model.layers.policies).toEqual(model.layers.policies);

    const v1 = await tpl.parseConfigModel({ ...JSON.parse(JSON.stringify(model)), version: 1, layers: undefined });
    if ('error' in v1) throw new Error(v1.error);
    expect(v1.model.layers).toEqual({ order_types: [], policies: [], print_templates: [] });

    const warnings: string[] = [];
    const bad = prof.cleanLayers({
      order_types: [{ code: 'x', label: 'Mauvais code' }, { code: 'ST2', label: 'ST', is_subcontracting: true, requires_bon_sortie: true, consumption_mode: 'au_bon_de_sortie' }],
      policies: [{ key: 'inexistante', value: {} }, { key: 'production.cost_allocation_key', value: { key: 'magie' } }],
      print_templates: [{ doc_type: 'production_fiche', title: 'T', layout: { columns: ['product', 'prix'] } }],
    }, warnings);
    expect(bad.order_types).toEqual([expect.objectContaining({ code: 'ST2', requires_bon_sortie: false, consumption_mode: 'a_la_declaration', is_subcontracting: true })]);
    expect(bad.policies).toEqual([]);
    expect(bad.print_templates[0].layout).toEqual({ columns: ['product'] });
    expect(warnings.length).toBeGreaterThanOrEqual(3);
  });
});
