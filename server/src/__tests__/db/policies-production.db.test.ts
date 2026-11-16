/**
 * M1-03 — constantes de production reprises par les politiques.
 * Pour chaque constante : sans réglage, la valeur d'avant (zéro écart) ; avec un réglage,
 * la valeur posée au bon niveau.
 *  - rendement cible d'un article sans seuil (90 %) ;
 *  - taux de charges fixes : colonne de la société, surchargée par atelier ;
 *  - prix du kWh d'un nouvel équipement (1,50) ;
 *  - seuil d'un nouveau contenant (90 %) ;
 *  - horizon du plan directeur (14 jours) ;
 *  - liste des politiques : valeur effective, niveau d'origine, valeurs posées.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createProductWithRecipe, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Constantes de production reprises par les politiques (M1-03)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let pol: typeof import('../../services/policies.js');
  let rendement: typeof import('../../repositories/production-rendement.repository.js')['productionRendementRepository'];
  let cout: typeof import('../../repositories/production-cout.repository.js')['productionCoutRepository'];
  let contenants: typeof import('../../repositories/production-contenant.repository.js')['productionContenantRepository'];
  let mrp: typeof import('../../repositories/mrp.repository.js')['mrpRepository'];
  let fx: Fixtures;
  let planId: string, itemId: string, productId: string, workshop: string;
  let previousRate: string;
  const cleanup: { table: string; id: string }[] = [];
  const KEYS = ['production.yield_target', 'production.fixed_charges_rate', 'production.kwh_price', 'production.mrp_horizon'];
  const p = () => testPool();
  const set = (key: string, scope: Parameters<typeof pol.setPolicy>[1], id: string, value: unknown) => pol.setPolicy(key, scope, id, value, fx.userId);

  beforeAll(async () => {
    repos = await importRepositories();
    pol = await import('../../services/policies.js');
    ({ productionRendementRepository: rendement } = await import('../../repositories/production-rendement.repository.js'));
    ({ productionCoutRepository: cout } = await import('../../repositories/production-cout.repository.js'));
    ({ productionContenantRepository: contenants } = await import('../../repositories/production-contenant.repository.js'));
    ({ mrpRepository: mrp } = await import('../../repositories/mrp.repository.js'));
    fx = await createBaseFixtures();
    workshop = (await p().query(`SELECT code FROM production_workshops WHERE is_active ORDER BY sort_order, code LIMIT 1`)).rows[0].code;
    productId = (await createProductWithRecipe(fx, { name: 'Pain M103', price: 5, ingredients: [] })).productId;
    planId = (await p().query(
      `INSERT INTO production_plans (plan_date, type, status, created_by, store_id, target_role) VALUES (CURRENT_DATE, 'daily', 'in_progress', $1, $2, $3) RETURNING id`,
      [fx.userId, fx.storeId, workshop])).rows[0].id;
    fx.ids.plans.push(planId);
    itemId = (await p().query(
      `INSERT INTO production_plan_items (plan_id, product_id, planned_quantity) VALUES ($1, $2, 10) RETURNING id`, [planId, productId])).rows[0].id;
    previousRate = (await p().query(`SELECT production_charges_fixes_pct FROM company_settings WHERE id = 1`)).rows[0].production_charges_fixes_pct;
    await p().query(`DELETE FROM policy_values WHERE key = ANY($1)`, [KEYS]);
    pol.invalidatePolicies();
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM policy_values WHERE key = ANY($1)`, [KEYS]).catch(() => undefined);
    await p().query(`UPDATE company_settings SET production_charges_fixes_pct = $1 WHERE id = 1`, [previousRate]).catch(() => undefined);
    for (const c of cleanup) await p().query(`DELETE FROM ${c.table} WHERE id = $1`, [c.id]).catch(() => undefined);
    await p().query(`DELETE FROM production_plan_items WHERE plan_id = $1`, [planId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('rendement cible d\'un article sans seuil : 90 % comme avant, puis la valeur de l\'atelier', async () => {
    expect(Number((await rendement.getTargetForItem(itemId))!.seuilRendement)).toBe(90);
    await set('production.yield_target', 'workshop', workshop, { pct: 82 });
    expect(Number((await rendement.getTargetForItem(itemId))!.seuilRendement)).toBe(82);
    await set('production.yield_target', 'product', productId, { pct: 95 });
    expect(Number((await rendement.getTargetForItem(itemId))!.seuilRendement)).toBe(95);
  });

  it('taux de charges fixes : la colonne de la société fait foi, un atelier peut la surcharger', async () => {
    await p().query(`UPDATE company_settings SET production_charges_fixes_pct = 0.35 WHERE id = 1`);
    expect((await cout.chargesSettings(planId)).rate).toBe(0.35);
    expect((await cout.chargesSettings()).rate).toBe(0.35);
    // Le niveau société ne se règle pas ici (un seul endroit : Production › Paramétrage).
    expect(await set('production.fixed_charges_rate', 'company', '', { rate: 0.5 }))
      .toEqual({ error: '« Taux de charges fixes » ne se règle pas au niveau société' });
    await set('production.fixed_charges_rate', 'workshop', workshop, { rate: 0.25 });
    expect((await cout.chargesSettings(planId)).rate).toBe(0.25);
    expect((await cout.chargesSettings()).rate).toBe(0.35);   // hors de cet atelier : la société
  });

  it('prix du kWh d\'un nouvel équipement : 1,50 comme avant, puis la politique ; un prix saisi est gardé', async () => {
    const make = async (extra: Record<string, unknown> = {}) => {
      const e = await cout.createEquipement({ nom: `Four M103 ${RUN} ${Math.random()}`, type: 'four', cout_horaire: 10, ...extra });
      cleanup.push({ table: 'production_equipements', id: e.id });
      return Number(e.cout_kwh);
    };
    expect(await make()).toBe(1.5);
    await set('production.kwh_price', 'company', '', { price: 1.8 });
    expect(await make()).toBe(1.8);
    expect(await make({ cout_kwh: 2.1 })).toBe(2.1);
  });

  it('seuil d\'un nouveau contenant : la politique « Rendement cible » de la société', async () => {
    const make = async (extra: Record<string, unknown> = {}) => {
      const c = await contenants.createContenant({
        nom: `Cadre M103 ${RUN} ${Math.random()}`, type_production: 1, unite_lancement: 'cadre', quantite_theorique: 10, pertes_fixes: 0,
        etapes_defaut: [], categories_pertes: [], ...extra,
      } as Parameters<typeof contenants.createContenant>[0]);
      cleanup.push({ table: 'production_contenants', id: c.id });
      return Number(c.seuil_rendement_defaut);
    };
    expect(await make()).toBe(90);
    await set('production.yield_target', 'company', '', { pct: 88 });
    expect(await make()).toBe(88);
    expect(await make({ seuil_rendement_defaut: 93 })).toBe(93);
  });

  it('horizon du plan directeur : 14 jours comme avant, puis la valeur de l\'établissement', async () => {
    const from = '2028-03-01', to = '2028-04-15';
    expect((await mrp.horizon(fx.storeId, from, to)).dates).toHaveLength(14);
    await set('production.mrp_horizon', 'store', fx.storeId, { days: 7 });
    expect((await mrp.horizon(fx.storeId, from, to)).dates).toHaveLength(7);
  }, 120_000);

  it('liste des politiques : valeur effective, niveau d\'origine, valeurs posées', async () => {
    const { policies, levels } = await pol.listPolicies({ storeId: fx.storeId, workshop });
    const by = (key: string) => policies.find(x => x.key === key)!;
    expect(by('production.yield_target').effective).toMatchObject({ value: { pct: 82 }, source: 'workshop', scopeId: workshop, sourceLabel: 'Atelier' });
    expect(by('production.yield_target').overrides.map(o => o.scopeType).sort()).toEqual(['company', 'product', 'workshop']);
    expect(by('production.yield_target').overrides.find(o => o.scopeType === 'product')!.scopeLabel).toContain('Pain M103');
    expect(by('production.fixed_charges_rate')).toMatchObject({ companyManagedElsewhere: true, company: { value: { rate: 0.35 }, source: 'company' } });
    expect(by('production.mrp_horizon').effective).toMatchObject({ value: { days: 7 }, source: 'store' });
    expect(by('production.shift_cutoff').effective).toMatchObject({ value: { hour: 14 }, source: 'default' });
    expect(by('production.showcase_time').effective.value).toEqual({ time: '07:00' });
    expect(by('production.yield_display').effective.value).toEqual({ good: 85, alert: 70 });
    expect(by('production.oee_thresholds').effective.value).toEqual({ good: 85, alert: 60 });
    expect(levels.stores.some(s => s.id === fx.storeId)).toBe(true);
    expect(levels.workshops.some(w => w.id === workshop)).toBe(true);
  });
});
