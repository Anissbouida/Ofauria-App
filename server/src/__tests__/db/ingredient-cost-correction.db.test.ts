/**
 * G2-04 — prix aberrants et correction tracée.
 *  - un ingrédient sans prix est suspect ; avec deux réceptions (10 kg à 40 DH, 30 kg à
 *    44 DH), la proposition est leur prix moyen pondéré : 43 DH ;
 *  - la correction enregistre coût avant, coût après, motif, pièces à l'appui et auteur ;
 *    l'ingrédient n'est plus « sans prix » ;
 *  - refus : coût nul ou négatif, motif absent, coût inchangé, ingrédient inconnu.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Correction tracée du coût d\'un ingrédient (G2-04)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let corr: typeof import('../../repositories/ingredient-cost-correction.repository.js')['ingredientCostCorrectionRepository'];
  let fx: Fixtures;
  let ing: string, supplier: string, order: string, orderItem: string;
  const vouchers: string[] = [];
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    ({ ingredientCostCorrectionRepository: corr } = await import('../../repositories/ingredient-cost-correction.repository.js'));
    fx = await createBaseFixtures();
    ing = await createIngredient(fx, { name: 'Noisette G204', unit: 'kg', unitCost: 0 });
    supplier = (await p().query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`Fournisseur G204 ${RUN}`])).rows[0].id;
    order = (await p().query(
      `INSERT INTO purchase_orders (order_number, supplier_id, status, order_date, store_id, created_by)
       VALUES ($1, $2, 'en_attente', CURRENT_DATE - 30, $3, $4) RETURNING id`, [`BC-G204-${RUN}`, supplier, fx.storeId, fx.userId])).rows[0].id;
    orderItem = (await p().query(
      `INSERT INTO purchase_order_items (purchase_order_id, ingredient_id, quantity_ordered, unit_price) VALUES ($1, $2, 200, 42) RETURNING id`,
      [order, ing])).rows[0].id;
    const reception = async (daysAgo: number, qty: number, price: number, status = 'posted') => {
      const v = (await p().query(
        `INSERT INTO reception_vouchers (voucher_number, purchase_order_id, reception_date, store_id, received_by, status, reversed_by, reversed_at)
         VALUES ($1, $6, CURRENT_DATE - $2::int, $3, $4, $5::varchar,
                 CASE WHEN $5::varchar = 'reversed' THEN $4::uuid END, CASE WHEN $5::varchar = 'reversed' THEN now() END) RETURNING id`,
        [`BR-G204-${daysAgo}-${RUN}`, daysAgo, fx.storeId, fx.userId, status, order])).rows[0].id as string;
      vouchers.push(v);
      await p().query(
        `INSERT INTO reception_voucher_items (reception_voucher_id, purchase_order_item_id, ingredient_id, quantity_received, unit_price) VALUES ($1, $5, $2, $3, $4)`,
        [v, ing, qty, price, orderItem]);
    };
    await reception(20, 10, 40);
    await reception(5, 30, 44);
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM ingredient_cost_corrections WHERE ingredient_id = $1`, [ing]).catch(() => undefined);
    await p().query(`DELETE FROM reception_voucher_items WHERE reception_voucher_id = ANY($1)`, [vouchers]).catch(() => undefined);
    await p().query(`DELETE FROM reception_vouchers WHERE id = ANY($1)`, [vouchers]).catch(() => undefined);
    await p().query(`DELETE FROM purchase_orders WHERE id = $1`, [order]).catch(() => undefined);
    await p().query(`DELETE FROM suppliers WHERE id = $1`, [supplier]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('suspect « sans prix » avec ses dernières réceptions et la proposition pondérée', async () => {
    const s = (await corr.suspects(100_000)).find(x => x.ingredientId === ing)!;
    expect(s).toMatchObject({ reason: 'sans_prix', unitCost: 0, unit: 'kg', proposal: 43 });
    expect(s.receptions.map(r => [r.quantity, r.unitPrice])).toEqual([[30, 44], [10, 40]]);   // la plus récente d'abord
  });

  it('refus : coût nul, motif absent, ingrédient inconnu', async () => {
    expect(await corr.correct(ing, 0, 'Prix du dernier bon', fx.userId)).toEqual({ error: 'Le nouveau coût doit être supérieur à 0' });
    expect(await corr.correct(ing, -3, 'Prix du dernier bon', fx.userId)).toEqual({ error: 'Le nouveau coût doit être supérieur à 0' });
    expect(await corr.correct(ing, 43, '  ', fx.userId)).toEqual({ error: 'Indiquez le motif de la correction (5 caractères au moins)' });
    expect(await corr.correct('00000000-0000-0000-0000-000000000000', 43, 'Prix du dernier bon', fx.userId)).toEqual({ error: 'Ingrédient introuvable' });
    expect(Number((await p().query(`SELECT unit_cost FROM ingredients WHERE id = $1`, [ing])).rows[0].unit_cost)).toBe(0);
  });

  it('correction : coût mis à jour, trace complète, plus suspect', async () => {
    const out = await corr.correct(ing, 43, 'Aligné sur les deux dernières réceptions', fx.userId);
    if ('error' in out) throw new Error(out.error);
    expect(out).toMatchObject({ oldCost: 0, newCost: 43 });
    expect(Number((await p().query(`SELECT unit_cost FROM ingredients WHERE id = $1`, [ing])).rows[0].unit_cost)).toBe(43);

    const row = (await p().query(`SELECT * FROM ingredient_cost_corrections WHERE id = $1`, [out.id])).rows[0];
    expect(row).toMatchObject({ ingredient_id: ing, reason: 'Aligné sur les deux dernières réceptions', corrected_by: fx.userId });
    expect(Number(row.old_cost)).toBe(0);
    expect(Number(row.new_cost)).toBe(43);
    expect(row.basis.proposal).toBe(43);
    expect(row.basis.receptions).toHaveLength(2);

    // Plus « sans prix » (il peut rester signalé s'il s'écarte de la médiane de sa catégorie dans la base de test).
    expect((await corr.suspects(100_000)).some(x => x.ingredientId === ing && x.reason === 'sans_prix')).toBe(false);
    expect((await corr.history(20)).some(h => h.id === out.id && h.new_cost === 43)).toBe(true);
    expect(await corr.correct(ing, 43, 'Encore une fois', fx.userId)).toEqual({ error: 'Le coût est déjà à cette valeur' });
  });
});
