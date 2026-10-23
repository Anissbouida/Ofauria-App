import { db } from '../config/database.js';

/**
 * Chaîne de rappel (recall) — traçabilité descendante complète.
 *
 * À partir d'un lot de matière première (ingredient_lots), on remonte tout l'aval :
 *   ingredient_lot
 *     → production_lot_usage (quelle matière a servi quel plan)
 *       → production_plans
 *         → product_lots (fournées de produit fini)
 *           → sale_item_lots (mig 333 : quel lot a servi quelle ligne de vente)
 *             → sales / customers (clients à contacter)
 *
 * On suit aussi les liens de recyclage : un lot produit recyclé engendre un
 * nouveau lot de matière (ingredient_lots.source_product_lot_id) qu'on explore
 * récursivement (anti-cycle par ensemble visité + profondeur bornée).
 *
 * Deux limites métier explicitement signalées dans la sortie :
 *   - ventes anonymes (POS walk-in sans customer_id) → pas de client nominatif,
 *     on fournit date + magasin + caissier.
 *   - ventes antérieures à la mig 333 → pas de lien par ligne ; repli approximatif
 *     par recoupement de dates (ventes du produit dans la fenêtre DLC du lot, sur
 *     le même magasin, sans lien), marqué `approximate`.
 */

const MAX_RECYCLE_DEPTH = 5;

export interface RecallSale {
  saleItemId: string;
  saleId: string;
  saleNumber: string | null;
  createdAt: string;
  quantity: number;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  storeId: string | null;
  storeName: string | null;
  cashierName: string | null;
  /** true = recoupement approximatif (vente sans lien par ligne). */
  approximate: boolean;
}

export interface RecallBatch {
  productLotId: string;
  productId: string;
  productName: string;
  lotNumber: string;
  producedAt: string;
  expiresAt: string | null;
  displayExpiresAt: string | null;
  status: string;
  quantityTotal: number;
  states: {
    sold: number;
    backroom: number;
    vitrine: number;
    wasted: number;
    recycled: number;
  };
  /** Quantité vendue effectivement reliée à des lignes de vente (mig 333). */
  linkedSoldQty: number;
  sales: RecallSale[];
  approximateSales: RecallSale[];
  /** Lots matière issus du recyclage de cette fournée (chaîne poursuivie). */
  recycledInto: RecallNode[];
}

export interface RecallPlan {
  productionPlanId: string;
  planDate: string | null;
  planStatus: string | null;
  planType: string | null;
  ingredientName: string;
  /** Quantité de la matière du lot courant consommée par ce plan. */
  quantityUsed: number;
  batches: RecallBatch[];
}

export interface RecallNode {
  ingredientLot: {
    id: string;
    lotNumber: string;
    supplierLotNumber: string | null;
    ingredientName: string | null;
    supplierName: string | null;
    expirationDate: string | null;
    receivedAt: string | null;
    status: string;
    quantityReceived: number;
  };
  /** true si ce lot matière provient du recyclage d'une fournée. */
  recycled: boolean;
  /** Fournée recyclée à l'origine de ce lot (si recycled). */
  sourceProductLotId: string | null;
  plans: RecallPlan[];
}

export interface RecallResult {
  root: RecallNode;
  summary: {
    totalPlans: number;
    totalBatches: number;
    soldQty: number;
    inStockQty: number;
    wastedQty: number;
    recycledQty: number;
    tracedSalesCount: number;
    approximateSalesCount: number;
    /** Clients nominatifs distincts à contacter (tracés + approximatifs). */
    customersToContact: number;
    /** Ventes sans client identifié (walk-in). */
    anonymousSalesCount: number;
  };
  generatedAt: string;
}

const num = (v: unknown): number => (v == null ? 0 : parseFloat(String(v)));

export const recallRepository = {
  async recallFromIngredientLot(lotId: string): Promise<RecallResult | null> {
    const rootRow = await fetchIngredientLot(lotId);
    if (!rootRow) return null;

    const visited = new Set<string>();
    const root = await buildNode(rootRow, false, null, visited, 0);

    const summary = summarize(root);
    return { root, summary, generatedAt: new Date().toISOString() };
  },
};

async function fetchIngredientLot(lotId: string) {
  const res = await db.query(
    `SELECT il.id, il.lot_number, il.supplier_lot_number, il.expiration_date,
            il.received_at, il.status, il.quantity_received,
            ing.name AS ingredient_name,
            s.name AS supplier_name
     FROM ingredient_lots il
     LEFT JOIN ingredients ing ON ing.id = il.ingredient_id
     LEFT JOIN suppliers s ON s.id = il.supplier_id
     WHERE il.id = $1`,
    [lotId]
  );
  return res.rows[0] || null;
}

