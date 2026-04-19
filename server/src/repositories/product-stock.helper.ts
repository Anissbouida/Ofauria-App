/**
 * Centralised helper for product stock operations.
 * When a storeId is provided the stock is read/written from product_store_stock;
 * otherwise falls back to products.stock_quantity (single-store / legacy mode).
 */
import type { PoolClient } from 'pg';
import { db } from '../config/database.js';

/** Decrement (or increment) stock and return the new value */
export async function adjustProductStock(
  client: PoolClient,
  productId: string,
  change: number,
  storeId?: string | null,
): Promise<number> {
  if (storeId) {
    // Upsert into product_store_stock (handles the case where the row doesn't exist yet)
    const result = await client.query(
      `INSERT INTO product_store_stock (product_id, store_id, stock_quantity)
       VALUES ($1, $2, GREATEST(0 + $3, 0))
       ON CONFLICT (product_id, store_id)
       DO UPDATE SET stock_quantity = GREATEST(product_store_stock.stock_quantity + $3, 0), updated_at = NOW()
       RETURNING stock_quantity`,
      [productId, storeId, change],
    );
    return parseFloat(result.rows[0].stock_quantity);
  }

  // Fallback: global stock on products table
  const result = await client.query(
    `UPDATE products SET stock_quantity = GREATEST(stock_quantity + $1, 0), updated_at = NOW()
     WHERE id = $2 RETURNING stock_quantity`,
    [change, productId],
  );
  return parseFloat(result.rows[0]?.stock_quantity ?? 0);
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
  // For decrements (sales), lock the row and validate stock first
  if (change < 0) {
    const lockResult = await client.query(
      `SELECT vitrine_quantity FROM product_store_stock
       WHERE product_id = $1 AND store_id = $2
       FOR UPDATE`,
      [productId, storeId],
    );
    const currentVitrine = lockResult.rows[0] ? parseFloat(lockResult.rows[0].vitrine_quantity) : 0;
    if (currentVitrine < Math.abs(change)) {
      // Allow the sale but clamp to 0 — log the shortfall
      console.warn(`[stock] Vitrine insuffisante pour produit ${productId}: disponible ${currentVitrine}, demandé ${Math.abs(change)}`);
    }
  }

  const result = await client.query(
    `INSERT INTO product_store_stock (product_id, store_id, stock_quantity, vitrine_quantity)
     VALUES ($1, $2, 0, GREATEST(0 + $3, 0))
     ON CONFLICT (product_id, store_id)
     DO UPDATE SET vitrine_quantity = GREATEST(product_store_stock.vitrine_quantity + $3, 0), updated_at = NOW()
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
