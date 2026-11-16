/**
 * G0-20 — compteur d'utilisation des promotions.
 * Deux ventes concurrentes sur une promotion à une utilisation restante : une seule
 * l'obtient, l'autre est annulée en entier (« promotion épuisée »). Une promotion sans
 * maximum n'est jamais refusée ; la conversion d'un devis décompte sans refuser.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, TEST_DATABASE_URL, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Utilisation des promotions, décompte atomique (G0-20)', () => {
  const p = () => testPool();
  let saleRepository: typeof import('../../repositories/sale.repository.js')['saleRepository'];
  let promotions: typeof import('../../services/promotions.js');
  let database: typeof import('../../config/database.js');
  let storeId: string, userId: string, productId: string;
  const promoIds: string[] = [];

  const promo = async (maxUses: number | null, usesCount = 0) => {
    const id = (await p().query(
      `INSERT INTO promotions (name, target, kind, value, max_uses, uses_count) VALUES ($1, 'cart', 'percent', 10, $2, $3) RETURNING id`,
      [`Promo G020 ${RUN} ${promoIds.length}`, maxUses, usesCount])).rows[0].id as string;
    promoIds.push(id);
    return id;
  };
  const uses = async (id: string) => Number((await p().query(`SELECT uses_count FROM promotions WHERE id = $1`, [id])).rows[0].uses_count);
  const sale = (promotionId: string) => saleRepository.create({
    userId, storeId, subtotal: 100, taxAmount: 0, discountAmount: 10, total: 90,
    paymentMethod: 'cash', paymentStatus: 'paid', skipStockDeduction: true,
    promotionAmount: 10, appliedPromotions: [{ promotionId, label: 'Promo G020', amount: 10 }],
    items: [{ productId, quantity: 1, unitPrice: 100, subtotal: 100 }],
  });
  const salesWith = async (id: string) => Number((await p().query(
    `SELECT count(*) AS n FROM document_promotions WHERE promotion_id = $1 AND sale_id IS NOT NULL`, [id])).rows[0].n);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789abcdef';
    database = await import('../../config/database.js');
    ({ saleRepository } = await import('../../repositories/sale.repository.js'));
    promotions = await import('../../services/promotions.js');
    storeId = (await p().query(`INSERT INTO stores (name, city) VALUES ($1, 'Test') RETURNING id`, [`Mag G020 ${RUN}`])).rows[0].id;
    userId = (await p().query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, store_id) VALUES ($1, 'x', 'Test', 'G020', 'admin', $2) RETURNING id`,
      [`g020-${RUN}@test.local`, storeId])).rows[0].id;
    productId = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1, $2, 100) RETURNING id`, [`Gâteau G020 ${RUN}`, `gateau-g020-${RUN}`])).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM sales WHERE store_id = $1`, [storeId]).catch(() => undefined);
    await p().query(`DELETE FROM promotions WHERE id = ANY($1)`, [promoIds]).catch(() => undefined);
    await p().query(`DELETE FROM products WHERE id = $1`, [productId]).catch(() => undefined);
    await p().query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
    await p().query(`DELETE FROM stores WHERE id = $1`, [storeId]).catch(() => undefined);
    await database.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('deux ventes concurrentes, une utilisation restante : une seule obtient la promotion', async () => {
    const id = await promo(1);
    const results = await Promise.allSettled([sale(id), sale(id)]);
    const ok = results.filter(r => r.status === 'fulfilled');
    const ko = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(1);
    expect(ko[0].reason).toMatchObject({ statusCode: 409, code: 'PROMOTION_EXHAUSTED' });
    expect(await uses(id)).toBe(1);
    expect(await salesWith(id)).toBe(1);          // la vente refusée est annulée en entier
  }, 60_000);

  it('promotion déjà épuisée : la vente suivante est refusée, le compteur ne bouge pas', async () => {
    const id = await promo(3, 3);
    await expect(sale(id)).rejects.toMatchObject({ code: 'PROMOTION_EXHAUSTED' });
    expect(await uses(id)).toBe(3);
  });

  it('promotion sans maximum : jamais refusée', async () => {
    const id = await promo(null);
    await Promise.all([sale(id), sale(id), sale(id)]);
    expect(await uses(id)).toBe(3);
  }, 60_000);

  it('conversion d\'un devis : décompte sans refus, le prix promis est tenu', async () => {
    const id = await promo(1, 1);
    const s = await sale(await promo(null));
    await promotions.recordApplied(database.db, { saleId: s.id }, [{ promotionId: id, label: 'Promo devis', amount: 10 }], true, false);
    expect(await uses(id)).toBe(2);
  });
});
