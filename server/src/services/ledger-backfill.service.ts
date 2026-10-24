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
import { postGoodsReceiptsForPo } from './ledger-posting.service.js';
import {
  fromInvoice, fromSale, fromPaymentEmission, fromPaymentCashing, fromManualShiftEntry, persistEntry,
  regenerateInvoiceEntry, reverseEntriesForSource,
  type InvoiceRow, type PaymentRow, type SaleRow, type ShiftEntryRow,
} from './journal-generator.service.js';

export interface BackfillSummary {
  invoices: number;
  payments: number;
  cashings: number;
  sales: number;
  shiftEntries: number;
  created: number;
  skipped: number;
  resynced: number;
  errors: number;
  errorSamples: string[];
}

/**
 * Lance le backfill complet en mode persistance. Chaque ecriture est creee dans
 * sa propre transaction pour isoler les erreurs.
 */
export async function runFullBackfill(userId: string): Promise<BackfillSummary> {
  const summary: BackfillSummary = {
    invoices: 0, payments: 0, cashings: 0, sales: 0, shiftEntries: 0,
    created: 0, skipped: 0, resynced: 0, errors: 0, errorSamples: [],
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
  // Mig 311 : une pièce déjà comptabilisée (écriture active) n'est pas régénérée :
  // on ne recalcule même pas son écriture (un paramétrage devenu strict ne doit
  // pas faire échouer le rattrapage sur l'historique déjà posé).
  const active = new Set((await db.query(
    `SELECT DISTINCT source_id::text || '|' || COALESCE(source_detail, '') AS k FROM journal_entries
      WHERE status = 'posted' AND source_kind <> 'reversal' AND source_id IS NOT NULL`)).rows.map((r: { k: string }) => r.k));
  const isPosted = (id: string, detail = '') => active.has(`${id}|${detail}`);

  const invoices = (await db.query(
    `SELECT id, invoice_number, invoice_type, supplier_id, customer_id, category_id,
            invoice_date::TEXT AS invoice_date, amount, tax_amount, total_amount, store_id, status
     FROM invoices WHERE status != 'cancelled'
     ORDER BY invoice_date, created_at`
  )).rows as unknown as InvoiceRow[];
  for (const inv of invoices) {
    if (isPosted(inv.id)) { summary.skipped++; continue; }
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
            cashed_at::TEXT AS cashed_at, description, store_id,
            withholding_type_id, withholding_amount, payment_mode, treasury_account_id, to_treasury_account_id
     FROM payments
     -- Mig 310/311 : un paiement annulé (et sa contre-pièce) n'est jamais recomptabilisé.
     WHERE status <> 'void' AND voids_payment_id IS NULL
     ORDER BY payment_date, created_at`
  )).rows as unknown as PaymentRow[];
  for (const p of payments) {
    try {
      if (!isPosted(p.id)) {
        const emission = await fromPaymentEmission(db, p);
        if (emission) { summary.payments++; await persistOne(emission, `payment ${p.reference || p.id}`); }
      }
      const cashing = isPosted(p.id, 'cashing') ? null : fromPaymentCashing(p);
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

  // ─── Nettoyage : reverser les ecritures POS des jours ayant une saisie
  //     manuelle (la saisie manuelle est autoritaire, le POS ne doit pas
  //     comptabiliser le CA ces jours-la). Couvre les ecritures POS creees
  //     avant l'inversion du garde-fou. ───
  const posOnManualDays = (await db.query(
    `SELECT DISTINCT s.id
     FROM sales s
     JOIN manual_shift_entries m
       ON m.store_id = s.store_id
      AND m.entry_date = DATE(COALESCE(s.paid_at, s.created_at))
     WHERE s.payment_status = 'paid'
       AND EXISTS (SELECT 1 FROM journal_entries je
                   WHERE je.source_id = s.id AND je.source_kind IN ('sale','backfill') AND je.status != 'reversed')`
  )).rows as { id: string }[];
  for (const { id } of posOnManualDays) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await reverseEntriesForSource(client, { sourceId: id, sourceKinds: ['sale', 'backfill'] });
      await client.query('COMMIT');
      summary.resynced++;
    } catch (err) {
      await client.query('ROLLBACK');
      summary.errors++;
      if (summary.errorSamples.length < 10) summary.errorSamples.push(`pos-cleanup ${id}: ${err instanceof Error ? err.message : err}`);
    } finally {
      client.release();
    }
  }

  // ─── Ventes saisies manuellement par shift (matin/soir) ───
  // Mig 311 (G-D8-03) : retenues d'avances sur salaire (6171 D / 3431 C), jamais
  // comptabilisées tant que la CHECK source_kind les refusait.
  const repayments = (await db.query(
    `SELECT sr.id, sr.amount, sr.repayment_date::TEXT AS repayment_date,
            TRIM(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')) AS label
       FROM salary_advance_repayments sr
       JOIN salary_advances a ON a.id = sr.advance_id
       JOIN employees e ON e.id = a.employee_id
      ORDER BY sr.repayment_date`
  )).rows as { id: string; amount: string; repayment_date: string; label: string }[];
  for (const r of repayments) {
    const take = Math.round(parseFloat(r.amount) * 100) / 100;
    if (!(take > 0)) continue;
    await persistOne({
      journal_code: 'OD', entry_date: r.repayment_date,
      description: `Retenue avance sur salaire - ${r.label}`,
      source_kind: 'advance_repayment', source_id: r.id, store_id: null,
      lines: [
        { account_code: '6171', debit: take, credit: 0, label: `Salaire (part retenue avance) - ${r.label}` },
        { account_code: '3431', debit: 0, credit: take, label: `Remboursement avance - ${r.label}` },
      ],
    }, `retenue ${r.id}`);
  }

  // Mig 311 (G-D8-05) : réceptions des BC non encore facturés → GR/IR (4417).
  const uninvoicedPos = (await db.query(
    `SELECT DISTINCT rv.purchase_order_id AS id FROM reception_vouchers rv
      WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.status <> 'cancelled'
                          AND (i.purchase_order_id = rv.purchase_order_id
                               OR EXISTS (SELECT 1 FROM invoice_purchase_orders ipo WHERE ipo.invoice_id = i.id AND ipo.purchase_order_id = rv.purchase_order_id)))`
  )).rows as { id: string }[];
  for (const po of uninvoicedPos) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const n = await postGoodsReceiptsForPo(client, po.id, userId);
      await client.query('COMMIT');
      summary.created += n;
    } catch (err) {
      await client.query('ROLLBACK');
      summary.errors++;
      if (summary.errorSamples.length < 10) summary.errorSamples.push(`réception BC ${po.id}: ${err instanceof Error ? err.message : err}`);
    } finally {
      client.release();
    }
  }

  const shifts = (await db.query(
    `SELECT id, entry_date::TEXT AS entry_date, store_id,
            matin_cash_reel, matin_carte_reel, soir_cash_reel, soir_carte_reel
     FROM manual_shift_entries
     ORDER BY entry_date`
  )).rows as unknown as ShiftEntryRow[];
  for (const e of shifts) {
    try {
      const entry = await fromManualShiftEntry(db, e);
      if (entry) { summary.shiftEntries++; await persistOne(entry, `shift ${e.entry_date}`); }
    } catch (err) {
      summary.errors++;
      if (summary.errorSamples.length < 10) summary.errorSamples.push(`shift ${e.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ─── Resync des ecritures de factures DIVERGENTES ───
  // L'idempotence de persistEntry empeche de RECREER une ecriture existante :
  // utile, mais si la facture a ete MODIFIEE apres coup (montant/TVA corriges)
  // sans regeneration, l'ecriture reste figee sur l'ancien montant et le backfill
  // ne la corrige jamais (skip). C'est la cause des divergences "ledger != legacy"
  // avec ecriture presente. On regenere donc (extourne + recree depuis l'etat
  // actuel + re-lettre) toute facture signalee divergente par la vue de
  // reconciliation. v_reconciliation_check ne porte que les factures non annulees.
  const divergent = (await db.query(
    `SELECT invoice_id FROM v_reconciliation_check
     WHERE has_ledger_entries
       AND ABS(legacy_remaining - ledger_remaining) > 0.01`
  )).rows as { invoice_id: string }[];
  for (const { invoice_id } of divergent) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await regenerateInvoiceEntry(client, invoice_id, userId);
      await client.query('COMMIT');
      summary.resynced++;
    } catch (err) {
      await client.query('ROLLBACK');
      summary.errors++;
      if (summary.errorSamples.length < 10) {
        summary.errorSamples.push(`resync ${invoice_id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      client.release();
    }
  }

  return summary;
}
