import type { PoolClient } from 'pg';
import { db } from '../config/database.js';
import { FLAGS } from '../config/feature-flags.js';
import { invoiceRepository } from './accounting.repository.js';
import { postOrQueue } from '../services/ledger-posting.service.js';
import { fromPaymentEmission, fromAllocation, persistEntry, autoLettrer } from '../services/journal-generator.service.js';
import { withActor } from '../services/document-actions.service.js';

/**
 * Encaissements clients (O2C L5, mig 451). Un règlement — un chèque, un
 * virement — se répartit sur plusieurs factures du client (payment_allocations) ;
 * ce qui n'est affecté à aucune facture est une avance du client (4421), qui
 * s'affecte plus tard à une facture (écriture 4421 → 3421).
 *
 * Comme une ligne de commande répartie sur des lignes de livraison : le
 * règlement est l'en-tête (la trésorerie), les affectations sont les lignes.
 */

type Fail = Error & { statusCode?: number };
const fail = (statusCode: number, message: string): Fail => Object.assign(new Error(message), { statusCode });
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Verrouille une facture client du client et renvoie ce qui reste à régler. */
async function openInvoice(c: PoolClient, invoiceId: string, customerId: string) {
  const inv = (await c.query(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [invoiceId])).rows[0];
  if (!inv || inv.invoice_type !== 'emitted' || inv.kind === 'credit_note') throw fail(404, 'Facture client introuvable');
  if (inv.customer_id !== customerId) throw fail(400, `La facture ${inv.invoice_number} n'est pas à ce client`);
  if (inv.status === 'cancelled') throw fail(409, `Facture ${inv.invoice_number} annulée`);
  if (String(inv.currency_code ?? 'MAD').trim() !== 'MAD') throw fail(400, `Facture ${inv.invoice_number} en devise : réglez-la depuis la facture (taux du jour)`);
  return { inv, open: r2(Number(inv.total_amount) - Number(inv.paid_amount ?? 0)) };
}