async function buildNode(
  lotRow: Record<string, unknown>,
  recycled: boolean,
  sourceProductLotId: string | null,
  visited: Set<string>,
  depth: number
): Promise<RecallNode> {
  const lotIdStr = String(lotRow.id);
  const node: RecallNode = {
    ingredientLot: {
      id: lotIdStr,
      lotNumber: String(lotRow.lot_number),
      supplierLotNumber: (lotRow.supplier_lot_number as string) ?? null,
      ingredientName: (lotRow.ingredient_name as string) ?? null,
      supplierName: (lotRow.supplier_name as string) ?? null,
      expirationDate: lotRow.expiration_date ? String(lotRow.expiration_date) : null,
      receivedAt: lotRow.received_at ? String(lotRow.received_at) : null,
      status: String(lotRow.status),
      quantityReceived: num(lotRow.quantity_received),
    },
    recycled,
    sourceProductLotId,
    plans: [],
  };

  // Anti-cycle + profondeur bornée : on renvoie le nœud sans descendants.
  if (visited.has(lotIdStr) || depth > MAX_RECYCLE_DEPTH) return node;
  visited.add(lotIdStr);

  const planRows = await db.query(
    `SELECT plu.production_plan_id, plu.quantity_used,
            pp.plan_date, pp.status AS plan_status, pp.type AS plan_type,
            ing.name AS ingredient_name
     FROM production_lot_usage plu
     JOIN production_plans pp ON pp.id = plu.production_plan_id
     LEFT JOIN ingredients ing ON ing.id = plu.ingredient_id
     WHERE plu.ingredient_lot_id = $1
     ORDER BY pp.plan_date DESC`,
    [lotIdStr]
  );

  for (const pr of planRows.rows) {
    const batches = await buildBatches(String(pr.production_plan_id), visited, depth);
    node.plans.push({
      productionPlanId: String(pr.production_plan_id),
      planDate: pr.plan_date ? String(pr.plan_date) : null,
      planStatus: (pr.plan_status as string) ?? null,
      planType: (pr.plan_type as string) ?? null,
      ingredientName: (pr.ingredient_name as string) ?? '',
      quantityUsed: num(pr.quantity_used),
      batches,
    });
  }

  return node;
}

async function buildBatches(
  planId: string,
  visited: Set<string>,
  depth: number
): Promise<RecallBatch[]> {
  const lotRows = await db.query(
    `SELECT pl.id, pl.product_id, pl.lot_number, pl.produced_at, pl.expires_at,
            pl.display_expires_at, pl.status, pl.quantity_total,
            pl.backroom_qty, pl.vitrine_qty, pl.sold_qty, pl.wasted_qty, pl.recycled_qty,
            pl.store_id,
            p.name AS product_name
     FROM product_lots pl
     LEFT JOIN products p ON p.id = pl.product_id
     WHERE pl.production_plan_id = $1
     ORDER BY pl.produced_at`,
    [planId]
  );

  const batches: RecallBatch[] = [];
  for (const b of lotRows.rows) {
    const productLotId = String(b.id);
    const sales = await fetchTracedSales(productLotId);
    const linkedSoldQty = sales.reduce((s, x) => s + x.quantity, 0);
    const approximateSales = await fetchApproximateSales(
      String(b.product_id),
      b.store_id ? String(b.store_id) : null,
      b.produced_at ? String(b.produced_at) : null,
      b.expires_at ? String(b.expires_at) : null
    );

    // Suivi des liens de recyclage : lots matière nés de cette fournée.
    const recycledLots = await db.query(
      `SELECT il.id, il.lot_number, il.supplier_lot_number, il.expiration_date,
              il.received_at, il.status, il.quantity_received,
              ing.name AS ingredient_name, s.name AS supplier_name
       FROM ingredient_lots il
       LEFT JOIN ingredients ing ON ing.id = il.ingredient_id
       LEFT JOIN suppliers s ON s.id = il.supplier_id
       WHERE il.source_product_lot_id = $1`,
      [productLotId]
    );
    const recycledInto: RecallNode[] = [];
    for (const rl of recycledLots.rows) {
      recycledInto.push(await buildNode(rl, true, productLotId, visited, depth + 1));
    }

    batches.push({
      productLotId,
      productId: String(b.product_id),
      productName: (b.product_name as string) ?? '',
      lotNumber: String(b.lot_number),
      producedAt: b.produced_at ? String(b.produced_at) : '',
      expiresAt: b.expires_at ? String(b.expires_at) : null,
      displayExpiresAt: b.display_expires_at ? String(b.display_expires_at) : null,
      status: String(b.status),
      quantityTotal: num(b.quantity_total),
      states: {
        sold: num(b.sold_qty),
        backroom: num(b.backroom_qty),
        vitrine: num(b.vitrine_qty),
        wasted: num(b.wasted_qty),
        recycled: num(b.recycled_qty),
      },
      linkedSoldQty,
      sales,
      approximateSales,
      recycledInto,
    });
  }
  return batches;
}

