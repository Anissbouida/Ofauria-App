import { db } from '../config/database.js';
import { nextDocumentNumber } from '../utils/document-number.js';
import { adjustProductStock } from './product-stock.helper.js';

// Transferts de produits finis entre sites (phase 7.4). Une pièce, deux mouvements :
// sortie du site source, entrée au site destination, tracés dans product_stock_transactions.

const fail = (code: number, msg: string) => Object.assign(new Error(msg), { statusCode: code });

export interface TransferItemInput { productId: string; quantity: number }

export const productTransferRepository = {
  async list(params: { storeId?: string | null } = {}) {
    const cond: string[] = ['true'];
    const vals: unknown[] = [];
    if (params.storeId) { vals.push(params.storeId); cond.push(`(t.from_store_id = $1 OR t.to_store_id = $1)`); }
    return (await db.query(
      `SELECT t.*, fs.name AS from_store_name, ts.name AS to_store_name,
              (SELECT count(*) FROM product_transfer_items i WHERE i.transfer_id = t.id) AS item_count
         FROM product_transfers t
         JOIN stores fs ON fs.id = t.from_store_id
         JOIN stores ts ON ts.id = t.to_store_id
        WHERE ${cond.join(' AND ')}
        ORDER BY t.transfer_date DESC, t.created_at DESC LIMIT 200`, vals)).rows;
  },

  async get(id: string) {
    const t = (await db.query(`SELECT * FROM product_transfers WHERE id = $1`, [id])).rows[0];
    if (!t) return null;
    const items = (await db.query(
      `SELECT i.*, p.name AS product_name FROM product_transfer_items i JOIN products p ON p.id = i.product_id WHERE i.transfer_id = $1`, [id])).rows;
    return { ...t, items };
  },

  /** Exécute le transfert : sort du source, entre au destination, deux mouvements par article. */
  async create(data: { fromStoreId: string; toStoreId: string; items: TransferItemInput[]; notes?: string | null; transferDate?: string | null; createdBy: string }) {
    if (data.fromStoreId === data.toStoreId) throw fail(400, 'Le site source et le site destination doivent être différents');
    const items = data.items.filter(i => i.productId && Number(i.quantity) > 0);
    if (!items.length) throw fail(400, 'Ajoutez au moins une ligne');
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const stores = (await client.query(`SELECT id FROM stores WHERE id = ANY($1) AND is_active`, [[data.fromStoreId, data.toStoreId]])).rows;
      if (stores.length < 2) throw fail(400, 'Site source ou destination introuvable');
      const number = await nextDocumentNumber(client, 'product_transfer', data.transferDate ?? undefined);
      const head = (await client.query(
        `INSERT INTO product_transfers (number, from_store_id, to_store_id, transfer_date, notes, created_by)
         VALUES ($1,$2,$3, COALESCE($4::date, CURRENT_DATE), $5, $6) RETURNING *`,
        [number, data.fromStoreId, data.toStoreId, data.transferDate ?? null, data.notes ?? null, data.createdBy])).rows[0];
      for (const it of items) {
        const qty = Number(it.quantity);
        // Stock disponible au source (verrouillé) : un transfert ne crée pas de stock négatif.
        const src = (await client.query(
          `SELECT stock_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2 FOR UPDATE`,
          [it.productId, data.fromStoreId])).rows[0];
        if (!src || Number(src.stock_quantity) < qty - 0.0001) {
          throw fail(409, `Stock insuffisant au site source pour l'article (${src ? Number(src.stock_quantity) : 0} disponible, ${qty} demandé)`);
        }
        await client.query(`INSERT INTO product_transfer_items (transfer_id, product_id, quantity) VALUES ($1,$2,$3)`, [head.id, it.productId, qty]);
        // Deux mouvements : sortie source, entrée destination (stock_after = solde après).
        const afterFrom = await adjustProductStock(client, it.productId, -qty, data.fromStoreId);
        const afterTo = await adjustProductStock(client, it.productId, qty, data.toStoreId);
        await client.query(
          `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, reference_id, store_id, performed_by)
           VALUES ($1,'transfer_out',$2,$3,$4,$5,$6), ($1,'transfer_in',$7,$8,$4,$9,$6)`,
          [it.productId, -qty, afterFrom, head.id, data.fromStoreId, data.createdBy, qty, afterTo, data.toStoreId]);
      }
      await client.query('COMMIT');
      return head;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};
