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
// Avant renvoi, le contenu se corrige (quantités, lignes retirées, moyen de paiement,
// code promo) ; chaque abandon remonte au serveur, journal consulté par la direction (mig 596).

const KEY = 'pos-offline-checkouts';
const REJECTED_KEY = 'pos-offline-rejected';
const ABANDONED_KEY = 'pos-offline-abandoned';
const ABANDONED_KEEP = 50;

export type QueuedCheckout = Record<string, unknown> & { idempotencyKey?: string };
/** Libellé et prix d'une ligne, alignés par position sur `payload.items` (correction avant renvoi). */
export interface QueuedLine { name: string; price?: number; unit?: 'unit' | 'g' | 'person' }
/** Ce que le caissier doit pouvoir reconnaître sans le serveur : heure, total, contenu. */
export interface QueuedMeta {
  queuedAt: string; total?: number; summary?: string;
  lines?: QueuedLine[];
  /** Vente corrigée avant renvoi : date de la dernière correction et contenu d'origine. */
  correctedAt?: string; originalSummary?: string;
}
export interface RejectedCheckout { payload: QueuedCheckout; meta: QueuedMeta; reason: string; status?: number; code?: string; rejectedAt: string }
export interface AbandonedCheckout extends RejectedCheckout {
  abandonReason: string; abandonedAt: string;
  /** Remonté au serveur (journal de la direction, mig 596). Absent : encore à envoyer. */
  reportedAt?: string;
  /** Remontée refusée définitivement par le serveur (4xx) : on n'insiste plus. */
  reportError?: string;
}
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
  save(ABANDONED_KEY, trimAbandoned([...abandonedList(), { ...item, abandonReason, abandonedAt: new Date().toISOString() }]));
  return true;
}

/** Garde les 50 derniers abandons, plus tous ceux qui ne sont pas encore remontés au serveur. */
function trimAbandoned(list: AbandonedCheckout[]): AbandonedCheckout[] {
  const keepFrom = Math.max(0, list.length - ABANDONED_KEEP);
  return list.filter((a, i) => i >= keepFrom || (!a.reportedAt && !a.reportError));
}

/** Ce que la caisse envoie au serveur pour un abandon (POST /sales/offline-abandoned). */
export function abandonReport(a: AbandonedCheckout) {
  return {
    idempotencyKey: String(a.payload.idempotencyKey),
    queuedAt: a.meta.queuedAt || null,
    rejectedAt: a.rejectedAt || null,
    abandonedAt: a.abandonedAt,
    total: typeof a.meta.total === 'number' && Number.isFinite(a.meta.total) && a.meta.total >= 0 ? a.meta.total : null,
    summary: a.meta.summary ? a.meta.summary.slice(0, 300) : null,
    rejectReason: (a.reason || 'Refusée par le serveur').slice(0, 500),
    rejectStatus: a.status ?? null,
    rejectCode: a.code ?? null,
    abandonReason: a.abandonReason,
    payload: a.payload,
  };
}

/**
 * Remonte au serveur les abandons pas encore transmis (journal de la direction, G0-21).
 * Même règle que la file : panne (réseau, 5xx, 401…) = on arrête et on réessaiera ;
 * refus (4xx) = on note le motif et on passe au suivant. Le serveur dédoublonne par clé.
 */
export async function reportAbandoned(send: (report: ReturnType<typeof abandonReport>) => Promise<unknown>): Promise<{ reported: number; failed: number }> {
  let reported = 0, failed = 0;
  for (const a of abandonedList().filter(x => !x.reportedAt && !x.reportError)) {
    const key = a.payload.idempotencyKey;
    const mark = (patch: Partial<AbandonedCheckout>) =>
      save(ABANDONED_KEY, abandonedList().map(x => (x.payload.idempotencyKey === key && x.abandonedAt === a.abandonedAt ? { ...x, ...patch } : x)));
    try {
      await send(abandonReport(a));
      mark({ reportedAt: new Date().toISOString() });
      reported++;
    } catch (e) {
      const refused = rejection(e);
      if (!refused) break;
      mark({ reportError: refused.reason });
      failed++;
    }
  }
  return { reported, failed };
}

export function unreportedAbandonedCount(): number { return abandonedList().filter(a => !a.reportedAt && !a.reportError).length; }

// ─── Correction d'une vente refusée avant renvoi ─────────────────────────────

/** Moyens de paiement qu'on peut choisir en corrigeant (« credit » est le marqueur d'une vente non encaissée). */
export const CORRECTABLE_PAYMENTS = ['cash', 'card', 'mobile', 'check', 'mixed'] as const;
export type CorrectablePayment = typeof CORRECTABLE_PAYMENTS[number];

export interface CheckoutCorrection {
  /** Lignes gardées (index dans `payload.items`) avec leur nouvelle quantité ; une ligne absente est retirée. */
  items: { index: number; quantity: number }[];
  /** Nouveau moyen de paiement (vente encaissée seulement). */
  paymentMethod?: CorrectablePayment;
  cashAmount?: number;
  cardAmount?: number;
  /** Retire le code promo (cas typique : promotion épuisée). */
  removeCoupon?: boolean;
}

type SaleItem = { productId?: string; quantity?: number; displayUnit?: string } & Record<string, unknown>;
const round2 = (n: number) => Math.round(n * 100) / 100;
const lineLabel = (l: QueuedLine | undefined, item: SaleItem) => {
  const name = l?.name || `Article ${String(item.productId ?? '').slice(0, 8)}`;
  const q = Number(item.quantity);
  return l?.unit === 'g' ? `${q} g × ${name}` : l?.unit === 'person' ? `${q} pers × ${name}` : `${q} × ${name}`;
};
const lineAmount = (l: QueuedLine | undefined, q: number) =>
  (l?.price == null ? null : l.unit === 'g' ? (q / 1000) * l.price : l.price * q);

