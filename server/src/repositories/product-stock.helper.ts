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
