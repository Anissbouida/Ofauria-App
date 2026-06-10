/**
 * Reparation des prix unitaires sur les lignes de bon de commande (BC).
 *
 * Pourquoi :
 *   Bug historique dans reception-voucher.repository.ts : le prix unitaire
 *   saisi lors d'une reception n'etait pas repercute sur purchase_order_items
 *   si la ligne avait deja un prix non-nul. Resultat : le BC continuait
 *   d'afficher l'ancien prix (et donc un total errone), alors que la facture
 *   auto-generee utilisait le vrai prix saisi en reception.
 *
 *   Ce script resynchronise purchase_order_items.unit_price avec le DERNIER
 *   rvi.unit_price connu, en miroir de ce que fait l'auto-facture (voir le
 *   COALESCE dans reception-voucher.repository.ts:262).
 *
 * Phases :
 *   1. DIAGNOSTIC (toujours) : liste les BC ou poi.unit_price differe du
 *      dernier rvi.unit_price.
 *   2. ACTION (opt-in via --apply) : met a jour poi.unit_price.
 *   3. PERSISTENCE : dry-run par defaut, --commit pour persister.
 *
 * Usage :
 *   # Diagnostic seul
 *   npx tsx server/src/scripts/reconcile-po-item-prices.ts
 *
 *   # Apercu des updates (dry-run)
 *   npx tsx server/src/scripts/reconcile-po-item-prices.ts --apply
 *
 *   # Persistence prod
 *   npx tsx server/src/scripts/reconcile-po-item-prices.ts --apply --commit
 */
import { db } from '../config/database.js';

