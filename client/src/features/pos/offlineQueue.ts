// File d'attente hors-ligne de la caisse (phase 8.4).
//
// Quand un checkout échoue à cause du réseau, son payload est mis en attente dans
// localStorage ; à la reconnexion il est rejoué. Chaque payload porte une clé
// d'idempotence, donc un rejeu (ou un double envoi) ne crée jamais deux ventes.

const KEY = 'pos-offline-checkouts';

export type QueuedCheckout = Record<string, unknown> & { idempotencyKey?: string };

function read(): QueuedCheckout[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') as QueuedCheckout[]; }
  catch { return []; }
}
function write(list: QueuedCheckout[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* quota / privé : ignoré */ }
}

export function enqueueCheckout(payload: QueuedCheckout) {
  const list = read();
  // Dédoublonnage par clé : un même checkout n'est mis en file qu'une fois.
  if (payload.idempotencyKey && list.some(p => p.idempotencyKey === payload.idempotencyKey)) return;
  list.push(payload);
  write(list);
}

export function pendingCount(): number {
  return read().length;
}

/** Rejoue la file via `send` ; retire chaque envoi réussi. S'arrête au premier échec. */
export async function flushQueue(send: (p: QueuedCheckout) => Promise<unknown>): Promise<number> {
  let done = 0;
  for (const p of read()) {
    try {
      await send(p);
      const rest = read().filter(x => x.idempotencyKey !== p.idempotencyKey);
      write(rest);
      done++;
    } catch {
      break; // toujours hors-ligne : on garde le reste pour plus tard
    }
  }
  return done;
}

/** Vrai si une erreur ressemble à une coupure réseau (pas de réponse serveur). */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const err = e as { response?: unknown; code?: string; message?: string };
  return !err?.response && (err?.code === 'ERR_NETWORK' || /network|timeout/i.test(err?.message || ''));
}
