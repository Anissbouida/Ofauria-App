/**
 * G0-21 (reste) — correction d'une vente hors ligne refusée avant renvoi, et remontée
 * des abandons au serveur (journal de la direction, mig 596).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
});

const queue = await import('./offlineQueue');
const httpError = (status: number, message?: string, code?: string) => ({ response: { status, data: { error: { message, code } } } });

/** Vente de 3 croissants (2 DH), 250 g de cake (40 DH/kg), payée en espèces, avec un code promo. */
const sale = (key: string, extra: Record<string, unknown> = {}) => ({
  idempotencyKey: key, paymentMethod: 'cash', couponCode: 'NOEL', discountAmount: 1,
  items: [{ productId: 'p-croissant', quantity: 3 }, { productId: 'p-cake', quantity: 250, displayUnit: 'g' }],
  ...extra,
});
const lines = [{ name: 'Croissant', price: 2, unit: 'unit' as const }, { name: 'Cake', price: 40, unit: 'g' as const }];

async function rejected(key: string, extra: Record<string, unknown> = {}, withLines = true) {
  queue.enqueueCheckout(sale(key, extra), { total: 15, summary: '3 × Croissant, 250 g × Cake', lines: withLines ? lines : undefined });
  await queue.flushQueue(async () => { throw httpError(409, 'Promotion épuisée', 'PROMOTION_EXHAUSTED'); });
  return queue.rejectedList().find(r => r.payload.idempotencyKey === key)!;
}

beforeEach(() => store.clear());

describe('Correction d\'une vente refusée (G0-21)', () => {
  it('retire une ligne, change une quantité et le paiement, retire le code promo, puis renvoie avec la même clé', async () => {
    await rejected('a');
    expect(queue.correctRejected('a', { items: [{ index: 0, quantity: 2 }], paymentMethod: 'card', removeCoupon: true })).toBeNull();
    const [r] = queue.rejectedList();
    expect(r.payload).toMatchObject({ idempotencyKey: 'a', paymentMethod: 'card', items: [{ productId: 'p-croissant', quantity: 2 }] });
    expect(r.payload.couponCode).toBeUndefined();
    expect(r.meta).toMatchObject({ total: 3, summary: '2 × Croissant', originalSummary: '3 × Croissant, 250 g × Cake', lines: [lines[0]] });
    expect(r.meta.correctedAt).toBeTruthy();

    expect(queue.retryRejected('a')).toBe(true);
    const sent: Record<string, unknown>[] = [];
    expect(await queue.flushQueue(async p => { sent.push(p); })).toEqual({ done: 1, rejected: 0 });
    expect(sent[0]).toMatchObject({ idempotencyKey: 'a', paymentMethod: 'card', items: [{ productId: 'p-croissant', quantity: 2 }] });
  });

  it('refuse une correction sans ligne, une quantité nulle ou des grammes non entiers', async () => {
    const r = await rejected('b');
    expect(queue.applyCorrection(r, { items: [] })).toMatchObject({ ok: false });
    expect(queue.applyCorrection(r, { items: [{ index: 0, quantity: 0 }] })).toMatchObject({ ok: false, error: expect.stringContaining('Croissant') });
    expect(queue.applyCorrection(r, { items: [{ index: 1, quantity: 12.5 }] })).toMatchObject({ ok: false, error: expect.stringContaining('grammes') });
    expect(queue.applyCorrection(r, { items: [{ index: 5, quantity: 1 }] })).toMatchObject({ ok: false, error: 'Ligne inconnue.' });
    // Rien n'est enregistré tant que la correction est invalide.
    expect(queue.correctRejected('b', { items: [] })).toBeTruthy();
    expect(queue.rejectedList()[0].payload.items).toHaveLength(2);
  });

  it('paiement mixte : les deux parts sont exigées et doivent faire le total estimé', async () => {
    const r = await rejected('c');
    expect(queue.applyCorrection(r, { items: [{ index: 0, quantity: 3 }, { index: 1, quantity: 250 }], paymentMethod: 'mixed' }))
      .toMatchObject({ ok: false, error: expect.stringContaining('part espèces') });
    // 3 × 2 + 250 g × 40/kg − 1 de remise = 15
    expect(queue.applyCorrection(r, { items: [{ index: 0, quantity: 3 }, { index: 1, quantity: 250 }], paymentMethod: 'mixed', cashAmount: 5, cardAmount: 5 }))
      .toMatchObject({ ok: false, error: expect.stringContaining('15.00') });
    const ok = queue.applyCorrection(r, { items: [{ index: 0, quantity: 3 }, { index: 1, quantity: 250 }], paymentMethod: 'mixed', cashAmount: 10, cardAmount: 5 });
    expect(ok).toMatchObject({ ok: true, payload: { paymentMethod: 'mixed', cashAmount: 10, cardAmount: 5 } });
    // Repasser en espèces efface la ventilation.
    const back = queue.applyCorrection({ ...r, payload: (ok as { payload: Record<string, unknown> }).payload }, { items: [{ index: 0, quantity: 3 }], paymentMethod: 'cash' });
    expect(back.ok && 'cashAmount' in back.payload).toBe(false);
  });

  it('refuse une remise supérieure au nouveau sous-total', async () => {
    const r = await rejected('d', { discountAmount: 5 });
    expect(queue.applyCorrection(r, { items: [{ index: 0, quantity: 1 }] })).toMatchObject({ ok: false, error: expect.stringContaining('remise') });
  });

  it('vente à crédit : le moyen de paiement ne se corrige pas', async () => {
    const r = await rejected('e', { paymentMethod: 'credit', paymentStatus: 'unpaid' });
    expect(queue.applyCorrection(r, { items: [{ index: 0, quantity: 3 }], paymentMethod: 'cash' })).toMatchObject({ ok: false });
    expect(queue.applyCorrection(r, { items: [{ index: 0, quantity: 3 }] })).toMatchObject({ ok: true, payload: { paymentMethod: 'credit' } });
  });

  it('vente mise en file sans prix connus (avant cette version) : total inconnu après correction', async () => {
    const r = await rejected('f', {}, false);
    const res = queue.applyCorrection(r, { items: [{ index: 0, quantity: 1 }] });
    expect(res).toMatchObject({ ok: true, meta: { summary: '1 × Article p-croiss' } });
    expect(res.ok && res.meta.total).toBeUndefined();
  });
});

