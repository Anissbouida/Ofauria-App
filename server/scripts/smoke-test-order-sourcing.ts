/**
 * Smoke test : verifier que la creation d'une commande declenche bien le
 * sourcing automatique (stock + plan de production) comme l'approvisionnement.
 *
 * Scenario :
 *   1) Etat initial : stock magasin brownie = 30, ordering 50 brownies
 *   2) Resultat attendu : qty_from_stock = 30, qty_to_produce = 20 (+ calcul inverse → 40 = 1 contenant)
 *   3) Un production_plan est cree avec order_id = la commande
 *   4) La commande passe en status 'in_production'
 *   5) Cleanup : rollback de la commande de test
 */

import { db } from '../src/config/database.js';
import { orderRepository } from '../src/repositories/order.repository.js';

const STORE_ID = '00000000-0000-0000-0000-000000000001';
const BROWNIE_ID = 'a4cf7cd0-325b-4d0d-a79a-6b7653503fa7';

async function main() {
  console.log('═══ Smoke test : commande avec sourcing automatique ═══\n');

  // Etat initial
  const stockBefore = await db.query(
    `SELECT stock_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2`,
    [BROWNIE_ID, STORE_ID]
  );
  console.log(`Stock magasin avant : ${stockBefore.rows[0]?.stock_quantity ?? 0} brownies`);

  // Trouver un user existant pour user_id
  const userRes = await db.query(`SELECT id FROM users LIMIT 1`);
  const userId = userRes.rows[0].id as string;

  // Creer la commande (50 brownies — depasse le stock)
  const orderNumber = `TEST-${Date.now()}`;
  console.log(`\nCreation commande ${orderNumber} : 50 brownies @ 10 DH ...`);

  const order = await orderRepository.create({
    orderNumber,
    userId,
    type: 'custom',
    subtotal: 500,
    taxAmount: 0,
    discountAmount: 0,
    total: 500,
    paymentMethod: 'cash',
    pickupDate: new Date(Date.now() + 86400000).toISOString(),
    storeId: STORE_ID,
    items: [
      { productId: BROWNIE_ID, quantity: 50, unitPrice: 10, subtotal: 500 },
    ],
  });

  const orderId = order.id as string;
  const planId = (order as Record<string, unknown>)._productionPlanId as string | null;
  console.log(`  → commande id ${orderId.slice(0, 8)}...`);
  console.log(`  → production_plan_id : ${planId ?? 'null'}`);

  // Verifier le statut de la commande
  const statusRes = await db.query(`SELECT status FROM orders WHERE id = $1`, [orderId]);
  console.log(`  → statut commande : ${statusRes.rows[0].status}`);

  // Verifier le sourcing des items
  const itemsRes = await db.query(
    `SELECT product_id, quantity, source_type, qty_from_stock, qty_to_produce, production_plan_id, status
     FROM order_items WHERE order_id = $1`,
    [orderId]
  );
  console.log(`\nLignes commande :`);
  for (const it of itemsRes.rows) {
    console.log(
      `  product=${(it.product_id as string).slice(0, 8)}... qty=${it.quantity} source=${it.source_type} ` +
      `fromStock=${it.qty_from_stock} toProduce=${it.qty_to_produce} plan=${(it.production_plan_id as string | null)?.slice(0, 8) ?? 'null'} status=${it.status}`
    );
  }

  // Verifier le plan de production
  if (planId) {
    const planItemsRes = await db.query(
      `SELECT product_id, planned_quantity, nb_contenants, quantite_nette_cible, qty_from_frigo, surplus_frigo
       FROM production_plan_items WHERE plan_id = $1`,
      [planId]
    );
    console.log(`\nLignes plan production :`);
    for (const pi of planItemsRes.rows) {
      console.log(
        `  product=${(pi.product_id as string).slice(0, 8)}... planned_qty=${pi.planned_quantity} ` +
        `nbContenants=${pi.nb_contenants} netteCible=${pi.quantite_nette_cible} ` +
        `fromFrigo=${pi.qty_from_frigo} surplus=${pi.surplus_frigo}`
      );
    }

    const planRes = await db.query(
      `SELECT order_id, replenishment_request_id, target_role, notes, status FROM production_plans WHERE id = $1`,
      [planId]
    );
    const p = planRes.rows[0];
    console.log(
      `\nPlan production : order_id=${(p.order_id as string)?.slice(0, 8) ?? 'null'} ` +
      `replenishment=${(p.replenishment_request_id as string)?.slice(0, 8) ?? 'null'} ` +
      `target_role=${p.target_role ?? 'null'} status=${p.status}`
    );
    console.log(`  notes : "${p.notes}"`);
  }

  // CLEANUP : tout supprimer (cascade par FK)
  console.log(`\nCleanup test order + plan...`);
  if (planId) {
    await db.query(`DELETE FROM production_plan_items WHERE plan_id = $1`, [planId]);
    await db.query(`DELETE FROM production_plans WHERE id = $1`, [planId]);
  }
  await db.query(`DELETE FROM order_items WHERE order_id = $1`, [orderId]);
  await db.query(`DELETE FROM orders WHERE id = $1`, [orderId]);
  console.log(`  → cleanup OK`);

  await db.pool.end();
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
