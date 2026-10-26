/**
 * Reprise (2026-10-26) — règlements de factures clients mal comptabilisés.
 *
 * Avant le correctif de fromPaymentEmission, l'encaissement d'une facture client
 * passait 5161/5141 D / 7585 C : le chiffre d'affaires, déjà porté par la facture
 * (7111), était compté une seconde fois et la créance 3421 du client restait due.
 * Ce script extourne ces écritures et les régénère (trésorerie D / 3421 C, lettrée
 * avec la facture). Sans --apply : liste seulement.
 *
 *   npx tsx scripts/fix-reglements-clients.ts            # aperçu
 *   npx tsx scripts/fix-reglements-clients.ts --apply    # correction
 */
import { db } from '../src/config/database.js';
import { regeneratePaymentEntries } from '../src/services/journal-generator.service.js';

const apply = process.argv.includes('--apply');
const rows = (await db.query(
  `SELECT DISTINCT p.id, i.invoice_number, p.amount, p.payment_method, p.payment_date::text AS d, j.entry_number
     FROM payments p
     JOIN invoices i ON i.id = p.invoice_id AND i.invoice_type = 'emitted'
     JOIN journal_entries j ON j.source_id = p.id AND j.status = 'posted' AND j.source_kind IN ('payment', 'backfill')
     JOIN journal_entry_lines l ON l.journal_entry_id = j.id AND l.credit > 0
     JOIN accounts a ON a.id = l.account_id AND a.code <> '3421'
    WHERE p.type = 'income' AND p.voided_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM journal_entry_lines l2 JOIN accounts a2 ON a2.id = l2.account_id
                       WHERE l2.journal_entry_id = j.id AND a2.code = '3421')
    ORDER BY d`)).rows;

console.log(`${rows.length} règlement(s) client à corriger`);
for (const r of rows) console.log(`  ${r.invoice_number} · ${r.amount} DH · ${r.payment_method} · ${r.d} · ${r.entry_number}`);

if (apply && rows.length) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const admin = (await client.query(`SELECT id FROM users WHERE role = 'admin' AND is_active ORDER BY created_at LIMIT 1`)).rows[0];
    for (const r of rows) await regeneratePaymentEntries(client, r.id, admin?.id);
    await client.query('COMMIT');
    console.log('Corrigé.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
process.exit(0);
