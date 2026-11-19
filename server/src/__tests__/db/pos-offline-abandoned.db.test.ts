/**
 * G0-21 (reste, mig 596) — journal serveur des ventes hors ligne abandonnées.
 * L'abandon remonté par la caisse est enregistré une seule fois par clé d'idempotence,
 * avec le caissier et le magasin ; la direction le relit par magasin et par période ;
 * une vente passée malgré tout sous la même clé est signalée (sale_id).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, RUN, createBaseFixtures, type Fixtures } from './helpers.js';
import { offlineAbandonedSchema } from '../../validators/pos-offline.validator.js';

describe.skipIf(!hasTestDb)('Journal des ventes hors ligne abandonnées (G0-21)', () => {
  const p = () => testPool();
  let fx: Fixtures;
  let repo: typeof import('../../repositories/pos-offline-abandoned.repository.js').posOfflineAbandonedRepository;
  const keyA = `hl-a-${RUN}`;
  const keyB = `hl-b-${RUN}`;
  let saleId: string | null = null;

  const input = (key: string, extra: Record<string, unknown> = {}) => offlineAbandonedSchema.parse({
    idempotencyKey: key, queuedAt: '2026-11-18T08:00:00Z', rejectedAt: '2026-11-18T09:00:00Z', abandonedAt: '2026-11-18T09:05:00Z',
    total: 42.5, summary: '2 × Croissant', rejectReason: 'Caisse fermée', rejectStatus: 400, rejectCode: 'SESSION_CLOSED',
    abandonReason: 'Client reparti, vente encaissée en double', payload: { items: [{ productId: 'x', quantity: 2 }], paymentMethod: 'cash', idempotencyKey: key },
    ...extra,
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    repo = (await import('../../repositories/pos-offline-abandoned.repository.js')).posOfflineAbandonedRepository;
    fx = await createBaseFixtures();
  });

  afterAll(async () => {
    await p().query(`DELETE FROM pos_offline_abandoned_sales WHERE idempotency_key = ANY($1)`, [[keyA, keyB]]).catch(() => undefined);
    if (saleId) await p().query(`DELETE FROM sales WHERE id = $1`, [saleId]).catch(() => undefined);
    await p().query(`DELETE FROM users WHERE id = $1`, [fx.userId]).catch(() => undefined);
    await p().query(`DELETE FROM stores WHERE id = $1`, [fx.storeId]).catch(() => undefined);
    await closeTestPool();
  });

  it('refuse un abandon sans motif ou sans clé', () => {
    expect(offlineAbandonedSchema.safeParse({ ...input(keyA), abandonReason: ' ' }).success).toBe(false);
    expect(offlineAbandonedSchema.safeParse({ ...input(keyA), idempotencyKey: '' }).success).toBe(false);
  });

  it('enregistre l\'abandon une seule fois par clé, avec caissier et magasin', async () => {
    const first = await repo.record(input(keyA), { userId: fx.userId, storeId: fx.storeId });
    expect(first.created).toBe(true);
    expect(first.row).toMatchObject({ idempotency_key: keyA, store_id: fx.storeId, abandoned_by: fx.userId, reject_code: 'SESSION_CLOSED', sale_id: null });
    expect(Number(first.row.total)).toBe(42.5);
    expect(first.row.payload.paymentMethod).toBe('cash');

    const again = await repo.record(input(keyA, { abandonReason: 'Autre motif' }), { userId: fx.userId, storeId: fx.storeId });
    expect(again.created).toBe(false);
    expect(again.row.id).toBe(first.row.id);
    expect(again.row.abandon_reason).toBe('Client reparti, vente encaissée en double');
    const n = await p().query(`SELECT count(*)::int AS n FROM pos_offline_abandoned_sales WHERE idempotency_key = $1`, [keyA]);
    expect(n.rows[0].n).toBe(1);
  });

  it('signale une vente déjà enregistrée sous la même clé', async () => {
    const s = await p().query(
      `INSERT INTO sales (sale_number, user_id, subtotal, total, payment_method, store_id, idempotency_key)
       VALUES ($1, $2, 10, 10, 'cash', $3, $4) RETURNING id`, [`TST-${RUN}`, fx.userId, fx.storeId, keyB]);
    saleId = s.rows[0].id;
    const r = await repo.record(input(keyB), { userId: fx.userId, storeId: fx.storeId });
    expect(r.row.sale_id).toBe(saleId);
  });

  it('la direction relit par magasin et période', async () => {
    const mine = await repo.list({ storeId: fx.storeId, dateFrom: '2026-11-18', dateTo: '2026-11-18' });
    expect(mine.map(r => r.idempotency_key).sort()).toEqual([keyA, keyB].sort());
    expect(mine.find(r => r.idempotency_key === keyB)?.sale_number).toBe(`TST-${RUN}`);
    expect(mine[0].abandoned_by_name).toBe('Test Chef');
    const before = await repo.list({ storeId: fx.storeId, dateTo: '2026-11-17' });
    expect(before).toHaveLength(0);
  });
});