async function fetchTracedSales(productLotId: string): Promise<RecallSale[]> {
  const res = await db.query(
    `SELECT sil.sale_item_id, sil.quantity,
            s.id AS sale_id, s.sale_number, s.created_at, s.customer_id,
            s.store_id, s.user_id,
            c.first_name AS customer_first, c.last_name AS customer_last, c.phone AS customer_phone,
            st.name AS store_name,
            u.first_name AS cashier_first, u.last_name AS cashier_last
     FROM sale_item_lots sil
     JOIN sale_items si ON si.id = sil.sale_item_id
     JOIN sales s ON s.id = si.sale_id
     LEFT JOIN customers c ON c.id = s.customer_id
     LEFT JOIN stores st ON st.id = s.store_id
     LEFT JOIN users u ON u.id = s.user_id
     WHERE sil.product_lot_id = $1
     ORDER BY s.created_at`,
    [productLotId]
  );
  return res.rows.map(mapSaleRow(false));
}

async function fetchApproximateSales(
  productId: string,
  storeId: string | null,
  producedAt: string | null,
  expiresAt: string | null
): Promise<RecallSale[]> {
  // Sans magasin ni date de production, le recoupement n'a pas de sens.
  if (!storeId || !producedAt) return [];

  // Fenêtre : de la production à la DLC (fin de journée). Sans DLC, on retient
  // une fenêtre de sécurité de 7 jours après production.
  const endExpr = expiresAt
    ? `($4::date + INTERVAL '1 day')`
    : `($3::timestamptz + INTERVAL '7 days')`;

  const res = await db.query(
    `SELECT si.id AS sale_item_id, si.quantity,
            s.id AS sale_id, s.sale_number, s.created_at, s.customer_id,
            s.store_id, s.user_id,
            c.first_name AS customer_first, c.last_name AS customer_last, c.phone AS customer_phone,
            st.name AS store_name,
            u.first_name AS cashier_first, u.last_name AS cashier_last
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     LEFT JOIN customers c ON c.id = s.customer_id
     LEFT JOIN stores st ON st.id = s.store_id
     LEFT JOIN users u ON u.id = s.user_id
     WHERE si.product_id = $1
       AND s.store_id = $2
       AND s.created_at >= $3::timestamptz
       AND s.created_at <= ${endExpr}
       AND NOT EXISTS (SELECT 1 FROM sale_item_lots sil WHERE sil.sale_item_id = si.id)
     ORDER BY s.created_at`,
    expiresAt ? [productId, storeId, producedAt, expiresAt] : [productId, storeId, producedAt]
  );
  return res.rows.map(mapSaleRow(true));
}

function mapSaleRow(approximate: boolean) {
  return (r: Record<string, unknown>): RecallSale => {
    const first = (r.customer_first as string) || '';
    const last = (r.customer_last as string) || '';
    const customerName = r.customer_id ? `${first} ${last}`.trim() || null : null;
    const cashierFirst = (r.cashier_first as string) || '';
    const cashierLast = (r.cashier_last as string) || '';
    const cashierName = `${cashierFirst} ${cashierLast}`.trim() || null;
    return {
      saleItemId: String(r.sale_item_id),
      saleId: String(r.sale_id),
      saleNumber: (r.sale_number as string) ?? null,
      createdAt: r.created_at ? String(r.created_at) : '',
      quantity: num(r.quantity),
      customerId: r.customer_id ? String(r.customer_id) : null,
      customerName,
      customerPhone: (r.customer_phone as string) ?? null,
      storeId: r.store_id ? String(r.store_id) : null,
      storeName: (r.store_name as string) ?? null,
      cashierName,
      approximate,
    };
  };
}

function summarize(root: RecallNode): RecallResult['summary'] {
  let totalPlans = 0;
  let totalBatches = 0;
  let soldQty = 0;
  let inStockQty = 0;
  let wastedQty = 0;
  let recycledQty = 0;
  let tracedSalesCount = 0;
  let approximateSalesCount = 0;
  let anonymousSalesCount = 0;
  const customers = new Set<string>();

  const walk = (node: RecallNode) => {
    totalPlans += node.plans.length;
    for (const plan of node.plans) {
      totalBatches += plan.batches.length;
      for (const batch of plan.batches) {
        soldQty += batch.states.sold;
        inStockQty += batch.states.backroom + batch.states.vitrine;
        wastedQty += batch.states.wasted;
        recycledQty += batch.states.recycled;
        for (const sale of [...batch.sales, ...batch.approximateSales]) {
          if (sale.approximate) approximateSalesCount++;
          else tracedSalesCount++;
          if (sale.customerId) customers.add(sale.customerId);
          else anonymousSalesCount++;
        }
        for (const child of batch.recycledInto) walk(child);
      }
    }
  };
  walk(root);

  return {
    totalPlans,
    totalBatches,
    soldQty,
    inStockQty,
    wastedQty,
    recycledQty,
    tracedSalesCount,
    approximateSalesCount,
    customersToContact: customers.size,
    anonymousSalesCount,
  };
}
