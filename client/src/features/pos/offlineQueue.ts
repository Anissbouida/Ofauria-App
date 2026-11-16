// File d'attente hors-ligne de la caisse (phase 8.4, G0-21).
//
// Quand un checkout échoue à cause du réseau, son payload est mis en attente dans
// localStorage ; à la reconnexion il est rejoué. Chaque payload porte une clé
// d'idempotence, donc un rejeu (ou un double envoi) ne crée jamais deux ventes.
//
// G0-21 : une vente REFUSÉE par le serveur (4xx : caisse fermée, stock, promotion
// épuisée…) ne bloque plus les suivantes. Elle passe dans une seconde liste, « à
// traiter », avec le motif du refus ; le caissier la renvoie une fois la cause
// corrigée, ou l'abandonne avec un motif. Seule une panne (réseau, 5xx) arrête le rejeu.

const KEY = 'pos-offline-checkouts';
const REJECTED_KEY = 'pos-offline-rejected';
const ABANDONED_KEY = 'pos-offline-abandoned';
const ABANDONED_KEEP = 50;

export type QueuedCheckout = Record<string, unknown> & { idempotencyKey?: string };
/** Ce que le caissier doit pouvoir reconnaître sans le serveur : heure, total, contenu. */
export interface QueuedMeta { queuedAt: string; total?: number; summary?: string }
export interface RejectedCheckout { payload: QueuedCheckout; meta: QueuedMeta; reason: string; status?: number; code?: string; rejectedAt: string }
export interface AbandonedCheckout extends RejectedCheckout { abandonReason: string; abandonedAt: string }
interface Entry { payload: QueuedCheckout; meta: QueuedMeta }

function load<T>(key: string): T[] {
  try { return JSON.parse(localStorage.getItem(key) || '[]') as T[]; }
  catch { return []; }
}
function save(key: string, list: unknown[]) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* quota / privé : ignoré */ }
}
/** Les files écrites avant G0-21 contenaient le payload nu : on l'enveloppe à la lecture. */
function readQueue(): Entry[] {
  return load<Entry | QueuedCheckout>(KEY).map(e =>
    (e && typeof e === 'object' && 'payload' in e && 'meta' in e ? e as Entry : { payload: e as QueuedCheckout, meta: { queuedAt: '' } }));
}
const newKey = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `hl-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Met une vente en file. Retourne sa clé d'idempotence (créée si le payload n'en avait pas). */
export function enqueueCheckout(payload: QueuedCheckout, meta: Partial<QueuedMeta> = {}): string {
  const list = readQueue();
  // Sans clé, un rejeu pourrait créer deux ventes : toute vente en file en porte une.
  const key = payload.idempotencyKey || newKey();
  // Dédoublonnage par clé : un même checkout n'est mis en file qu'une fois.
  if (list.some(e => e.payload.idempotencyKey === key)) return key;
  list.push({ payload: { ...payload, idempotencyKey: key }, meta: { queuedAt: new Date().toISOString(), ...meta } });
  save(KEY, list);
  return key;
}

export function pendingCount(): number { return readQueue().length; }
export function rejectedList(): RejectedCheckout[] { return load<RejectedCheckout>(REJECTED_KEY); }
export function rejectedCount(): number { return rejectedList().length; }
export function abandonedList(): AbandonedCheckout[] { return load<AbandonedCheckout>(ABANDONED_KEY); }

/** Vrai si une erreur ressemble à une coupure réseau (pas de réponse serveur). */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const err = e as { response?: unknown; code?: string; message?: string };
  return !err?.response && (err?.code === 'ERR_NETWORK' || /network|timeout/i.test(err?.message || ''));
}

/** Refus définitif du serveur (4xx) : la vente ne passera pas telle quelle. Tout le reste se réessaie. */
function rejection(e: unknown): { reason: string; status: number; code?: string } | null {
  const res = (e as { response?: { status?: number; data?: { error?: { message?: string; code?: string } } } })?.response;
  const status = res?.status;
  if (!status || status < 400 || status >= 500) return null;
  // Session expirée ou trop de requêtes : rien à reprocher à la vente, on réessaiera.
  if (status === 401 || status === 408 || status === 429) return null;
  return { reason: res?.data?.error?.message || `Refusée par le serveur (${status})`, status, code: res?.data?.error?.code };
}

/**
 * Rejoue la file via `send`. Un envoi réussi sort de la file ; un refus du serveur (4xx)
 * passe dans la liste « à traiter » et le rejeu CONTINUE ; une panne (réseau, 5xx)
 * arrête le rejeu, le reste attend la prochaine tentative.
 */
export async function flushQueue(send: (p: QueuedCheckout) => Promise<unknown>): Promise<{ done: number; rejected: number }> {
  let done = 0, rejected = 0;
  for (const entry of readQueue()) {
    const key = entry.payload.idempotencyKey;
    const drop = () => save(KEY, readQueue().filter(x => x.payload.idempotencyKey !== key));
    try {
      await send(entry.payload);
      drop();
      done++;
    } catch (e) {
      const refused = rejection(e);
      if (!refused) break;            // panne : on garde le reste pour plus tard
      save(REJECTED_KEY, [...rejectedList().filter(r => r.payload.idempotencyKey !== key),
        { payload: entry.payload, meta: entry.meta, ...refused, rejectedAt: new Date().toISOString() }]);
      drop();
      rejected++;
    }
  }
  return { done, rejected };
}

/** Remet une vente « à traiter » dans la file (cause corrigée : caisse rouverte, stock saisi…). */
export function retryRejected(idempotencyKey: string): boolean {
  const item = rejectedList().find(r => r.payload.idempotencyKey === idempotencyKey);
  if (!item) return false;
  save(REJECTED_KEY, rejectedList().filter(r => r.payload.idempotencyKey !== idempotencyKey));
  const queue = readQueue();
  if (!queue.some(e => e.payload.idempotencyKey === idempotencyKey)) save(KEY, [...queue, { payload: item.payload, meta: item.meta }]);
  return true;
}

/** Abandonne une vente « à traiter », avec son motif ; elle reste consultable dans le journal local. */
export function abandonRejected(idempotencyKey: string, abandonReason: string): boolean {
  const item = rejectedList().find(r => r.payload.idempotencyKey === idempotencyKey);
  if (!item) return false;
  save(REJECTED_KEY, rejectedList().filter(r => r.payload.idempotencyKey !== idempotencyKey));
  save(ABANDONED_KEY, [...abandonedList(), { ...item, abandonReason, abandonedAt: new Date().toISOString() }].slice(-ABANDONED_KEEP));
  return true;
}
