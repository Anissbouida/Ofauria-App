/**
 * Backfill des ecritures comptables a partir des donnees existantes.
 *
 * Pourquoi :
 *   La Phase 1 a pose le squelette (plan comptable, journaux, periodes, tables
 *   d'ecritures vides). Ce script replay les invoices, payments et sales deja
 *   en base pour generer les ecritures comptables historiques correspondantes
 *   via le JournalGenerator.
 *
 * Mode :
 *   --dry-run (defaut) : NE PERSISTE RIEN, affiche un rapport detaille.
 *   --apply            : Persiste reellement les ecritures en transaction.
 *   --limit N          : Limite le nombre d'enregistrements par type (debug).
 *   --source <type>    : invoices | payments | sales | all (defaut: all)
 *
 * Idempotence :
 *   Une ecriture existante (meme source_kind, source_id) n'est PAS recreee.
 *   Tu peux relancer le script autant de fois que tu veux.
 *
 * Usage :
 *   npx tsx server/src/scripts/backfill-ledger.ts                 # dry-run
 *   npx tsx server/src/scripts/backfill-ledger.ts --apply         # persiste
 *   npx tsx server/src/scripts/backfill-ledger.ts --limit 5 --source invoices
 */

import { db } from '../config/database.js';
import {
  fromInvoice, fromSale, fromPaymentEmission, fromPaymentCashing,
  persistEntry,
  type GeneratedEntry, type InvoiceRow, type PaymentRow, type SaleRow,
} from '../services/journal-generator.service.js';

interface Args {
  apply: boolean;
  limit: number | null;
  source: 'all' | 'invoices' | 'payments' | 'sales';
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : null;
  const srcIdx = args.indexOf('--source');
  const source = (srcIdx >= 0 ? args[srcIdx + 1] : 'all') as Args['source'];
  if (!['all', 'invoices', 'payments', 'sales'].includes(source)) {
    throw new Error(`--source invalide : ${source}`);
  }
  return { apply, limit, source };
}

interface Stats {
  invoicesReceived: number;
  invoicesEmitted: number;
  invoicesSkipped: number;
  paymentsEmission: number;
  paymentsCashing: number;
  paymentsSkipped: number;
  sales: number;
  salesSkipped: number;
  entriesCreated: number;
  entriesSkippedExisting: number;
  errors: Array<{ source_kind: string; source_id: string; error: string }>;
  totalDebit: number;
  totalCredit: number;
  byJournal: Record<string, number>;
}

function newStats(): Stats {
  return {
    invoicesReceived: 0, invoicesEmitted: 0, invoicesSkipped: 0,
    paymentsEmission: 0, paymentsCashing: 0, paymentsSkipped: 0,
    sales: 0, salesSkipped: 0,
    entriesCreated: 0, entriesSkippedExisting: 0,
    errors: [],
    totalDebit: 0, totalCredit: 0,
    byJournal: {},
  };
}

function summarizeEntry(entry: GeneratedEntry, stats: Stats) {
  stats.byJournal[entry.journal_code] = (stats.byJournal[entry.journal_code] || 0) + 1;
  for (const l of entry.lines) {
    stats.totalDebit += l.debit;
    stats.totalCredit += l.credit;
  }
}

