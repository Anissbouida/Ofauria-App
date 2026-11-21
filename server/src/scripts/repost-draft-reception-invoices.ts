/**
 * Scénario 1, constat 116 — reprise des factures fournisseur nées d'une réception et encore
 * en brouillon, écrites avant la correction : leur écriture (4417 → 4411) est extournée ; elle
 * sera repassée à la validation de la facture. Idempotent (sans écriture active, rien à faire).
 *
 * Usage : npx tsx src/scripts/repost-draft-reception-invoices.ts            (depuis server/)
 *         npx tsx src/scripts/repost-draft-reception-invoices.ts --dry-run   (liste seulement)
 */
import { db } from '../config/database.js';
import { regenerateInvoiceEntry } from '../services/journal-generator.service.js';

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  const drafts = (await db.query(
    `SELECT i.id, i.invoice_number, i.total_amount
       FROM invoices i
      WHERE i.invoice_type = 'received' AND i.validation_status = 'draft'
        AND i.reception_voucher_id IS NOT NULL AND i.status <> 'cancelled'
        AND EXISTS (SELECT 1 FROM journal_entries je
                     WHERE je.source_id = i.id AND je.source_kind = 'invoice' AND je.status <> 'reversed')
      ORDER BY i.created_at`)).rows;
  console.log(`${drafts.length} facture(s) brouillon née(s) d'une réception avec écriture active.`);
  for (const d of drafts) {
    console.log(`  ${d.invoice_number} (${d.total_amount} DH)${dryRun ? '' : ' → extourne'}`);
    if (dryRun) continue;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await regenerateInvoiceEntry(client, d.id, null);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error(`  échec ${d.invoice_number} :`, err instanceof Error ? err.message : err);
    } finally {
      client.release();
    }
  }
  await db.pool.end();
}

run().catch((err) => { console.error(err); process.exit(1); });
