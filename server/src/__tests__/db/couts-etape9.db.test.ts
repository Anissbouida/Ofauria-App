/**
 * Coûts et comptabilité (plan d'exécution multi-industries, étape 9, mig 645).
 *
 *   - coût machine réel : taux du poste × temps réel des étapes rattachées au poste ;
 *     composante éteinte par défaut (coût d'Ofauria inchangé), allumée par politique ;
 *   - une composante éteinte vaut zéro dans le coût réel ;
 *   - écritures de production en option (inventaire permanent) : aucune par défaut ;
 *     activées, une écriture d'OD équilibrée, une seule par ordre.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createProductWithRecipe, cleanupFixtures, type Fixtures,
} from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe.skipIf(!hasTestDb)('Étape 9 — coûts et comptabilité', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let cout: any; let policies: any; let ledger: any;
  let fx: Fixtures; let planId: string; let wcId: string;
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    cout = (await import('../../repositories/production-cout.repository.js')).productionCoutRepository;
    policies = await import('../../services/policies.js');
    ledger = await import('../../services/production-ledger.js');
    await p().query(`DELETE FROM policy_values WHERE key IN ('production.cost_components', 'production.ledger_entries')`);
    policies.invalidatePolicies();
    fx = await createBaseFixtures();
    const ing = await createIngredient(fx, { name: 'Tôle E9', unit: 'kg', unitCost: 4 });
    const { productId } = await createProductWithRecipe(fx, { name: 'Support E9', price: 30, ingredients: [{ ingredientId: ing, quantity: 1, unit: 'kg' }] });
    const plan = await repos.productionRepository.create({
      planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId, plannedQuantity: 5 }],
    });
    planId = plan.id; fx.ids.plans.push(planId);
    const item = (await p().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [planId])).rows[0].id;
    wcId = (await p().query(`INSERT INTO work_centers (name, hourly_cost, store_id) VALUES ($1, 120, $2) RETURNING id`, [`Presse E9 ${Date.now()}`, fx.storeId])).rows[0].id;
    // Étape d'usinage terminée : 90 minutes réelles sur la presse (120 l'heure → 180).
    await p().query(
      `INSERT INTO production_item_etapes (plan_item_id, ordre, nom, status, duree_reelle_min, work_center_id) VALUES ($1, 1, 'Emboutissage', 'completed', 90, $2)`,
      [item, wcId]);
    // Matière consommée pour avoir un coût (sortie de production tracée).
    await p().query(
      `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, note, performed_by, store_id, production_plan_id)
       VALUES ($1, 'production', -5, 'E9', $2, $3, $4)`, [ing, fx.userId, fx.storeId, planId]);
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM policy_values WHERE key IN ('production.cost_components', 'production.ledger_entries')`).catch(() => undefined);
    policies?.invalidatePolicies();
    const je = (await p().query(`SELECT id FROM journal_entries WHERE source_detail = $1`, [`production:${planId}`]).catch(() => ({ rows: [] }))).rows.map((r: any) => r.id);
    if (je.length) {
      await p().query(`DELETE FROM journal_entry_lines WHERE journal_entry_id = ANY($1::uuid[])`, [je]).catch(() => undefined);
      await p().query(`DELETE FROM journal_entries WHERE id = ANY($1::uuid[])`, [je]).catch(() => undefined);
    }
    await p().query(`DELETE FROM ledger_outbox WHERE source_kind = 'production' AND source_id = $1`, [planId]).catch(() => undefined);
    await p().query(`DELETE FROM inventory_transactions WHERE production_plan_id = $1`, [planId]).catch(() => undefined);
    await p().query(`DELETE FROM production_cout_reel WHERE plan_id = $1`, [planId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await p().query(`DELETE FROM work_centers WHERE id = $1`, [wcId]).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('par défaut, la composante machine est éteinte : coût réel inchangé', async () => {
    const saved = await cout.calculateAndSave(planId, fx.userId);
    expect(Number(saved.cout_machine)).toBe(0);
    expect(Number(saved.cout_matieres)).toBe(20);
    expect(Number(saved.cout_total)).toBeGreaterThanOrEqual(20);
  });

  it('composante machine allumée : taux du poste × temps réel, inclus dans le coût total', async () => {
    const before = Number((await cout.calculateAndSave(planId, fx.userId)).cout_total);
    await policies.setPolicy('production.cost_components', 'company', '', { emballage: true, main_oeuvre: true, machine: true, energie: true, sous_traitance: true, pertes: true, charges: true }, fx.userId);
    const saved = await cout.calculateAndSave(planId, fx.userId);
    expect(Number(saved.cout_machine)).toBe(180);
    expect(saved.detail_machine).toEqual([expect.objectContaining({ minutes: 90, hourly_cost: 120, total: 180 })]);
    expect(Number(saved.cout_total)).toBeCloseTo(before + 180, 2);
  });

  it('une composante éteinte vaut zéro (charges fixes)', async () => {
    const withCharges = await cout.computePlanCost(planId);
    await policies.setPolicy('production.cost_components', 'company', '', { emballage: true, main_oeuvre: true, machine: true, energie: true, sous_traitance: true, pertes: true, charges: false }, fx.userId);
    const without = await cout.computePlanCost(planId);
    expect(without.coutCharges).toBe(0);
    expect(without.detailCharges).toEqual([]);
    expect(without.coutTotal).toBeCloseTo(withCharges.coutTotal - withCharges.coutCharges, 2);
  });

  it('écritures de production : aucune par défaut ; activées, une OD équilibrée et une seule', async () => {
    await cout.calculateAndSave(planId, fx.userId);
    expect(await ledger.postProductionEntry(planId, fx.userId)).toEqual({ posted: false, reason: 'disabled' });
    await policies.setPolicy('production.ledger_entries', 'company', '', { enabled: true }, fx.userId);
    const r = await ledger.postProductionEntry(planId, fx.userId);
    expect(r.posted).toBe(true);
    const lines = (await p().query(
      `SELECT a.code, l.debit::float8 AS d, l.credit::float8 AS c FROM journal_entries e
         JOIN journal_entry_lines l ON l.journal_entry_id = e.id JOIN accounts a ON a.id = l.account_id
        WHERE e.source_detail = $1 ORDER BY l.line_order`, [`production:${planId}`])).rows;
    const total = Number((await p().query(`SELECT cout_total FROM production_cout_reel WHERE plan_id = $1`, [planId])).rows[0].cout_total);
    expect(lines.map((l: any) => l.code)).toEqual(['3151', '7132', '6124', '3121']);
    expect(lines[0].d).toBeCloseTo(total, 2);
    expect(lines[2].d).toBe(20);
    expect(lines.reduce((t: number, l: any) => t + l.d - l.c, 0)).toBeCloseTo(0, 2);
    expect(await ledger.postProductionEntry(planId, fx.userId)).toEqual({ posted: false, reason: 'already' });
  });
});
