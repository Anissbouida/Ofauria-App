/**
 * Nettoyage des payments crees par import-cheques-excel.ts.
 *
 * Pourquoi :
 *   - Les cheques sont dates dans le futur (20/05) alors qu'on est encore le 18/05.
 *   - Les "dépenses" doivent etre alimentees par les ingredients des factures
 *     importees, pas par les paiements (cheques) qui les regleront plus tard.
 *
 * Effets :
 *   1. UPDATE invoices : status='paid' -> 'pending', paid_amount = 0
 *      pour toutes les factures qui avaient ete rapprochees par TALON_CHQ.
 *   2. DELETE payments WHERE import_source LIKE 'TALON_CHQ%'.
 *
 * Usage :
 *   npx tsx server/src/scripts/cleanup-cheques-payments.ts          # dry-run
 *   npx tsx server/src/scripts/cleanup-cheques-payments.ts --commit # persiste
 */
import { db } from '../config/database.js';

const COMMIT = process.argv.includes('--commit');

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

async function main() {
  console.log(`${C.bold}${C.cyan}=== Cleanup cheques payments ===${C.reset}`);
  console.log(`Mode : ${COMMIT ? `${C.red}${C.bold}COMMIT${C.reset}` : `${C.green}DRY-RUN${C.reset}`}\n`);

  const client = await db.getClient();
  await client.query('BEGIN');

  try {
    // ── Inventaire ────────────────────────────────────────────────────
    const countPayments = await client.query<{ count: string }>(
      `SELECT COUNT(*) FROM payments WHERE import_source LIKE 'TALON_CHQ%'`
    );
    const totalPayments = parseInt(countPayments.rows[0].count, 10);

    const linkedInvoices = await client.query<{ id: string; invoice_number: string; total_amount: string; paid_amount: string; status: string }>(
      `SELECT DISTINCT inv.id, inv.invoice_number, inv.total_amount, inv.paid_amount, inv.status
       FROM invoices inv
       JOIN payments p ON p.invoice_id = inv.id
       WHERE p.import_source LIKE 'TALON_CHQ%'
       ORDER BY inv.invoice_number`
    );

    const sumAmount = await client.query<{ s: string | null }>(
      `SELECT COALESCE(SUM(amount), 0) as s FROM payments WHERE import_source LIKE 'TALON_CHQ%'`
    );

    console.log(`${C.bold}${C.cyan}── Inventaire ──${C.reset}`);
    console.log(`  Paiements TALON_CHQ a supprimer : ${C.yellow}${totalPayments}${C.reset} (somme ${parseFloat(sumAmount.rows[0].s ?? '0').toFixed(2)} DH)`);
    console.log(`  Factures rapprochees a remettre en 'pending' : ${C.yellow}${linkedInvoices.rows.length}${C.reset}`);
    for (const inv of linkedInvoices.rows) {
      console.log(`    - ${inv.invoice_number} (status=${inv.status}, paid=${inv.paid_amount}/${inv.total_amount})`);
    }
    console.log();

    if (totalPayments === 0) {
      console.log(`${C.green}Rien a faire.${C.reset}`);
      await client.query('ROLLBACK');
      return;
    }

    // ── 1. Reset des factures rapprochees ─────────────────────────────
    const updRes = await client.query(
      `UPDATE invoices
       SET status = 'pending', paid_amount = 0
       WHERE id IN (
         SELECT DISTINCT invoice_id FROM payments
         WHERE import_source LIKE 'TALON_CHQ%' AND invoice_id IS NOT NULL
       )`
    );
    console.log(`${C.cyan}UPDATE invoices${C.reset} : ${updRes.rowCount} ligne(s) remises en 'pending'`);

    // ── 2. Suppression des payments ───────────────────────────────────
    const delRes = await client.query(
      `DELETE FROM payments WHERE import_source LIKE 'TALON_CHQ%'`
    );
    console.log(`${C.cyan}DELETE payments${C.reset} : ${delRes.rowCount} ligne(s) supprimees`);

    console.log();
    if (COMMIT) {
      await client.query('COMMIT');
      console.log(`${C.bold}${C.green}✓ COMMIT effectue${C.reset}`);
    } else {
      await client.query('ROLLBACK');
      console.log(`${C.bold}${C.yellow}↩ ROLLBACK (dry-run). Relance avec --commit pour persister.${C.reset}`);
    }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(`${C.red}${C.bold}ERREUR : rollback complet${C.reset}`);
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await db.pool.end();
  }
}

main();
