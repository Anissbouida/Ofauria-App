/**
 * Supprime les 11 factures de seed/test FR-2026-00xx visibles dans la page
 * "Charges & Dépenses" et qui ne correspondent pas a des achats reels.
 *
 * Effets :
 *   - DELETE invoices WHERE invoice_number LIKE 'FR-2026-0%' AND invoice_type='received'
 *     → CASCADE supprime aussi les invoice_items rattaches
 *   - DELETE reception_vouchers que ces factures pointaient
 *     → CASCADE supprime reception_voucher_items, et le FK
 *       ingredient_lots.reception_voucher_item_id passe a NULL
 *       (les lots de stock restent, juste decouples du document supprime)
 *
 * Usage :
 *   npx tsx server/src/scripts/cleanup-seed-invoices.ts          # dry-run
 *   npx tsx server/src/scripts/cleanup-seed-invoices.ts --commit # persiste
 */
import { db } from '../config/database.js';

const COMMIT = process.argv.includes('--commit');

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

const TARGET_PATTERN = 'FR-2026-0%';

async function main() {
  console.log(`${C.bold}${C.cyan}=== Cleanup seed invoices (${TARGET_PATTERN}) ===${C.reset}`);
  console.log(`Mode : ${COMMIT ? `${C.red}${C.bold}COMMIT${C.reset}` : `${C.green}DRY-RUN${C.reset}`}\n`);

  const client = await db.getClient();
  await client.query('BEGIN');

  try {
    // ── Inventaire ───────────────────────────────────────────────────
    const invs = await client.query<{ id: string; invoice_number: string; invoice_date: string; supplier: string; total_amount: string; n_items: string; rv_id: string | null }>(
      `SELECT inv.id, inv.invoice_number, inv.invoice_date, COALESCE(s.name, '?') as supplier,
              inv.total_amount, inv.reception_voucher_id as rv_id,
              (SELECT COUNT(*) FROM invoice_items WHERE invoice_id = inv.id) as n_items
       FROM invoices inv
       LEFT JOIN suppliers s ON s.id = inv.supplier_id
       WHERE inv.invoice_type = 'received' AND inv.invoice_number LIKE $1
       ORDER BY inv.invoice_date, inv.invoice_number`,
      [TARGET_PATTERN]
    );

    if (invs.rows.length === 0) {
      console.log(`${C.green}Rien a faire.${C.reset}`);
      await client.query('ROLLBACK');
      return;
    }

    console.log(`${C.bold}${C.cyan}── Factures a supprimer : ${invs.rows.length} ──${C.reset}`);
    for (const inv of invs.rows) {
      console.log(`  ${inv.invoice_number.padEnd(15)} ${String(inv.invoice_date).slice(0, 10)}  ${inv.supplier.padEnd(28)} ${inv.total_amount.padStart(10)} DH  (${inv.n_items} items, RV=${inv.rv_id ? 'oui' : 'non'})`);
    }
    console.log();

    // Refus si paiements rattaches (filet de securite)
    const linkedPayments = await client.query<{ cnt: string }>(
      `SELECT COUNT(*) as cnt FROM payments
       WHERE invoice_id IN (SELECT id FROM invoices WHERE invoice_type='received' AND invoice_number LIKE $1)`,
      [TARGET_PATTERN]
    );
    if (parseInt(linkedPayments.rows[0].cnt, 10) > 0) {
      console.error(`${C.red}${C.bold}REFUS : ${linkedPayments.rows[0].cnt} payment(s) rattache(s). Supprime-les d'abord.${C.reset}`);
      await client.query('ROLLBACK');
      process.exit(1);
    }

    const rvIds = invs.rows.map(r => r.rv_id).filter((x): x is string => !!x);

    // ── 1. DELETE invoices (CASCADE invoice_items) ───────────────────
    const delInv = await client.query(
      `DELETE FROM invoices WHERE invoice_type='received' AND invoice_number LIKE $1`,
      [TARGET_PATTERN]
    );
    console.log(`${C.cyan}DELETE invoices${C.reset}     : ${delInv.rowCount} ligne(s) (CASCADE -> invoice_items)`);

    // ── 2. Casser les FK qui ne sont pas en CASCADE/SET NULL :
    //       inventory_transactions et reception_quality_checks pointent vers RV.
    //       On NULLifie le lien (les mouvements de stock restent : on ne veut pas
    //       que le stock baisse de la quantite seedee, juste decoupler du doc).
    if (rvIds.length > 0) {
      const it = await client.query(
        `UPDATE inventory_transactions SET reception_voucher_id = NULL
         WHERE reception_voucher_id = ANY($1::uuid[])`,
        [rvIds]
      );
      console.log(`${C.cyan}NULL inv_transactions${C.reset} : ${it.rowCount} ligne(s) decouplee(s) (stock conserve)`);

      const qc = await client.query(
        `DELETE FROM reception_quality_checks WHERE reception_voucher_id = ANY($1::uuid[])`,
        [rvIds]
      );
      console.log(`${C.cyan}DELETE quality_checks${C.reset} : ${qc.rowCount} ligne(s)`);

      // ── 3. DELETE reception_vouchers (CASCADE RVI, SET NULL ing_lots) ─
      const delRv = await client.query(
        `DELETE FROM reception_vouchers WHERE id = ANY($1::uuid[])`,
        [rvIds]
      );
      console.log(`${C.cyan}DELETE rec_vouchers${C.reset} : ${delRv.rowCount} ligne(s) (CASCADE -> RVI, SET NULL -> ingredient_lots.rvi_id)`);
    }

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
