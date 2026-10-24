// Cree un plan de production bloque (1 article annule par cloture partielle,
// 1 article produit) pour eprouver l'action "Relancer le plan" en local.
// Les plans crees portent la note MARKER : la commande 'clean' les supprime tous.
//
// Usage (depuis server/) :
//   npx tsx scripts/seed-plan-bloque-test.ts          -> cree et affiche l'id
//   npx tsx scripts/seed-plan-bloque-test.ts clean    -> supprime les plans de test
import { db } from '../src/config/database.js';

const MARKER = '[TEST RELANCE UI]';

async function main() {
  if (process.argv[2] === 'clean') {
    const r = await db.query(`DELETE FROM production_plans WHERE notes = $1 RETURNING id`, [MARKER]);
    console.log('supprimes:', r.rowCount);
    process.exit(0);
  }

  const p = (await db.query(
    `SELECT * FROM production_plans WHERE status != 'draft' ORDER BY created_at DESC LIMIT 1`
  )).rows[0];
  const prods = (await db.query(`SELECT id, name FROM products LIMIT 2`)).rows;

  const created = await db.query(
    `INSERT INTO production_plans (plan_date, type, status, created_by, store_id, target_role, notes, completed_at, completion_type)
     VALUES (CURRENT_DATE, 'daily', 'completed', $1, $2, $3, $4, NOW(), 'partial') RETURNING id`,
    [p.created_by, p.store_id, p.target_role, MARKER]
  );
  const planId = created.rows[0].id as string;

  await db.query(
    `INSERT INTO production_plan_items (plan_id, product_id, planned_quantity, status, cancelled_at, cancellation_reason)
     VALUES ($1, $2, 12, 'cancelled', NOW(), 'Cloture partielle')`,
    [planId, prods[0].id]
  );
  await db.query(
    `INSERT INTO production_plan_items (plan_id, product_id, planned_quantity, status, actual_quantity)
     VALUES ($1, $2, 8, 'produced', 8)`,
    [planId, prods[1].id]
  );

  console.log('plan de test:', planId, '| annule:', prods[0].name, '| produit:', prods[1].name);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
