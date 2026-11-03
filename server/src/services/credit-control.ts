/**
 * Contrôle de crédit client (O2C L3, mig 443) : un seul encours
 * (fn_customer_exposure) et une décision tracée à chaque jalon.
 *
 *   - création et confirmation de commande, ticket à crédit : selon le
 *     paramètre « Plafond de crédit » (alerte ou bloquant) ;
 *   - expédition (BL) : toujours bloquant, là où la marchandise sort ;
 *     la direction peut déroger en motivant (décision « override »).
 * Un client bloqué par une relance ou par la direction (credit_hold) est
 * refusé partout, sauf dérogation à l'expédition.
 */
import type { PoolClient } from 'pg';
import { db } from '../config/database.js';
import { dunningSettings } from '../repositories/dunning.repository.js';

type Runner = PoolClient | typeof db;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const n2 = (n: number) => r2(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type Checkpoint = 'create' | 'confirm' | 'ship' | 'sale';
export type CreditDecision = { decision: 'pass' | 'warn' | 'block' | 'override'; message: string | null; exposure: number; limit: number | null; onHold: boolean };

export async function customerExposure(c: Runner, customerId: string, excludeOrderId: string | null = null) {
  return Number((await c.query(`SELECT fn_customer_exposure($1, $2) AS e`, [customerId, excludeOrderId])).rows[0].e);
}

/** Décision pure à partir de l'encours (testable sans base). */
export function decide(p: { exposureAfter: number; limit: number | null; onHold: boolean; holdReason?: string | null; blocking: boolean; override?: boolean }): Omit<CreditDecision, 'exposure' | 'limit' | 'onHold'> {
  let message: string | null = null;
  if (p.onHold) message = `Client bloqué : achats à crédit suspendus${p.holdReason ? ` (${p.holdReason})` : ''}.`;
  else if (p.limit != null && p.limit > 0 && p.exposureAfter > p.limit + 0.005) {
    message = `Plafond de crédit dépassé : ${n2(p.exposureAfter)} DH engagés pour un plafond de ${n2(p.limit)} DH.`;
  }
  if (!message) return { decision: 'pass', message: null };
  if (p.override) return { decision: 'override', message };
  return { decision: p.blocking || p.onHold ? 'block' : 'warn', message };
}

/**
 * Contrôle à un jalon. `amount` = montant nouveau qui s'ajoute à l'encours (0
 * quand la pièce y figure déjà, ex. BL d'une commande ouverte). Journalise la
 * décision (sauf « pass » sans plafond).
 */
export async function checkCredit(c: Runner, p: {
  customerId: string; amount: number; checkpoint: Checkpoint;
  documentType: 'order' | 'quote' | 'delivery_note' | 'sale'; documentId?: string | null;
  excludeOrderId?: string | null; override?: { userId: string; reason: string } | null;
}): Promise<CreditDecision> {
  const cust = (await c.query(`SELECT credit_limit, credit_hold, credit_hold_reason FROM customers WHERE id = $1`, [p.customerId])).rows[0];
  if (!cust) return { decision: 'pass', message: null, exposure: 0, limit: null, onHold: false };
  const limit = cust.credit_limit != null && Number(cust.credit_limit) > 0 ? Number(cust.credit_limit) : null;
  const exposure = await customerExposure(c, p.customerId, p.excludeOrderId ?? null);
  const blocking = p.checkpoint === 'ship' || (await dunningSettings()).credit_control === 'block';
  const override = !!p.override && p.checkpoint === 'ship' && p.override.reason.trim().length >= 3;
  const d = decide({ exposureAfter: r2(exposure + p.amount), limit, onHold: !!cust.credit_hold, holdReason: cust.credit_hold_reason, blocking, override });
  if (d.decision !== 'pass' || limit != null) {
    // Un refus annule la pièce (rollback de l'appelant) : il est journalisé hors de sa
    // transaction (à la manière d'une transaction autonome Oracle), sans lien vers la
    // pièce qui n'existera pas — sauf à la confirmation, où la commande existe déjà.
    const blocked = d.decision === 'block';
    const docId = blocked && p.checkpoint !== 'confirm' ? null : p.documentId ?? null;
    await (blocked ? db : c).query(
      `INSERT INTO credit_check_events (customer_id, document_type, document_id, checkpoint, exposure, amount, credit_limit, on_hold, decision, decided_by, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [p.customerId, p.documentType, docId, p.checkpoint, r2(exposure + p.amount), r2(p.amount), limit, !!cust.credit_hold,
       d.decision, override ? p.override!.userId : null, override ? p.override!.reason.trim() : null]);
  }
  return { ...d, exposure: r2(exposure + p.amount), limit, onHold: !!cust.credit_hold };
}
