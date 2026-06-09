/**
 * Diagnostic et reconciliation des paid_amount des factures.
 *
 * Pourquoi :
 *   Le champ invoices.paid_amount est cense etre SUM(payments WHERE invoice_id).
 *   Si un paiement est saisi en double, ou si paid_amount drifte hors-sync, la
 *   somme totale affichee dans l'UI peut depasser le total facture.
 *
 * Phases :
 *   1. DIAGNOSTIC (toujours execute, ne modifie rien) :
 *      - Factures ou paid_amount differe de SUM(payments) (drift).
 *      - Factures ou paid_amount > total_amount (sur-paiement).
 *      - Groupes de paiements potentiellement en double pour ces factures
 *        (meme invoice_id, meme amount, meme date, meme methode, meme check_number).
 *
 *   2. ACTIONS (opt-in via flags) :
 *      --dedupe   : Supprime les doublons evidents (garde le plus ancien).
 *      --recompute: Resynchronise paid_amount = SUM(payments) et le status.
 *
 *   3. PERSISTENCE :
 *      Par defaut tout est en dry-run (ROLLBACK). Ajoute --commit pour persister.
 *
 * Usage :
 *   # Diagnostic seul (ne modifie rien)
 *   npx tsx server/src/scripts/reconcile-invoice-payments.ts
 *
 *   # Apercu de ce qui serait dedoublonne (toujours dry-run)
 *   npx tsx server/src/scripts/reconcile-invoice-payments.ts --dedupe
 *
 *   # Apercu d'un recalcul des paid_amount (toujours dry-run)
 *   npx tsx server/src/scripts/reconcile-invoice-payments.ts --recompute
 *
 *   # Tout faire et persister (PROD)
 *   npx tsx server/src/scripts/reconcile-invoice-payments.ts --dedupe --recompute --commit
 */
import { db } from '../config/database.js';

const ARGS = process.argv.slice(2);
const COMMIT = ARGS.includes('--commit');
const DEDUPE = ARGS.includes('--dedupe');
const RECOMPUTE = ARGS.includes('--recompute');

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', magenta: '\x1b[35m',
};

function f(v: string | number | null | undefined): string {
  if (v == null) return '—';
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return n.toFixed(2);
}

