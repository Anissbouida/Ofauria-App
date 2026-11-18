/**
 * C-09 — aperçu d'impact des réglages de production :
 *  - un type d'ordre ne change pas d'étapes sous des ordres engagés (refus lisible) ; avec des
 *    brouillons seulement, le changement passe (ils prendront le réglage à la confirmation) ;
 *  - le libellé seul reste modifiable même avec des ordres en cours ;
 *  - l'impact d'une politique compte les ordres non terminés du niveau concerné.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Aperçu d\'impact des réglages de production (C-09)', () => {
  let fx: Fixtures;
  let types: typeof import('../../repositories/production-order-type.repository.js')['productionOrderTypeRepository'];
  let impact: typeof import('../../repositories/production-impact.repository.js')['productionImpactRepository'];
  const ids: Record<string, string> = {};
  const p = () => testPool();

  beforeAll(async () => {
    await importRepositories();
    types = (await import('../../repositories/production-order-type.repository.js')).productionOrderTypeRepository;
    impact = (await import('../../repositories/production-impact.repository.js')).productionImpactRepository;
    fx = await createBaseFixtures();
    ids.type = (await types.create({ code: `C09_${RUN}`.slice(0, 30), label: 'Test impact', requiresBonSortie: true }, fx.userId)).id;
    ids.draft = (await p().query(
      `INSERT INTO production_plans (plan_date, type, created_by, order_type_id, status, store_id) VALUES (CURRENT_DATE, 'daily', $1, $2, 'draft', $3) RETURNING id`,
      [fx.userId, ids.type, fx.storeId])).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    const run = async (sql: string, params: unknown[]) => { try { await p().query(sql, params); } catch { /* best effort */ } };
    await run(`DELETE FROM production_plans WHERE order_type_id = $1`, [ids.type]);
    await run(`DELETE FROM production_order_types WHERE id = $1`, [ids.type]);
    await run(`DELETE FROM users WHERE id = $1`, [fx.userId]);
    await run(`DELETE FROM stores WHERE id = $1`, [fx.storeId]);
    await closeTestPool();
  }, 60_000);

  it('type d\'ordre : brouillons seulement → changement accepté ; ordre en cours → refusé', async () => {
    expect(await impact.forOrderType(ids.type)).toEqual({ draft: 1, underway: 0 });
    const t1 = await types.update(ids.type, { requiresBonSortie: false }, fx.userId);
    expect(t1).toMatchObject({ requires_bon_sortie: false, consumption_mode: 'a_la_declaration' });

    await p().query(
      `INSERT INTO production_plans (plan_date, type, created_by, order_type_id, status, store_id) VALUES (CURRENT_DATE, 'daily', $1, $2, 'in_progress', $3)`,
      [fx.userId, ids.type, fx.storeId]);
    expect(await impact.forOrderType(ids.type)).toEqual({ draft: 1, underway: 1 });
    await expect(types.update(ids.type, { requiresBonSortie: true }, fx.userId)).rejects.toThrow(/1 ordre\(s\) de ce type sont en cours/);
    // Le libellé n'engage rien : toujours modifiable.
    expect((await types.update(ids.type, { label: 'Test impact renommé' }, fx.userId)).label).toBe('Test impact renommé');
  });

  it('politique : ordres non terminés du niveau', async () => {
    const code = (await p().query(`SELECT code FROM production_order_types WHERE id = $1`, [ids.type])).rows[0].code;
    const byType = await impact.forPolicyScope('order_type', code); // niveau rangé sous le code du type
    expect(byType).toEqual({ draft: 1, underway: 1 });
    const byStore = await impact.forPolicyScope('store', fx.storeId);
    expect(byStore.draft + byStore.underway).toBe(2);
    const company = await impact.forPolicyScope('company', '');
    expect(company.draft + company.underway).toBeGreaterThanOrEqual(2);
  });
});
