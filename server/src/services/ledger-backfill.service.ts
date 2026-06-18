/**
 * Service de backfill des ecritures comptables.
 *
 * Genere les ecritures pour les invoices / payments / sales deja en base
 * (donnees anterieures a l'activation du moteur). Idempotent : une ecriture
 * deja creee (meme source) n'est pas recreee.
 *
 * Utilise par :
 *   - le script CLI server/src/scripts/backfill-ledger.ts
 *   - l'endpoint admin POST /api/v1/ledger/backfill (declenchement depuis l'UI,
 *     pratique sur un deploiement Cloud Run sans acces shell).
 */

import { db } from '../config/database.js';
import {
  fromInvoice, fromSale, fromPaymentEmission, fromPaymentCashing, persistEntry,
  type InvoiceRow, type PaymentRow, type SaleRow,
} from './journal-generator.service.js';

export interface BackfillSummary {
  invoices: number;
  payments: number;
  cashings: number;
  sales: number;
  created: number;
  skipped: number;
  errors: number;
  errorSamples: string[];
}

/**
 * Lance le backfill complet en mode persistance. Chaque ecriture est creee dans
 * sa propre transaction pour isoler les erreurs.
 */
export async function runFullBackfill(userId: string): Promise<BackfillSummary> {
  const summary: BackfillSummary = {
    invoices: 0, payments: 0, cashings: 0, sales: 0,
    created: 0, skipped: 0, errors: 0, errorSamples: [],
  };

  const persistOne = async (entry: Awaited<ReturnType<typeof fromInvoice>>, label: string) => {
    if (!entry) return;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const r = await persistEntry(client, entry, { markAsBackfill: true, userId });
      await client.query('COMMIT');
      if (r.created) summary.created++; else summary.skipped++;
    } catch (err) {
      await client.query('ROLLBACK');
      summary.errors++;
      if (summary.errorSamples.length < 10) {
        summary.errorSamples.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      client.release();
    }
  };

  // ─── Factures ───
  const invoices = (await db.query(
    `SELECT id, invoice_number, invoice_type, supplier_id, customer_id, category_id,
            invoice_date::TEXT AS invoice_date, amount, tax_amount, total_amount, store_id, status
     FROM invoices WHERE status != 'cancelled'
     ORDER BY invoice_date, created_at`
  )).rows as unknown as InvoiceRow[];
  for (const inv of invoices) {
    try {
      const entry = await fromInvoice(db, inv);
      if (entry) { summary.invoices++; await persistOne(entry, `invoice ${inv.invoice_number}`); }
    } catch (err) {
      summary.errors++;
      if (summary.errorSamples.length < 10) summary.errorSamples.push(`invoice ${inv.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ─── Paiements (emission + encaissement) ───
  const payments = (await db.query(
    `SELECT id, reference, type, category_id, invoice_id, supplier_id, employee_id,
            amount, payment_method, payment_date::TEXT AS payment_date,
            cashed_at::TEXT AS cashed_at, description, store_id
     FROM payments ORDER BY payment_date, created_at`
  )).rows as unknown as PaymentRow[];
  for (const p of payments) {
    try {
      const emission = await fromPaymentEmission(db, p);
      if (emission) { summary.payments++; await persistOne(emission, `payment ${p.reference || p.id}`); }
      const cashing = fromPaymentCashing(p);
      if (cashing) { summary.cashings++; await persistOne(cashing, `cashing ${p.reference || p.id}`); }
    } catch (err) {
      summary.errors++;
      if (summary.errorSamples.length < 10) summary.errorSamples.push(`payment ${p.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ─── Ventes POS payees ───
  const sales = (await db.query(
    `SELECT id, sale_number, customer_id, subtotal, tax_amount, discount_amount, total,
            payment_method, payment_status,
            paid_at::TEXT AS paid_at, created_at::TEXT AS created_at, store_id
     FROM sales WHERE payment_status = 'paid'
     ORDER BY COALESCE(paid_at, created_at), created_at`
  )).rows as unknown as SaleRow[];
  for (const s of sales) {
    try {
      const entry = await fromSale(db, s);
      if (entry) { summary.sales++; await persistOne(entry, `sale ${s.sale_number}`); }
    } catch (err) {
      summary.errors++;
      if (summary.errorSamples.length < 10) summary.errorSamples.push(`sale ${s.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  return summary;
}
