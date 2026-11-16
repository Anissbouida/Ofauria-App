/**
 * G1-11 — tâche planifiée « alertes de DLC ».
 * Seuils 7 et 2 jours : un lot est signalé une fois par seuil franchi, jamais deux fois
 * pour le même ; un lot lointain ou vide n'est pas signalé ; l'e-mail part si demandé.
 * Les échéances sont posées avec une marge d'un jour : la date de la base de test et la
 * date de Casablanca peuvent différer d'un jour.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, createLot, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Tâche planifiée : alertes de DLC (G1-11)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let scheduler: typeof import('../../services/scheduler.js');
  let fx: Fixtures;
  let previous: unknown;
  let soon: string, far: string, empty: string, productLot: string, managerId: string;
  const p = () => testPool();
  const setParam = (value: unknown) => p().query(
    `INSERT INTO module_parameters (key, value) VALUES ('stock.dlc_alerts', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(value)]);
  const alerts = async (lotId: string) => (await p().query(
    `SELECT threshold_days FROM lot_expiry_alerts WHERE lot_id = $1 ORDER BY threshold_days`, [lotId])).rows.map(r => r.threshold_days);
  const notifications = async () => (await p().query(
    `SELECT target_role, title, message FROM notifications WHERE store_id = $1 AND type = 'dlc_alert' ORDER BY created_at`, [fx.storeId])).rows;

  beforeAll(async () => {
    repos = await importRepositories();
    scheduler = await import('../../services/scheduler.js');
    fx = await createBaseFixtures();
    previous = (await p().query(`SELECT value FROM module_parameters WHERE key = 'stock.dlc_alerts'`)).rows[0]?.value;
    await setParam({ days: [7, 2], email: false });
    const farine = await createIngredient(fx, { name: 'Farine G111', unit: 'kg', unitCost: 10 });
    soon = await createLot(fx, { ingredientId: farine, lotNumber: 'PROCHE', pesage: 10, expiresInDays: 5 });     // sous 7 jours
    far = await createLot(fx, { ingredientId: farine, lotNumber: 'LOIN', pesage: 10, expiresInDays: 40 });
    empty = await createLot(fx, { ingredientId: farine, lotNumber: 'VIDE', pesage: 0, expiresInDays: 5, status: 'depleted' });
    const productId = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1, $2, 3) RETURNING id`, [`Cake G111 ${RUN}`, `cake-g111-${RUN}`])).rows[0].id;
    fx.ids.products.push(productId);
    productLot = (await p().query(
      `INSERT INTO product_lots (product_id, store_id, lot_number, quantity_total, backroom_qty, vitrine_qty, expires_at)
       VALUES ($1, $2, $3, 4, 4, 0, CURRENT_DATE + 2) RETURNING id`, [productId, fx.storeId, `G111-${RUN}`])).rows[0].id;   // 1 ou 2 jours : sous 7 ET sous 2
    managerId = (await p().query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, store_id) VALUES ($1, 'x', 'Gérante', 'G111', 'manager', $2) RETURNING id`,
      [`g111-${RUN}@test.local`, fx.storeId])).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    if (previous) await setParam(previous).catch(() => undefined);
    await p().query(`DELETE FROM lot_expiry_alerts WHERE lot_id = ANY($1)`, [[soon, far, empty, productLot]]).catch(() => undefined);
    await p().query(`DELETE FROM notifications WHERE store_id = $1`, [fx.storeId]).catch(() => undefined);
    await p().query(`DELETE FROM email_outbox WHERE to_email = $1`, [`g111-${RUN}@test.local`]).catch(() => undefined);
    await p().query(`DELETE FROM users WHERE id = $1`, [managerId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('premier passage : le lot sous 7 jours et le produit sous 2 jours sont signalés, une fois chacun', async () => {
    const run = await scheduler.runJob('dlc_alerts', 'manual');
    expect(run.status).toBe('ok');
    expect(await alerts(soon)).toEqual([7]);
    expect(await alerts(productLot)).toEqual([2, 7]);          // deux seuils franchis d'un coup…
    expect(await alerts(far)).toEqual([]);
    expect(await alerts(empty)).toEqual([]);
    const n = await notifications();
    expect(n.map(x => x.target_role).sort()).toEqual(['magasinier', 'manager']);   // …mais une seule notification par nature de lot
    expect(n.find(x => x.target_role === 'magasinier')!.message).toContain('Farine G111');
    expect(n.find(x => x.target_role === 'manager')!.title).toMatch(/1 lot de produit fini/);
  }, 120_000);

  it('second passage : rien de nouveau, aucune notification de plus', async () => {
    await scheduler.runJob('dlc_alerts', 'manual');
    expect(await alerts(soon)).toEqual([7]);
    expect(await notifications()).toHaveLength(2);
  }, 120_000);

  it('le lot passe sous 2 jours : nouvelle alerte pour ce seuil, e-mail aux responsables si demandé', async () => {
    await setParam({ days: [7, 2], email: true });
    await p().query(`UPDATE ingredient_lots SET expiration_date = CURRENT_DATE + 2 WHERE id = $1`, [soon]);
    await scheduler.runJob('dlc_alerts', 'manual');
    expect(await alerts(soon)).toEqual([2, 7]);
    expect(await notifications()).toHaveLength(3);
    const mails = (await p().query(`SELECT subject, body_text FROM email_outbox WHERE to_email = $1`, [`g111-${RUN}@test.local`])).rows;
    expect(mails).toHaveLength(1);
    expect(mails[0].body_text).toContain('Farine G111');
  }, 120_000);
});