export const customerReceiptRepository = {
  async create(p: {
    customerId: string; amount: number; paymentMethod: string; paymentDate: string; userId: string; storeId?: string | null;
    reference?: string | null; checkNumber?: string | null; checkDate?: string | null; treasuryAccountId?: string | null;
    description?: string | null; allocations: { invoiceId: string; amount: number }[];
  }) {
    const amount = r2(Number(p.amount));
    if (!(amount > 0)) throw fail(400, 'Montant invalide');
    if (p.paymentMethod === 'avoir') throw fail(400, 'Un avoir client s\'émet depuis la facture');
    const allocations = (p.allocations ?? []).map(a => ({ invoiceId: a.invoiceId, amount: r2(Number(a.amount)) })).filter(a => a.amount > 0);
    if (new Set(allocations.map(a => a.invoiceId)).size !== allocations.length) throw fail(400, 'Une facture apparaît deux fois');
    const allocated = r2(allocations.reduce((s, a) => s + a.amount, 0));
    if (allocated > amount + 0.005) throw fail(400, `Affecté (${allocated.toFixed(2)} DH) supérieur au règlement (${amount.toFixed(2)} DH)`);
    if ((p.paymentMethod === 'check' || p.paymentMethod === 'traite') && !p.checkNumber?.trim()) throw fail(400, 'Numéro du chèque ou de l\'effet requis');

    const c = await db.getClient();
    try {
      await c.query('BEGIN');
      await withActor(c, p.userId);
      const cust = (await c.query(`SELECT id FROM customers WHERE id = $1`, [p.customerId])).rows[0];
      if (!cust) throw fail(400, 'Client introuvable');
      for (const a of allocations) {
        const { inv, open } = await openInvoice(c, a.invoiceId, p.customerId);
        if (a.amount > open + 0.005) throw fail(409, `${a.amount.toFixed(2)} DH sur la facture ${inv.invoice_number} : il n'en reste que ${open.toFixed(2)} DH à régler`);
      }
      const pay = (await c.query(
        `INSERT INTO payments (reference, type, customer_id, amount, payment_method, payment_date, description, created_by, store_id,
                               check_number, check_date, treasury_account_id)
         VALUES ($1, 'income', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [p.reference?.trim() || null, p.customerId, amount, p.paymentMethod, p.paymentDate,
         p.description?.trim() || (allocations.length ? null : 'Avance client'), p.userId, p.storeId ?? null,
         p.checkNumber?.trim() || null, p.checkDate || null, p.treasuryAccountId || null])).rows[0];
      for (const a of allocations) {
        await c.query(
          `INSERT INTO payment_allocations (payment_id, invoice_id, amount, allocated_by) VALUES ($1, $2, $3, $4)`,
          [pay.id, a.invoiceId, a.amount, p.userId]);
      }
      if (FLAGS.LEDGER_AUTOGEN) {
        await postOrQueue(c, { kind: 'payment', id: pay.id }, async () => {
          const entry = await fromPaymentEmission(c, pay);
          if (entry) await persistEntry(c, entry, { userId: p.userId });
          for (const a of allocations) await autoLettrer(c, a.invoiceId);
        });
      }
      for (const a of allocations) await invoiceRepository.updatePaidAmount(a.invoiceId, c);
      await c.query('COMMIT');
      return { payment: pay, allocated, unapplied: r2(amount - allocated) };
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  },

  /** Affecte (une partie de) l'avance d'un règlement à une facture du même client. */
  async allocate(p: { paymentId: string; invoiceId: string; amount?: number | null; userId: string }) {
    const c = await db.getClient();
    try {
      await c.query('BEGIN');
      await withActor(c, p.userId);
      const pay = (await c.query(`SELECT * FROM payments WHERE id = $1 FOR UPDATE`, [p.paymentId])).rows[0];
      if (!pay || pay.type !== 'income' || !pay.customer_id || pay.credit_note_id) throw fail(404, 'Règlement client introuvable');
      if (pay.status === 'void' || pay.voids_payment_id) throw fail(409, 'Règlement annulé');
      const used = Number((await c.query(`SELECT COALESCE(SUM(amount), 0) AS v FROM payment_allocations WHERE payment_id = $1`, [pay.id])).rows[0].v);
      const unapplied = r2(Number(pay.settled_amount ?? pay.amount) - used);
      const { inv, open } = await openInvoice(c, p.invoiceId, pay.customer_id);
      const take = r2(Math.min(unapplied, open, p.amount ?? Infinity));
      if (take <= 0.005) throw fail(409, unapplied <= 0.005 ? 'Ce règlement est déjà entièrement affecté' : `La facture ${inv.invoice_number} est déjà réglée`);
      const alloc = (await c.query(
        `INSERT INTO payment_allocations (payment_id, invoice_id, amount, posted_with_payment, allocated_by)
         VALUES ($1, $2, $3, false, $4) RETURNING id`, [pay.id, inv.id, take, p.userId])).rows[0];
      if (FLAGS.LEDGER_AUTOGEN) {
        await postOrQueue(c, { kind: 'payment', id: pay.id, detail: `alloc:${alloc.id}` }, async () => {
          const entry = await fromAllocation(c, alloc.id);
          if (entry) await persistEntry(c, entry, { userId: p.userId });
          await autoLettrer(c, inv.id);
        });
      }
      await invoiceRepository.updatePaidAmount(inv.id, c);
      await c.query('COMMIT');
      return { allocated: take, unapplied: r2(unapplied - take) };
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  },

  /** Règlements d'un client avec leurs affectations et leur reste non affecté (avances). */
  async list(customerId: string) {
    const rows = (await db.query(
      `SELECT p.id, p.reference, p.payment_method, p.payment_date::text AS payment_date, p.check_number, p.status,
              COALESCE(p.settled_amount, p.amount)::float8 AS amount,
              COALESCE((SELECT SUM(a.amount) FROM payment_allocations a WHERE a.payment_id = p.id), 0)::float8 AS allocated,
              COALESCE((SELECT json_agg(json_build_object('invoice_id', a.invoice_id, 'invoice_number', i.invoice_number, 'amount', a.amount::float8)
                                        ORDER BY a.allocated_at)
                          FROM payment_allocations a JOIN invoices i ON i.id = a.invoice_id WHERE a.payment_id = p.id), '[]'::json) AS allocations
         FROM payments p
        WHERE p.customer_id = $1 AND p.type = 'income' AND p.credit_note_id IS NULL AND p.voids_payment_id IS NULL AND p.status <> 'void'
        ORDER BY p.payment_date DESC, p.created_at DESC LIMIT 200`, [customerId])).rows;
    return rows.map((r: Record<string, any>) => ({ ...r, unapplied: r2(r.amount - r.allocated) }));
  },
};