const ARGS = process.argv.slice(2);
const COMMIT = ARGS.includes('--commit');
const APPLY = ARGS.includes('--apply');

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
  console.log(`${C.bold}${C.cyan}=== Reconciliation prix BC ↔ bon de reception ===${C.reset}`);
  console.log(`Mode : ${COMMIT ? `${C.red}${C.bold}COMMIT${C.reset}` : `${C.green}DRY-RUN${C.reset}`}`);
  console.log(`Action : ${APPLY ? `${C.yellow}update poi.unit_price${C.reset}` : `${C.dim}diagnostic seul${C.reset}`}\n`);

  const client = await db.getClient();
  await client.query('BEGIN');

  try {
    // Ligne BC ou le dernier rvi.unit_price differe du poi.unit_price.
    // On ignore les rvi.unit_price nuls (l'utilisateur n'a pas saisi de prix
    // a cette reception, donc rien a propager).
    const diffRows = await client.query<{
      poi_id: string;
      po_id: string;
      order_number: string;
      ingredient_name: string;
      ingredient_unit: string;
      quantity_ordered: string;
      quantity_delivered: string;
      poi_unit_price: string | null;
      latest_rvi_price: string;
      latest_rvi_date: string;
      voucher_number: string;
    }>(
      `WITH latest_rvi AS (
         SELECT DISTINCT ON (rvi.purchase_order_item_id)
                rvi.purchase_order_item_id,
                rvi.unit_price,
                rv.reception_date,
                rv.voucher_number
         FROM reception_voucher_items rvi
         JOIN reception_vouchers rv ON rv.id = rvi.reception_voucher_id
         WHERE rvi.unit_price IS NOT NULL
         ORDER BY rvi.purchase_order_item_id, rv.reception_date DESC, rvi.id DESC
       )
       SELECT poi.id AS poi_id,
              po.id AS po_id,
              po.order_number,
              ing.name AS ingredient_name,
              ing.unit AS ingredient_unit,
              poi.quantity_ordered::text,
              poi.quantity_delivered::text,
              poi.unit_price::text AS poi_unit_price,
              lr.unit_price::text AS latest_rvi_price,
              lr.reception_date::text AS latest_rvi_date,
              lr.voucher_number
       FROM purchase_order_items poi
       JOIN purchase_orders po ON po.id = poi.purchase_order_id
       JOIN ingredients ing ON ing.id = poi.ingredient_id
       JOIN latest_rvi lr ON lr.purchase_order_item_id = poi.id
       WHERE poi.unit_price IS NULL
          OR ABS(poi.unit_price - lr.unit_price) > 0.001
       ORDER BY po.order_number, ing.name`
    );

    console.log(`${C.bold}${C.cyan}── Lignes BC desynchronisees ──${C.reset}`);
    if (diffRows.rows.length === 0) {
      console.log(`  ${C.green}Aucune ligne BC desynchronisee${C.reset}\n`);
    } else {
      console.log(`  ${C.yellow}${diffRows.rows.length}${C.reset} ligne(s) avec prix BC ≠ prix reception :\n`);

      let currentPo = '';
      for (const r of diffRows.rows) {
        if (r.order_number !== currentPo) {
          if (currentPo) console.log();
          console.log(`  ${C.bold}${r.order_number}${C.reset}`);
          currentPo = r.order_number;
        }
        const oldP = parseFloat(r.poi_unit_price ?? '0');
        const newP = parseFloat(r.latest_rvi_price);
        const qty = parseFloat(r.quantity_ordered);
        const qtyDel = parseFloat(r.quantity_delivered);
        const oldTotal = qty * oldP;
        const newTotal = qty * newP;
        const delta = newTotal - oldTotal;
        const sign = delta > 0 ? '+' : '';
        console.log(
          `    ${r.ingredient_name} (${r.ingredient_unit})  ` +
          `cmd=${qty} liv=${qtyDel}  ` +
          `BC=${f(r.poi_unit_price)} → ${C.green}reception=${f(r.latest_rvi_price)}${C.reset}  ` +
          `(${r.voucher_number}, ${r.latest_rvi_date})  ` +
          `Δtotal=${sign}${f(delta)} DH`
        );
      }
      console.log();

      // Impact total sur la valeur des BC
      const impactRows = await client.query<{
        po_id: string;
        order_number: string;
        old_total: string;
        new_total: string;
      }>(
        `WITH latest_rvi AS (
           SELECT DISTINCT ON (rvi.purchase_order_item_id)
                  rvi.purchase_order_item_id,
                  rvi.unit_price
           FROM reception_voucher_items rvi
           JOIN reception_vouchers rv ON rv.id = rvi.reception_voucher_id
           WHERE rvi.unit_price IS NOT NULL
           ORDER BY rvi.purchase_order_item_id, rv.reception_date DESC, rvi.id DESC
         )
         SELECT po.id AS po_id, po.order_number,
                COALESCE(SUM(poi.quantity_ordered * COALESCE(poi.unit_price, 0)), 0)::text AS old_total,
                COALESCE(SUM(poi.quantity_ordered * COALESCE(lr.unit_price, poi.unit_price, 0)), 0)::text AS new_total
         FROM purchase_orders po
         JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
         LEFT JOIN latest_rvi lr ON lr.purchase_order_item_id = poi.id
         WHERE po.id IN (
           SELECT DISTINCT poi2.purchase_order_id
           FROM purchase_order_items poi2
           JOIN latest_rvi lr2 ON lr2.purchase_order_item_id = poi2.id
           WHERE poi2.unit_price IS NULL OR ABS(poi2.unit_price - lr2.unit_price) > 0.001
         )
         GROUP BY po.id, po.order_number
         ORDER BY po.order_number`
      );

      console.log(`${C.bold}${C.cyan}── Impact sur les totaux BC ──${C.reset}`);
      for (const r of impactRows.rows) {
        const oldT = parseFloat(r.old_total);
        const newT = parseFloat(r.new_total);
        const delta = newT - oldT;
        const sign = delta > 0 ? '+' : '';
        console.log(
          `  ${r.order_number}  ${f(r.old_total)} → ${C.green}${f(r.new_total)}${C.reset} DH  ` +
          `(${sign}${f(delta)})`
        );
      }
      console.log();
    }

    // Action
    if (APPLY && diffRows.rows.length > 0) {
      console.log(`${C.bold}${C.magenta}── Application des updates ──${C.reset}`);
      const res = await client.query<{ updated: number }>(
        `WITH latest_rvi AS (
           SELECT DISTINCT ON (rvi.purchase_order_item_id)
                  rvi.purchase_order_item_id,
                  rvi.unit_price
           FROM reception_voucher_items rvi
           JOIN reception_vouchers rv ON rv.id = rvi.reception_voucher_id
           WHERE rvi.unit_price IS NOT NULL
           ORDER BY rvi.purchase_order_item_id, rv.reception_date DESC, rvi.id DESC
         ),
         upd AS (
           UPDATE purchase_order_items poi
           SET unit_price = lr.unit_price
           FROM latest_rvi lr
           WHERE poi.id = lr.purchase_order_item_id
             AND (poi.unit_price IS NULL OR ABS(poi.unit_price - lr.unit_price) > 0.001)
           RETURNING poi.id
         )
         SELECT COUNT(*)::int AS updated FROM upd`
      );
      console.log(`  ${res.rows[0].updated} ligne(s) BC mise(s) a jour\n`);
    } else if (APPLY) {
      console.log(`${C.bold}${C.magenta}── Application des updates ──${C.reset}`);
      console.log(`  Rien a faire.\n`);
    }

    // Persistence
    if (COMMIT && APPLY) {
      await client.query('COMMIT');
      console.log(`${C.bold}${C.green}✓ COMMIT effectue${C.reset}`);
    } else {
      await client.query('ROLLBACK');
      if (APPLY) {
        console.log(`${C.bold}${C.yellow}↩ ROLLBACK (dry-run). Relance avec --commit pour persister.${C.reset}`);
      } else {
        console.log(`${C.dim}Diagnostic seul, aucune modification. Relance avec --apply pour preparer un update.${C.reset}`);
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