async function main() {
  console.log(`${C.bold}${C.cyan}=== Diagnostic paid_amount factures ===${C.reset}`);
  console.log(`Mode : ${COMMIT ? `${C.red}${C.bold}COMMIT${C.reset}` : `${C.green}DRY-RUN${C.reset}`}`);
  console.log(`Actions : ${DEDUPE ? `${C.yellow}dedupe ${C.reset}` : ''}${RECOMPUTE ? `${C.yellow}recompute${C.reset}` : ''}${!DEDUPE && !RECOMPUTE ? `${C.dim}diagnostic seul${C.reset}` : ''}\n`);

  const client = await db.getClient();
  await client.query('BEGIN');

  try {
    // ── 1. Drift : paid_amount stocke vs SUM(payments) ────────────────────
    const driftRows = await client.query<{
      id: string; invoice_number: string; total_amount: string;
      stored_paid: string; computed_paid: string; status: string;
    }>(
      `SELECT inv.id, inv.invoice_number, inv.total_amount, inv.status,
              inv.paid_amount AS stored_paid,
              COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = inv.id), 0) AS computed_paid
       FROM invoices inv
       WHERE inv.invoice_type = 'received'
         AND ABS(inv.paid_amount - COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = inv.id), 0)) > 0.01
       ORDER BY inv.invoice_number`
    );

    console.log(`${C.bold}${C.cyan}── 1. Drift paid_amount vs SUM(payments) ──${C.reset}`);
    if (driftRows.rows.length === 0) {
      console.log(`  ${C.green}Aucun drift${C.reset}\n`);
    } else {
      console.log(`  ${C.yellow}${driftRows.rows.length}${C.reset} facture(s) avec paid_amount desynchronise :`);
      for (const r of driftRows.rows) {
        const delta = parseFloat(r.stored_paid) - parseFloat(r.computed_paid);
        const sign = delta > 0 ? '+' : '';
        console.log(`    ${r.invoice_number}  total=${f(r.total_amount)}  stocke=${f(r.stored_paid)}  calcule=${f(r.computed_paid)}  ${C.red}drift=${sign}${f(delta)}${C.reset}  status=${r.status}`);
      }
      console.log();
    }

    // ── 2. Sur-paiement : paid_amount > total_amount ──────────────────────
    const overRows = await client.query<{
      id: string; invoice_number: string; total_amount: string; paid_amount: string;
      status: string; supplier_name: string | null;
    }>(
      `SELECT inv.id, inv.invoice_number, inv.total_amount, inv.paid_amount, inv.status,
              s.name AS supplier_name
       FROM invoices inv
       LEFT JOIN suppliers s ON s.id = inv.supplier_id
       WHERE inv.invoice_type = 'received'
         AND inv.paid_amount > inv.total_amount + 0.01
       ORDER BY (inv.paid_amount - inv.total_amount) DESC`
    );

    console.log(`${C.bold}${C.cyan}── 2. Factures avec paid_amount > total_amount ──${C.reset}`);
    if (overRows.rows.length === 0) {
      console.log(`  ${C.green}Aucune${C.reset}\n`);
    } else {
      console.log(`  ${C.red}${overRows.rows.length}${C.reset} facture(s) en sur-paiement :`);
      for (const r of overRows.rows) {
        const surplus = parseFloat(r.paid_amount) - parseFloat(r.total_amount);
        console.log(`    ${C.bold}${r.invoice_number}${C.reset} (${r.supplier_name || '—'})  total=${f(r.total_amount)}  paye=${f(r.paid_amount)}  ${C.red}surplus=+${f(surplus)}${C.reset}  status=${r.status}`);
      }
      console.log();
    }

    // ── 3. Paiements en doublon ───────────────────────────────────────────
    // Definition d'un doublon : meme invoice_id + meme amount + meme payment_date
    // + meme payment_method + meme check_number (NULL = NULL toleré).
    // On garde le plus ancien (id min) et marque les autres comme doublons.
    const dupRows = await client.query<{
      keep_id: string; dup_ids: string[]; invoice_id: string;
      invoice_number: string; amount: string; payment_date: string;
      payment_method: string; check_number: string | null; dup_count: number;
    }>(
      `WITH grouped AS (
         SELECT
           p.invoice_id,
           p.amount,
           p.payment_date,
           p.payment_method,
           COALESCE(p.check_number, '') AS check_number,
           MIN(p.id::text) AS keep_id,
           ARRAY_AGG(p.id::text ORDER BY p.created_at) AS all_ids,
           COUNT(*) AS cnt
         FROM payments p
         WHERE p.invoice_id IS NOT NULL
         GROUP BY p.invoice_id, p.amount, p.payment_date, p.payment_method, COALESCE(p.check_number, '')
         HAVING COUNT(*) > 1
       )
       SELECT g.keep_id,
              g.all_ids[2:] AS dup_ids,
              g.invoice_id,
              inv.invoice_number,
              g.amount::text AS amount,
              g.payment_date::text AS payment_date,
              g.payment_method,
              NULLIF(g.check_number, '') AS check_number,
              g.cnt::int AS dup_count
       FROM grouped g
       JOIN invoices inv ON inv.id = g.invoice_id
       ORDER BY inv.invoice_number, g.payment_date`
    );

    console.log(`${C.bold}${C.cyan}── 3. Groupes de paiements en doublon ──${C.reset}`);
    let totalDupCount = 0;
    if (dupRows.rows.length === 0) {
      console.log(`  ${C.green}Aucun doublon detecte${C.reset}\n`);
    } else {
      console.log(`  ${C.yellow}${dupRows.rows.length}${C.reset} groupe(s) de doublons :`);
      for (const g of dupRows.rows) {
        totalDupCount += g.dup_ids.length;
        const checkInfo = g.check_number ? `  cheque=${g.check_number}` : '';
        console.log(`    ${g.invoice_number}  ${f(g.amount)} DH  ${g.payment_date}  ${g.payment_method}${checkInfo}  ${C.red}×${g.dup_count}${C.reset}  (${g.dup_ids.length} a supprimer)`);
      }
      console.log(`  ${C.yellow}Total de paiements en trop : ${totalDupCount}${C.reset}\n`);
    }

    // ── 4. Actions (opt-in) ───────────────────────────────────────────────
    if (DEDUPE && dupRows.rows.length > 0) {
      console.log(`${C.bold}${C.magenta}── 4a. Suppression des doublons ──${C.reset}`);
      let deleted = 0;
      for (const g of dupRows.rows) {
        if (g.dup_ids.length === 0) continue;
        const res = await client.query(
          `DELETE FROM payments WHERE id::text = ANY($1)`,
          [g.dup_ids]
        );
        deleted += res.rowCount || 0;
      }
      console.log(`  ${deleted} paiement(s) supprime(s) (les plus anciens conserves)\n`);
    } else if (DEDUPE) {
      console.log(`${C.bold}${C.magenta}── 4a. Suppression des doublons ──${C.reset}`);
      console.log(`  Rien a faire.\n`);
    }

    if (RECOMPUTE) {
      console.log(`${C.bold}${C.magenta}── 4b. Resynchronisation paid_amount + status ──${C.reset}`);
      // Recalcule paid_amount + status pour TOUTES les factures recues, en
      // preservant les statuts manuels 'disputed' et 'cancelled' tant que
      // la facture n'est pas integralement payee.
      const recalc = await client.query<{ updated: number }>(
        `WITH sums AS (
           SELECT inv.id,
                  inv.total_amount,
                  inv.status AS current_status,
                  COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = inv.id), 0) AS new_paid
           FROM invoices inv
           WHERE inv.invoice_type = 'received'
         ),
         resolved AS (
           SELECT id, new_paid,
                  CASE
                    WHEN new_paid >= total_amount THEN 'paid'
                    WHEN current_status IN ('disputed', 'cancelled') THEN current_status
                    WHEN new_paid > 0 THEN 'partial'
                    ELSE 'pending'
                  END AS new_status
           FROM sums
         ),
         upd AS (
           UPDATE invoices inv
           SET paid_amount = r.new_paid,
               status = r.new_status
           FROM resolved r
           WHERE inv.id = r.id
             AND (ABS(inv.paid_amount - r.new_paid) > 0.01 OR inv.status <> r.new_status)
           RETURNING inv.id
         )
         SELECT COUNT(*)::int AS updated FROM upd`
      );
      console.log(`  ${recalc.rows[0].updated} facture(s) resynchronise(s)\n`);
    }

    // ── 5. Verification finale (post-actions) ─────────────────────────────
    if (DEDUPE || RECOMPUTE) {
      const finalCheck = await client.query<{ count: string; surplus_total: string }>(
        `SELECT COUNT(*)::text AS count,
                COALESCE(SUM(paid_amount - total_amount), 0)::text AS surplus_total
         FROM invoices
         WHERE invoice_type = 'received' AND paid_amount > total_amount + 0.01`
      );
      const remaining = parseInt(finalCheck.rows[0].count, 10);
      const surplus = parseFloat(finalCheck.rows[0].surplus_total);
      console.log(`${C.bold}${C.cyan}── 5. Verification post-actions ──${C.reset}`);
      if (remaining === 0) {
        console.log(`  ${C.green}OK : aucune facture restante en sur-paiement${C.reset}\n`);
      } else {
        console.log(`  ${C.yellow}${remaining} facture(s) toujours en sur-paiement (surplus total ${f(surplus)} DH)${C.reset}`);
        console.log(`  ${C.dim}→ verification manuelle requise${C.reset}\n`);
      }
    }

    // ── Persistence ───────────────────────────────────────────────────────
    if (COMMIT && (DEDUPE || RECOMPUTE)) {
      await client.query('COMMIT');
      console.log(`${C.bold}${C.green}✓ COMMIT effectue${C.reset}`);
    } else {
      await client.query('ROLLBACK');
      if (DEDUPE || RECOMPUTE) {
        console.log(`${C.bold}${C.yellow}↩ ROLLBACK (dry-run). Relance avec --commit pour persister.${C.reset}`);
      } else {
        console.log(`${C.dim}Diagnostic seul, aucune modification.${C.reset}`);
      }
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
