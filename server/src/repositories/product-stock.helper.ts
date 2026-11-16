/**
 * Centralised helper for product stock operations.
 * When a storeId is provided the stock is read/written from product_store_stock;
 * otherwise falls back to products.stock_quantity (single-store / legacy mode).
 */
import type { PoolClient } from 'pg';
import { db } from '../config/database.js';
import { FLAGS } from '../config/feature-flags.js';
import { posAllowsNegativeStock } from '../services/module-parameters.service.js';
import { applyStockOut } from '../services/stock-anomaly.js';

/** Decrement (or increment) stock and return the new value.
 *  $N::numeric : sans le cast, GREATEST(0 + $N, 0) fait inférer un entier à Postgres
 *  et une quantité décimale (12,25 kg) est refusée. */
export async function adjustProductStock(
  client: PoolClient,
  productId: string,
  change: number,
  storeId?: string | null,
  /** G0-18 : document à l'origine d'une sortie, pour tracer un manque éventuel. */
  ctx?: { origin?: { type: string; id?: string | null }; userId?: string | null; label?: string | null },
): Promise<number> {
  // G0-18 : le stock AVANT mouvement est lu dans la même instruction, pour qu'une sortie
  // supérieure au disponible soit refusée ou tracée (stock.negative_policy) au lieu de
  // disparaître dans le GREATEST(…, 0).
  let after: number, before: number;
  if (storeId) {
    // Upsert into product_store_stock (handles the case where the row doesn't exist yet)
    const result = await client.query(
      `WITH cur AS (SELECT stock_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2)
       INSERT INTO product_store_stock (product_id, store_id, stock_quantity)
       VALUES ($1, $2, GREATEST(0 + $3::numeric, 0))
       ON CONFLICT (product_id, store_id)
       DO UPDATE SET stock_quantity = GREATEST(product_store_stock.stock_quantity + $3::numeric, 0), updated_at = NOW()
       RETURNING stock_quantity, COALESCE((SELECT stock_quantity FROM cur), 0) AS before`,
      [productId, storeId, change],
    );
    after = parseFloat(result.rows[0].stock_quantity);
    before = parseFloat(result.rows[0].before);
  } else {
    // Fallback: global stock on products table
    const result = await client.query(
      `WITH cur AS (SELECT stock_quantity FROM products WHERE id = $2)
       UPDATE products SET stock_quantity = GREATEST(stock_quantity + $1::numeric, 0), updated_at = NOW()
        WHERE id = $2 RETURNING stock_quantity, COALESCE((SELECT stock_quantity FROM cur), 0) AS before`,
      [change, productId],
    );
    after = parseFloat(result.rows[0]?.stock_quantity ?? 0);
    before = parseFloat(result.rows[0]?.before ?? 0);
  }
  if (change < 0) {
    await applyStockOut(client, { kind: 'product', itemId: productId, storeId: storeId ?? null, requested: -change, available: before,
      origin: ctx?.origin ?? { type: 'product_stock_adjust' }, userId: ctx?.userId ?? null, label: ctx?.label ?? null });
  }
  return after;
}

/** Retire une quantité de la vitrine seule (invendus, pertes, manquants) : bornée à zéro, manque tracé (G0-18). */
export function removeFromVitrine(client: PoolClient, p: {
  productId: string; storeId: string; qty: number;
  origin: { type: string; id?: string | null }; userId?: string | null; label?: string | null;
}): Promise<void> {
  return removeFromStoreStock(client, { productId: p.productId, storeId: p.storeId, backroom: 0, vitrine: p.qty,
    origin: p.origin, userId: p.userId, label: p.label });
}

/**
 * Retire des quantités de la réserve et de la vitrine d'un magasin (mise au rebut d'un lot,
 * péremption). Le stock reste borné à zéro ; un manque par rapport au stock du magasin est
 * tracé (G0-18) : il révèle un écart entre les lots et le stock, jamais un motif de refus.
 */
export async function removeFromStoreStock(client: PoolClient, p: {
  productId: string; storeId: string; backroom: number; vitrine: number; lotId?: string | null;
  origin: { type: string; id?: string | null }; userId?: string | null; label?: string | null;
}): Promise<void> {
  const r = await client.query(
    `WITH cur AS (SELECT stock_quantity, vitrine_quantity FROM product_store_stock WHERE product_id = $3 AND store_id = $4)
     UPDATE product_store_stock
        SET vitrine_quantity = GREATEST(0, vitrine_quantity - $1::numeric),
            stock_quantity   = GREATEST(0, stock_quantity - $2::numeric),
            updated_at = NOW()
      WHERE product_id = $3 AND store_id = $4
      RETURNING (SELECT stock_quantity FROM cur)::float8 AS old_backroom, (SELECT vitrine_quantity FROM cur)::float8 AS old_vitrine`,
    [p.vitrine, p.backroom, p.productId, p.storeId]);
  const oldBackroom = r.rows[0]?.old_backroom ?? 0;
  const oldVitrine = r.rows[0]?.old_vitrine ?? 0;
  // Disponible « utile » : ce que chaque zone pouvait réellement fournir à cette sortie.
  const available = Math.min(p.backroom, Math.max(oldBackroom, 0)) + Math.min(p.vitrine, Math.max(oldVitrine, 0));
  await applyStockOut(client, { kind: 'product', itemId: p.productId, lotId: p.lotId ?? null, storeId: p.storeId,
    requested: p.backroom + p.vitrine, available, origin: p.origin, userId: p.userId ?? null, label: p.label ?? null, neverBlock: true });
}