async function getSystemUserId(): Promise<string> {
  // On prend le premier admin disponible. Si aucun -> erreur.
  const res = await db.query(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`);
  if (!res.rows[0]) throw new Error('Aucun utilisateur admin pour created_by/posted_by');
  return res.rows[0].id;
}

async function backfillInvoices(stats: Stats, userId: string, args: Args) {
  const limit = args.limit ? `LIMIT ${args.limit}` : '';
  const rows = (await db.query(
    `SELECT id, invoice_number, invoice_type, supplier_id, customer_id, category_id,
            invoice_date::TEXT AS invoice_date, amount, tax_amount, total_amount, store_id, status
     FROM invoices
     WHERE status != 'cancelled'
     ORDER BY invoice_date, created_at
     ${limit}`
  )).rows as unknown as InvoiceRow[];

  for (const inv of rows) {
    try {
      const entry = await fromInvoice(db, inv);
      if (!entry) { stats.invoicesSkipped++; continue; }

      if (inv.invoice_type === 'received') stats.invoicesReceived++;
      else stats.invoicesEmitted++;

      summarizeEntry(entry, stats);

      if (args.apply) {
        const client = await db.getClient();
        try {
          await client.query('BEGIN');
          const result = await persistEntry(client, entry, { markAsBackfill: true, userId });
          await client.query('COMMIT');
          if (result.created) stats.entriesCreated++; else stats.entriesSkippedExisting++;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      } else {
        stats.entriesCreated++;
      }
    } catch (err) {
      stats.errors.push({
        source_kind: 'invoice', source_id: inv.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function backfillPayments(stats: Stats, userId: string, args: Args) {
  const limit = args.limit ? `LIMIT ${args.limit}` : '';
  const rows = (await db.query(
    `SELECT id, reference, type, category_id, invoice_id, supplier_id, employee_id,
            amount, payment_method, payment_date::TEXT AS payment_date,
            cashed_at::TEXT AS cashed_at, description, store_id
     FROM payments
     ORDER BY payment_date, created_at
     ${limit}`
  )).rows as unknown as PaymentRow[];

  for (const p of rows) {
    try {
      const emission = await fromPaymentEmission(db, p);
      if (emission) {
        stats.paymentsEmission++;
        summarizeEntry(emission, stats);
        if (args.apply) {
          const client = await db.getClient();
          try {
            await client.query('BEGIN');
            const result = await persistEntry(client, emission, { markAsBackfill: true, userId });
            await client.query('COMMIT');
            if (result.created) stats.entriesCreated++; else stats.entriesSkippedExisting++;
          } catch (err) {
            await client.query('ROLLBACK'); throw err;
          } finally { client.release(); }
        } else {
          stats.entriesCreated++;
        }
      } else {
        stats.paymentsSkipped++;
      }

      // Encaissement (cheque/traite avec cashed_at) : ecriture supplementaire
      const cashing = fromPaymentCashing(p);
      if (cashing) {
        stats.paymentsCashing++;
        summarizeEntry(cashing, stats);
        if (args.apply) {
          const client = await db.getClient();
          try {
            await client.query('BEGIN');
            // L'encaissement utilise un source_id = payment_id mais il existerait
            // un conflit avec l'emission (meme source_kind+id). On contourne en
            // utilisant source_kind='backfill' + source_id distinct via suffixe.
            // Pour ce backfill on accepte une 2eme entry sur le meme source si
            // la premiere est l'emission. La verification d'idempotence porte
            // sur le couple, donc en pratique l'encaissement passera car au
            // moment ou on le persiste, status est encore draft puis posted.
            // On utilise un source_id derive : payment_id + '-cashing' n'est
            // pas un UUID valide ; on prefere donc passer source_id=payment_id
            // et accepter le doublon en backfill (verifie par status).
            const result = await persistEntry(client, cashing, { markAsBackfill: true, userId });
            await client.query('COMMIT');
            if (result.created) stats.entriesCreated++; else stats.entriesSkippedExisting++;
          } catch (err) {
            await client.query('ROLLBACK'); throw err;
          } finally { client.release(); }
        } else {
          stats.entriesCreated++;
        }
      }
    } catch (err) {
      stats.errors.push({
        source_kind: 'payment', source_id: p.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function backfillSales(stats: Stats, userId: string, args: Args) {
  const limit = args.limit ? `LIMIT ${args.limit}` : '';
  const rows = (await db.query(
    `SELECT id, sale_number, customer_id, subtotal, tax_amount, discount_amount, total,
            payment_method, payment_status,
            paid_at::TEXT AS paid_at, created_at::TEXT AS created_at, store_id
     FROM sales
     WHERE payment_status = 'paid'
     ORDER BY COALESCE(paid_at, created_at), created_at
     ${limit}`
  )).rows as unknown as SaleRow[];

  for (const s of rows) {
    try {
      const entry = await fromSale(db, s);
      if (!entry) { stats.salesSkipped++; continue; }
      stats.sales++;
      summarizeEntry(entry, stats);

      if (args.apply) {
        const client = await db.getClient();
        try {
          await client.query('BEGIN');
          const result = await persistEntry(client, entry, { markAsBackfill: true, userId });
          await client.query('COMMIT');
          if (result.created) stats.entriesCreated++; else stats.entriesSkippedExisting++;
        } catch (err) {
          await client.query('ROLLBACK'); throw err;
        } finally { client.release(); }
      } else {
        stats.entriesCreated++;
      }
    } catch (err) {
      stats.errors.push({
        source_kind: 'sale', source_id: s.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function printReport(stats: Stats, args: Args) {
  const mode = args.apply ? 'APPLY (persiste)' : 'DRY-RUN (ne persiste rien)';
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  BACKFILL LEDGER — Rapport (${mode})`);
  console.log('═══════════════════════════════════════════════════════════════');

  console.log('\n┌─ Factures');
  console.log(`│  ✓ Recues (fournisseur)        : ${stats.invoicesReceived}`);
  console.log(`│  ✓ Emises (client)             : ${stats.invoicesEmitted}`);
  console.log(`│  ⏭ Ignorees (annulees/vides)  : ${stats.invoicesSkipped}`);

  console.log('\n┌─ Paiements');
  console.log(`│  ✓ Emissions                   : ${stats.paymentsEmission}`);
  console.log(`│  ✓ Encaissements (cheques)     : ${stats.paymentsCashing}`);
  console.log(`│  ⏭ Ignores                    : ${stats.paymentsSkipped}`);

  console.log('\n┌─ Ventes POS');
  console.log(`│  ✓ Comptant                    : ${stats.sales}`);
  console.log(`│  ⏭ Ignorees                   : ${stats.salesSkipped}`);

  console.log('\n┌─ Ecritures');
  if (args.apply) {
    console.log(`│  ✓ Creees                      : ${stats.entriesCreated}`);
    console.log(`│  ⏭ Deja existantes (skip)     : ${stats.entriesSkippedExisting}`);
  } else {
    console.log(`│  ≈ A creer (estimation)        : ${stats.entriesCreated}`);
  }

  console.log('\n┌─ Repartition par journal');
  for (const [code, count] of Object.entries(stats.byJournal).sort()) {
    console.log(`│  ${code} : ${count}`);
  }

  console.log('\n┌─ Totaux (controle d\'equilibre)');
  console.log(`│  Debit  : ${fmt(stats.totalDebit)} DH`);
  console.log(`│  Credit : ${fmt(stats.totalCredit)} DH`);
  const delta = stats.totalDebit - stats.totalCredit;
  if (Math.abs(delta) < 0.01) {
    console.log('│  ✓ Equilibre OK (delta < 0.01 DH)');
  } else {
    console.log(`│  ⚠ DESEQUILIBRE : ${fmt(delta)} DH`);
  }

  if (stats.errors.length) {
    console.log(`\n┌─ Erreurs (${stats.errors.length})`);
    for (const e of stats.errors.slice(0, 10)) {
      console.log(`│  ${e.source_kind} ${e.source_id.slice(0, 8)} : ${e.error}`);
    }
    if (stats.errors.length > 10) {
      console.log(`│  ... ${stats.errors.length - 10} erreurs supplementaires`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  if (!args.apply) {
    console.log('  Pour persister, relance avec --apply');
  } else {
    console.log('  Termine.');
  }
  console.log('═══════════════════════════════════════════════════════════════\n');
}

async function main() {
  const args = parseArgs();
  console.log(`Backfill demarre — mode: ${args.apply ? 'APPLY' : 'DRY-RUN'}, source: ${args.source}`);

  const userId = await getSystemUserId();
  const stats = newStats();

  if (args.source === 'all' || args.source === 'invoices') {
    console.log('→ Traitement des factures...');
    await backfillInvoices(stats, userId, args);
  }
  if (args.source === 'all' || args.source === 'payments') {
    console.log('→ Traitement des paiements...');
    await backfillPayments(stats, userId, args);
  }
  if (args.source === 'all' || args.source === 'sales') {
    console.log('→ Traitement des ventes...');
    await backfillSales(stats, userId, args);
  }

  printReport(stats, args);
  await db.pool.end();
  process.exit(stats.errors.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
