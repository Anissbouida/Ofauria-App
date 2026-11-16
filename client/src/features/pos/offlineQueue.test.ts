/**
 * G0-21 — file hors-ligne de la caisse. Premier test du client.
 * Trois ventes dont la deuxième reçoit 400 : la première et la troisième passent,
 * la deuxième est dans « à traiter » avec son motif. Une panne arrête le rejeu sans
 * rien perdre ; une vente « à traiter » se renvoie ou s'abandonne avec un motif.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Stockage local simulé : le test tourne sans navigateur.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
});

const queue = await import('./offlineQueue');
const httpError = (status: number, message?: string, code?: string) => ({ response: { status, data: { error: { message, code } } } });
const sale = (key: string) => ({ idempotencyKey: key, items: [{ productId: 'p', quantity: 1 }], paymentMethod: 'cash' });

beforeEach(() => store.clear());

describe('File hors-ligne de la caisse (G0-21)', () => {
  it('trois ventes, la deuxième refusée (400) : les deux autres passent, la deuxième est à traiter', async () => {
    queue.enqueueCheckout(sale('a'), { total: 10 });
    queue.enqueueCheckout(sale('b'), { total: 20, summary: '2 croissants' });
    queue.enqueueCheckout(sale('c'), { total: 30 });
    const sent: string[] = [];
    const result = await queue.flushQueue(async p => {
      if (p.idempotencyKey === 'b') throw httpError(400, 'Caisse fermée', 'SESSION_CLOSED');
      sent.push(String(p.idempotencyKey));
    });
    expect(result).toEqual({ done: 2, rejected: 1 });
    expect(sent).toEqual(['a', 'c']);
    expect(queue.pendingCount()).toBe(0);
    const [rejected] = queue.rejectedList();
    expect(queue.rejectedCount()).toBe(1);
    expect(rejected).toMatchObject({ reason: 'Caisse fermée', status: 400, code: 'SESSION_CLOSED', meta: { total: 20, summary: '2 croissants' } });
    expect(rejected.payload.idempotencyKey).toBe('b');
  });

  it('panne réseau ou 5xx : le rejeu s\'arrête, rien n\'est perdu ni rejeté', async () => {
    queue.enqueueCheckout(sale('a'));
    queue.enqueueCheckout(sale('b'));
    queue.enqueueCheckout(sale('c'));
    const first = await queue.flushQueue(async p => { if (p.idempotencyKey === 'b') throw httpError(503); });
    expect(first).toEqual({ done: 1, rejected: 0 });
    expect(queue.pendingCount()).toBe(2);
    const second = await queue.flushQueue(async () => { throw Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }); });
    expect(second).toEqual({ done: 0, rejected: 0 });
    expect(queue.pendingCount()).toBe(2);
    expect(queue.rejectedCount()).toBe(0);
  });

  it('session expirée (401) : la vente reste en file, elle n\'est pas rejetée', async () => {
    queue.enqueueCheckout(sale('a'));
    expect(await queue.flushQueue(async () => { throw httpError(401); })).toEqual({ done: 0, rejected: 0 });
    expect(queue.pendingCount()).toBe(1);
  });

  it('toute vente en file porte une clé d\'idempotence, et n\'y entre qu\'une fois', () => {
    const key = queue.enqueueCheckout({ items: [], paymentMethod: 'cash' });
    expect(key).toBeTruthy();
    queue.enqueueCheckout(sale('x'));
    queue.enqueueCheckout(sale('x'));
    expect(queue.pendingCount()).toBe(2);
  });

  it('une vente à traiter se renvoie : elle repart dans la file avec la même clé', async () => {
    queue.enqueueCheckout(sale('b'), { total: 20 });
    await queue.flushQueue(async () => { throw httpError(409, 'Stock vitrine insuffisant'); });
    expect(queue.retryRejected('b')).toBe(true);
    expect(queue.rejectedCount()).toBe(0);
    expect(queue.pendingCount()).toBe(1);
    const sent: unknown[] = [];
    expect(await queue.flushQueue(async p => { sent.push(p.idempotencyKey); })).toEqual({ done: 1, rejected: 0 });
    expect(sent).toEqual(['b']);
  });

  it('une vente à traiter s\'abandonne avec un motif et reste dans le journal local', async () => {
    queue.enqueueCheckout(sale('b'), { total: 20 });
    await queue.flushQueue(async () => { throw httpError(400, 'Produit supprimé') });
    expect(queue.abandonRejected('b', 'Client parti sans payer')).toBe(true);
    expect(queue.rejectedCount()).toBe(0);
    expect(queue.pendingCount()).toBe(0);
    expect(queue.abandonedList()[0]).toMatchObject({ reason: 'Produit supprimé', abandonReason: 'Client parti sans payer', meta: { total: 20 } });
  });

  it('une file écrite avant G0-21 (payloads nus) est relue sans perte', async () => {
    store.set('pos-offline-checkouts', JSON.stringify([sale('old')]));
    expect(queue.pendingCount()).toBe(1);
    expect(await queue.flushQueue(async () => undefined)).toEqual({ done: 1, rejected: 0 });
  });
});