/** Read current stock for a product in a given store (no transaction needed) */
export async function getProductStock(productId: string, storeId?: string | null): Promise<number> {
  if (storeId) {
    const result = await db.query(
      `SELECT stock_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2`,
      [productId, storeId],
    );
    return parseFloat(result.rows[0]?.stock_quantity ?? 0);
  }
  const result = await db.query(`SELECT stock_quantity FROM products WHERE id = $1`, [productId]);
  return parseFloat(result.rows[0]?.stock_quantity ?? 0);
}

// ─── Vitrine (display) stock helpers ───────────────────────────────────────
// vitrine_quantity is the display/sellable qty per store. It is filled only by
// replenishment reception (backroom → vitrine transfer) and is what the POS
// reads and decrements on every sale.

/** Read current vitrine stock for a product in a given store */
export async function getVitrineStock(productId: string, storeId: string): Promise<number> {
  const result = await db.query(
    `SELECT vitrine_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2`,
    [productId, storeId],
  );
  return parseFloat(result.rows[0]?.vitrine_quantity ?? 0);
}

/** Increment or decrement vitrine stock. Returns the new value.
 *  For decrements (sales), locks the row first to prevent race conditions
 *  between concurrent POS terminals and validates sufficient stock. */
export async function adjustVitrineStock(
  client: PoolClient,
  productId: string,
  storeId: string,
  change: number,
): Promise<number> {
  // For decrements (sales), lock the row and validate stock first.
  // OWASP A04-3 : on refuse explicitement la vente si stock insuffisant,
  // au lieu de clamp a 0 silencieusement (empeche les ventes fantomes).
  //
  // FLAG DE TEST : POS_ALLOW_NEGATIVE_STOCK autorise les ventes en rupture
  // (utile en pre-prod pour tester le flux sans devoir alimenter la vitrine).
  // Quand actif : ni check bloquant, ni clamp a 0 => vitrine_quantity peut
  // passer en negatif. NE PAS ACTIVER EN PRODUCTION.
  // Paramètre métier sales.pos_stock (mig 374), ou forçage de test par l'environnement.
  const allowNegative = await posAllowsNegativeStock();
  if (change < 0 && !allowNegative) {
    const lockResult = await client.query(
      `SELECT vitrine_quantity FROM product_store_stock
       WHERE product_id = $1 AND store_id = $2
       FOR UPDATE`,
      [productId, storeId],
    );
    const currentVitrine = lockResult.rows[0] ? parseFloat(lockResult.rows[0].vitrine_quantity) : 0;
    if (currentVitrine < Math.abs(change)) {
      const err = new Error(
        `Stock vitrine insuffisant pour produit ${productId} : disponible ${currentVitrine}, demande ${Math.abs(change)}`
      ) as Error & { code?: string; statusCode?: number };
      err.code = 'INSUFFICIENT_VITRINE_STOCK';
      err.statusCode = 409;
      throw err;
    }
  }

  // Si allowNegative, on retire le GREATEST(..., 0) pour laisser passer le
  // stock en negatif. Sinon on garde le clamp historique (double garde-fou
  // avec le check ci-dessus).
  const clampedInsert = allowNegative ? '0 + $3::numeric' : 'GREATEST(0 + $3::numeric, 0)';
  const clampedUpdate = allowNegative
    ? 'product_store_stock.vitrine_quantity + $3::numeric'
    : 'GREATEST(product_store_stock.vitrine_quantity + $3::numeric, 0)';
  const result = await client.query(
    `INSERT INTO product_store_stock (product_id, store_id, stock_quantity, vitrine_quantity)
     VALUES ($1, $2, 0, ${clampedInsert})
     ON CONFLICT (product_id, store_id)
     DO UPDATE SET vitrine_quantity = ${clampedUpdate}, updated_at = NOW()
     RETURNING vitrine_quantity`,
    [productId, storeId, change],
  );
  return parseFloat(result.rows[0].vitrine_quantity);
}

/**
 * Transfer up to `desiredQty` from backroom (stock_quantity) to vitrine
 * (vitrine_quantity) for a given (product, store). If backroom doesn't have
 * enough we move whatever is available — the shortfall is a business decision
 * the caller logs (typically the replenishment reception flow, where any
 * discrepancy is already tracked via `qty_received`). Returns the qty moved.
 */
export async function transferBackroomToVitrine(
  client: PoolClient,
  productId: string,
  storeId: string,
  desiredQty: number,
): Promise<number> {
  if (desiredQty <= 0) return 0;

  // Read current backroom qty with a row lock so the subsequent UPDATE is
  // consistent under concurrent receptions.
  const lockResult = await client.query(
    `SELECT stock_quantity FROM product_store_stock
     WHERE product_id = $1 AND store_id = $2
     FOR UPDATE`,
    [productId, storeId],
  );
  if (lockResult.rowCount === 0) {
    // No row yet — nothing in backroom to move.
    return 0;
  }
  const available = parseFloat(lockResult.rows[0].stock_quantity);
  const moved = Math.min(available, desiredQty);
  if (moved <= 0) return 0;

  await client.query(
    `UPDATE product_store_stock
     SET stock_quantity   = stock_quantity - $3,
         vitrine_quantity = vitrine_quantity + $3,
         updated_at = NOW()
     WHERE product_id = $1 AND store_id = $2`,
    [productId, storeId, moved],
  );
  return moved;
}
