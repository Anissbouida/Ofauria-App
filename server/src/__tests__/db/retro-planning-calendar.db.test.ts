/**
 * M5-04 (reste) — le rétro-planning (mig 432) lit le calendrier des postes (mig 568).
 * Four ouvert 4 h – 6 h le jour du plan, vitrine à 7 h : la cuisson (60 min) finit à 6 h, le
 * façonnage sans poste la précède sans contrainte. Four fermé ce jour-là et le même jour de la
 * semaine précédente (seules plages de l'horizon de 7 jours) : l'étape sort du calendrier.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createProductWithRecipe, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Rétro-planning sur calendrier (M5-04)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let et: typeof import('../../repositories/production-etapes.repository.js')['productionEtapesRepository'];
  let fx: Fixtures; let planId: string; let itemId: string; let wcId: string; let planDate: string;
  const p = () => testPool();
  // Même convention que l'application (date + heure dans le fuseau de SON pool), pas celui du pool de test.
  const at = async (time: string) => (await repos.db.query(`SELECT ($1::date + $2::time)::timestamptz AS t`, [planDate, time])).rows[0].t.toISOString();
  const steps = async () => (await p().query(
    `SELECT nom, planned_start, planned_end FROM production_item_etapes WHERE plan_item_id = $1 ORDER BY ordre`, [itemId])).rows
    .map(r => ({ nom: r.nom, start: r.planned_start?.toISOString(), end: r.planned_end?.toISOString() }));

  beforeAll(async () => {
    repos = await importRepositories();
    et = (await import('../../repositories/production-etapes.repository.js')).productionEtapesRepository;
    fx = await createBaseFixtures();
    const d = await createProductWithRecipe(fx, { name: 'Pain M504', price: 3, ingredients: [] });
    planDate = new Date().toISOString().slice(0, 10);
    const pl = await repos.productionRepository.create({ planDate, type: 'daily', createdBy: fx.userId, storeId: fx.storeId, items: [{ productId: d.productId, plannedQuantity: 10 }] });
    planId = pl.id; fx.ids.plans.push(planId);
    itemId = (await p().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [planId])).rows[0].id;
    wcId = (await p().query(`INSERT INTO work_centers (name) VALUES ($1) RETURNING id`, [`Four M504 ${RUN}`])).rows[0].id;
    await p().query(
      `INSERT INTO work_center_calendar (work_center_id, iso_weekday, start_time, end_time) VALUES ($1, EXTRACT(ISODOW FROM $2::date), '04:00', '06:00')`,
      [wcId, planDate]);
    await p().query(
      `INSERT INTO production_item_etapes (plan_item_id, ordre, nom, duree_estimee_min, work_center_id)
       VALUES ($1, 1, 'Façonnage', 30, NULL), ($1, 2, 'Cuisson', 60, $2)`, [itemId, wcId]);
  }, 60_000);

  afterAll(async () => {
    const run = async (sql: string, params: unknown[]) => { try { await p().query(sql, params); } catch { /* best effort */ } };
    await run(`DELETE FROM production_item_etapes WHERE plan_item_id = $1`, [itemId]);
    await run(`DELETE FROM work_center_closures WHERE work_center_id = $1`, [wcId]);
    await run(`DELETE FROM work_center_calendar WHERE work_center_id = $1`, [wcId]);
    await run(`DELETE FROM work_centers WHERE id = $1`, [wcId]);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('cuisson placée dans les heures d\'ouverture du four, façonnage juste avant', async () => {
    const out = await et.computeRetroPlanning(planId, '07:00');
    expect(out.outside_calendar).toEqual([]);
    expect(await steps()).toEqual([
      { nom: 'Façonnage', start: await at('04:30'), end: await at('05:00') },
      { nom: 'Cuisson', start: await at('05:00'), end: await at('06:00') },
    ]);
  });

  it('four fermé sur tout l\'horizon : étape signalée hors calendrier', async () => {
    await p().query(`INSERT INTO work_center_closures (work_center_id, closed_on, reason) VALUES ($1, $2::date, 'Entretien'), ($1, $2::date - 7, 'Entretien')`, [wcId, planDate]);
    const out = await et.computeRetroPlanning(planId, '07:00');
    expect(out.outside_calendar).toEqual(['Cuisson']);
  });
});