/**
 * Applique une correction à une vente refusée, sans rien enregistrer (fonction pure).
 * Contrôle ce que le serveur refuserait sûrement (aucune ligne, quantité nulle, paiement
 * mixte incomplet, remise supérieure au nouveau sous-total) ; le reste (stock, promotion,
 * caisse) sera revérifié par le serveur au renvoi. La clé d'idempotence est GARDÉE : le
 * serveur a refusé la vente, aucune vente n'existe sous cette clé, et la référence
 * provisoire imprimée sur le ticket du client reste la même.
 */
export function applyCorrection(item: RejectedCheckout, c: CheckoutCorrection):
  { ok: true; payload: QueuedCheckout; meta: QueuedMeta } | { ok: false; error: string } {
  const items = (Array.isArray(item.payload.items) ? item.payload.items : []) as SaleItem[];
  const lines = item.meta.lines;
  if (c.items.length === 0) return { ok: false, error: 'Gardez au moins une ligne (ou abandonnez la vente).' };
  const seen = new Set<number>();
  const kept: { item: SaleItem; line?: QueuedLine }[] = [];
  for (const { index, quantity } of c.items) {
    if (!Number.isInteger(index) || index < 0 || index >= items.length || seen.has(index)) return { ok: false, error: 'Ligne inconnue.' };
    seen.add(index);
    const line = lines?.[index];
    const label = line?.name || `ligne ${index + 1}`;
    if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, error: `Quantité invalide pour ${label}.` };
    if (quantity > 100000) return { ok: false, error: `Quantité trop élevée pour ${label}.` };
    if ((line?.unit === 'g' || line?.unit === 'person' || line?.unit === 'unit') && !Number.isInteger(quantity)) {
      return { ok: false, error: `Quantité entière attendue pour ${label}${line?.unit === 'g' ? ' (en grammes)' : ''}.` };
    }
    kept.push({ item: { ...items[index], quantity }, line });
  }

  const payload: QueuedCheckout = { ...item.payload, items: kept.map(k => k.item) };
  const unpaid = item.payload.paymentStatus === 'unpaid';
  if (c.paymentMethod && c.paymentMethod !== item.payload.paymentMethod) {
    if (unpaid) return { ok: false, error: 'Vente non encaissée : le moyen de paiement ne se corrige pas.' };
    if (!(CORRECTABLE_PAYMENTS as readonly string[]).includes(c.paymentMethod)) return { ok: false, error: 'Moyen de paiement invalide.' };
    payload.paymentMethod = c.paymentMethod;
  }
  if (!unpaid && payload.paymentMethod === 'mixed') {
    const cash = c.cashAmount ?? (payload.cashAmount as number | undefined);
    const card = c.cardAmount ?? (payload.cardAmount as number | undefined);
    if (cash == null || card == null || !Number.isFinite(cash) || !Number.isFinite(card) || cash < 0 || card < 0) {
      return { ok: false, error: 'Paiement mixte : saisissez la part espèces et la part carte.' };
    }
    payload.cashAmount = round2(cash);
    payload.cardAmount = round2(card);
  } else {
    delete payload.cashAmount;
    delete payload.cardAmount;
  }
  if (c.removeCoupon) delete payload.couponCode;

  // Sous-total estimé quand les prix sont connus (ventes mises en file depuis cette version) ;
  // le serveur recalcule le vrai total (promotions comprises) au renvoi.
  const amounts = kept.map(k => lineAmount(k.line, Number(k.item.quantity)));
  let total: number | undefined = item.meta.total;
  if (amounts.every(a => a != null)) {
    const subtotal = round2((amounts as number[]).reduce((s, a) => s + a, 0));
    const discount = Number(payload.discountAmount) || 0;
    if (discount > subtotal) return { ok: false, error: `La remise (${discount.toFixed(2)}) dépasse le nouveau sous-total (${subtotal.toFixed(2)}).` };
    total = round2(subtotal - discount);
  } else if (kept.length !== items.length || kept.some((k, i) => Number(k.item.quantity) !== Number(items[i]?.quantity))) {
    total = undefined;   // contenu changé sans prix connus : total inconnu jusqu'au renvoi
  }
  if (!unpaid && payload.paymentMethod === 'mixed' && total != null
      && Math.abs(round2(Number(payload.cashAmount) + Number(payload.cardAmount)) - total) > 0.01) {
    return { ok: false, error: `Paiement mixte : espèces + carte doivent faire ${total.toFixed(2)}.` };
  }

  const meta: QueuedMeta = {
    ...item.meta,
    total,
    lines: lines ? kept.map(k => k.line ?? { name: '' }) : undefined,
    summary: kept.map(k => lineLabel(k.line, k.item)).join(', ').slice(0, 200),
    originalSummary: item.meta.originalSummary ?? item.meta.summary,
    correctedAt: new Date().toISOString(),
  };
  return { ok: true, payload, meta };
}

/** Corrige une vente « à traiter » (elle y reste jusqu'au renvoi). Retourne un message d'erreur, ou null. */
export function correctRejected(idempotencyKey: string, c: CheckoutCorrection): string | null {
  const list = rejectedList();
  const item = list.find(r => r.payload.idempotencyKey === idempotencyKey);
  if (!item) return 'Vente introuvable (déjà renvoyée ou abandonnée ?)';
  const res = applyCorrection(item, c);
  if (!res.ok) return res.error;
  save(REJECTED_KEY, list.map(r => (r.payload.idempotencyKey === idempotencyKey ? { ...r, payload: res.payload, meta: res.meta } : r)));
  return null;
}
