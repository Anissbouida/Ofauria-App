import { WEBHOOK_EVENTS_LIST, type WebhookEvent } from '@ofauria/shared';
import { db } from '../config/database.js';
import { webhookRepository } from '../repositories/webhook.repository.js';
import { logger } from '../utils/logger.js';

/**
 * Émission d'un événement métier vers les webhooks abonnés (G6-08). Met une livraison en
 * file par point abonné, dans la transaction de l'appelant si un client est fourni ; ne fait
 * JAMAIS échouer l'action métier (un incident d'émission est seulement journalisé).
 *
 * Dans une transaction, l'émission est isolée par un point de sauvegarde : une erreur SQL
 * pendant la mise en file n'avorte pas la transaction de l'appelant (sinon son COMMIT
 * deviendrait silencieusement un ROLLBACK). Annulée avec la transaction, la livraison
 * disparaît avec elle : aucun événement pour une action qui n'a pas eu lieu.
 */
type Runner = Parameters<typeof webhookRepository.enqueue>[2];

export async function emitEvent(event: WebhookEvent, data: Record<string, unknown>, runner?: Runner): Promise<void> {
  if (!WEBHOOK_EVENTS_LIST.includes(event)) return;
  const tx = runner && runner !== db ? runner : null;
  let savepoint = false;
  if (tx) {
    // Hors transaction, SAVEPOINT est refusé sans conséquence : on émet alors sans filet.
    try { await tx.query('SAVEPOINT kalum_emit_event'); savepoint = true; } catch { savepoint = false; }
  }
  try {
    await webhookRepository.enqueue(event, { event, occurred_at: new Date().toISOString(), data }, runner);
    if (savepoint) await tx!.query('RELEASE SAVEPOINT kalum_emit_event');
  } catch (err) {
    if (savepoint) {
      await tx!.query('ROLLBACK TO SAVEPOINT kalum_emit_event').catch(() => undefined);
      await tx!.query('RELEASE SAVEPOINT kalum_emit_event').catch(() => undefined);
    }
    logger.error({ err: err instanceof Error ? err.message : err }, `[webhook] émission ${event} impossible :`);
  }
}

/** Date SQL (lue en minuit local par pg) → AAAA-MM-JJ sans décalage de fuseau. */
function isoDay(v: unknown): string | null {
  if (v == null) return null;
  if (!(v instanceof Date)) return String(v).slice(0, 10);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
}

/** Charge utile commune des événements de facture (une ligne de `invoices`). */
export function invoiceEventData(inv: Record<string, any>): Record<string, unknown> {
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    invoice_id: inv.id,
    invoice_number: inv.invoice_number,
    invoice_type: inv.invoice_type,
    kind: inv.kind ?? 'invoice',
    customer_id: inv.customer_id ?? null,
    supplier_id: inv.supplier_id ?? null,
    order_id: inv.order_id ?? null,
    credited_invoice_id: inv.credited_invoice_id ?? null,
    credit_reason: inv.credit_reason ?? null,
    invoice_date: isoDay(inv.invoice_date),
    amount: num(inv.amount),
    tax_amount: num(inv.tax_amount),
    total_amount: num(inv.total_amount),
    paid_amount: num(inv.paid_amount),
    currency_code: inv.currency_code ?? null,
    status: inv.status ?? null,
  };
}