describe('Remontée des abandons au serveur (G0-21, mig 596)', () => {
  it('envoie chaque abandon une fois, s\'arrête sur une panne et reprend ensuite', async () => {
    await rejected('a'); await rejected('b');
    queue.abandonRejected('a', 'Client parti');
    queue.abandonRejected('b', 'Doublon');
    expect(queue.unreportedAbandonedCount()).toBe(2);

    const down = await queue.reportAbandoned(async () => { throw Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }); });
    expect(down).toEqual({ reported: 0, failed: 0 });
    expect(queue.unreportedAbandonedCount()).toBe(2);

    const sent: Record<string, unknown>[] = [];
    expect(await queue.reportAbandoned(async r => { sent.push(r); })).toEqual({ reported: 2, failed: 0 });
    expect(sent[0]).toMatchObject({
      idempotencyKey: 'a', abandonReason: 'Client parti', rejectReason: 'Promotion épuisée', rejectStatus: 409,
      rejectCode: 'PROMOTION_EXHAUSTED', total: 15, payload: { idempotencyKey: 'a' },
    });
    expect(queue.unreportedAbandonedCount()).toBe(0);
    expect(await queue.reportAbandoned(async () => { throw new Error('ne doit pas être appelé'); })).toEqual({ reported: 0, failed: 0 });
  });

  it('un refus du serveur (4xx) est noté et ne bloque pas les suivants', async () => {
    await rejected('a'); await rejected('b');
    queue.abandonRejected('a', 'Client parti');
    queue.abandonRejected('b', 'Doublon');
    const res = await queue.reportAbandoned(async r => { if (r.idempotencyKey === 'a') throw httpError(400, 'Données invalides'); });
    expect(res).toEqual({ reported: 1, failed: 1 });
    expect(queue.abandonedList().find(a => a.payload.idempotencyKey === 'a')?.reportError).toBe('Données invalides');
    expect(queue.unreportedAbandonedCount()).toBe(0);
  });
});
