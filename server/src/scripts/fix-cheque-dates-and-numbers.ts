/**
 * Corrige les paiements cheques/traites mal saisis avant le fix du form.
 *
 * Probleme :
 *   - Le formulaire "Payer" pre-remplissait check_date avec la date du jour
 *     au lieu de l'echeance de la facture → l'onglet Effets affichait les
 *     cheques "en retard" alors que la facture etait a echeance future.
 *   - invoices.check_number n'etait pas synchronise avec payments.check_number
 *     quand l'utilisateur changeait le N° au paiement → incoherence visible.
 *
 * Effets de ce script :
 *   1. UPDATE payments.check_date = inv.due_date pour les paiements cheque/traite
 *      NON encaisses, lies a une facture, ou check_date < due_date.
 *   2. UPDATE invoices.check_number = derniere payments.check_number (cheque/traite)
 *      pour les factures ou les deux divergent.
 *
 * Usage :
 *   npx tsx server/src/scripts/fix-cheque-dates-and-numbers.ts          # dry-run
 *   npx tsx server/src/scripts/fix-cheque-dates-and-numbers.ts --commit # persiste
 */
import { db } from '../config/database.js';

const COMMIT = process.argv.includes('--commit');

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

async function main() {
  console.log(`${C.bold}${C.cyan}=== Fix cheque dates & numbers ===${C.reset}`);
  console.log(`Mode : ${COMMIT ? `${C.red}${C.bold}COMMIT${C.reset}` : `${C.green}DRY-RUN${C.reset}`}\n`);

  const client = await db.getClient();
  await client.query('BEGIN');

  try {
    // ── 1. check_date != due_date sur cheques non encaisses ──────────────
    const badDates = await client.query<{
      payment_id: string; invoice_id: string; invoice_number: string;
      supplier_name: string | null; amount: string;
      check_number: string | null; check_date: string; due_date: string;
    }>(
      `SELECT p.id AS payment_id, inv.id AS invoice_id, inv.invoice_number,
              s.name AS supplier_name, p.amount,
              p.check_number, p.check_date, inv.due_date
       FROM payments p
       JOIN invoices inv ON inv.id = p.invoice_id
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.payment_method IN ('check', 'traite')
         AND p.cashed_at IS NULL
         AND p.check_date IS NOT NULL
         AND inv.due_date IS NOT NULL
         AND p.check_date < inv.due_date
       ORDER BY p.check_date`
    );

    console.log(`${C.bold}${C.cyan}── 1. Dates cheque < echeance facture ──${C.reset}`);
    console.log(`  ${C.yellow}${badDates.rows.length}${C.reset} paiement(s) a corriger\n`);
    for (const r of badDates.rows) {
      console.log(`    Facture ${r.invoice_number} (${r.supplier_name || '—'}) ${parseFloat(r.amount).toFixed(2)} DH`);
      console.log(`      N° ${r.check_number || '—'} : check_date ${C.red}${r.check_date.slice(0, 10)}${C.reset} → ${C.green}${r.due_date.slice(0, 10)}${C.reset}`);
    }
    console.log();

    if (COMMIT && badDates.rows.length > 0) {
      const upd = await client.query(
        `UPDATE payments p
         SET check_date = inv.due_date
         FROM invoices inv
         WHERE p.invoice_id = inv.id
           AND p.payment_method IN ('check', 'traite')
           AND p.cashed_at IS NULL
           AND p.check_date IS NOT NULL
           AND inv.due_date IS NOT NULL
           AND p.check_date < inv.due_date`
      );
      console.log(`  ${C.green}${upd.rowCount} ligne(s) mise(s) a jour${C.reset}\n`);
    }

    // ── 2. invoice.check_number divergent du dernier payment.check_number ──
    const badNumbers = await client.query<{
      invoice_id: string; invoice_number: string;
      invoice_check: string | null; payment_check: string;
    }>(
      `WITH last_pay AS (
         SELECT DISTINCT ON (p.invoice_id) p.invoice_id, p.check_number
         FROM payments p
         WHERE p.payment_method IN ('check', 'traite')
           AND p.check_number IS NOT NULL
           AND p.invoice_id IS NOT NULL
         ORDER BY p.invoice_id, p.payment_date DESC, p.created_at DESC
       )
       SELECT inv.id AS invoice_id, inv.invoice_number,
              inv.check_number AS invoice_check, lp.check_number AS payment_check
       FROM invoices inv
       JOIN last_pay lp ON lp.invoice_id = inv.id
       WHERE COALESCE(inv.check_number, '') <> lp.check_number
       ORDER BY inv.invoice_number`
    );

    console.log(`${C.bold}${C.cyan}── 2. N° cheque facture != dernier paiement ──${C.reset}`);
    console.log(`  ${C.yellow}${badNumbers.rows.length}${C.reset} facture(s) a synchroniser\n`);
    for (const r of badNumbers.rows) {
      console.log(`    Facture ${r.invoice_number} : ${C.red}${r.invoice_check || '—'}${C.reset} → ${C.green}${r.payment_check}${C.reset}`);
    }
    console.log();

    if (COMMIT && badNumbers.rows.length > 0) {
      const upd = await client.query(
        `UPDATE invoices inv
         SET check_number = lp.check_number
         FROM (
           SELECT DISTINCT ON (p.invoice_id) p.invoice_id, p.check_number
           FROM payments p
           WHERE p.payment_method IN ('check', 'traite')
             AND p.check_number IS NOT NULL
             AND p.invoice_id IS NOT NULL
           ORDER BY p.invoice_id, p.payment_date DESC, p.created_at DESC
         ) lp
         WHERE inv.id = lp.invoice_id
           AND COALESCE(inv.check_number, '') <> lp.check_number`
      );
      console.log(`  ${C.green}${upd.rowCount} facture(s) synchronisee(s)${C.reset}\n`);
    }

    if (COMMIT) {
      await client.query('COMMIT');
      console.log(`${C.bold}${C.green}✓ Modifications appliquees${C.reset}`);
    } else {
      await client.query('ROLLBACK');
      console.log(`${C.bold}${C.yellow}⚠ Dry-run — rien n'a ete persiste. Relancer avec --commit pour appliquer.${C.reset}`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`${C.red}Erreur :${C.reset}`, err);
    throw err;
  } finally {
    client.release();
  }
}

main().then(() => process.exit(0)).catch(() => process.exit(1));
