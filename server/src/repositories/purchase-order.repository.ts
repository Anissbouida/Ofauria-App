import { db } from '../config/database.js';
import { receptionVoucherRepository } from './reception-voucher.repository.js';
import { getLocalYear } from '../utils/timezone.js';

export const purchaseOrderRepository = {
  async findAll(params: { supplierId?: string; status?: string; dateFrom?: string; dateTo?: string; storeId?: string }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (params.storeId) { conditions.push(`po.store_id = $${i++}`); values.push(params.storeId); }
    if (params.supplierId) { conditions.push(`po.supplier_id = $${i++}`); values.push(params.supplierId); }
    if (params.status) { conditions.push(`po.status = $${i++}`); values.push(params.status); }
    if (params.dateFrom) { conditions.push(`po.order_date >= $${i++}`); values.push(params.dateFrom); }
    if (params.dateTo) { conditions.push(`po.order_date <= $${i++}`); values.push(params.dateTo); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await db.query(
      `SELECT po.*, s.name as supplier_name,
              u.first_name || ' ' || u.last_name as created_by_name,
              (SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = po.id) as item_count,
              (SELECT COALESCE(SUM(quantity_ordered * COALESCE(unit_price, 0)), 0) FROM purchase_order_items WHERE purchase_order_id = po.id) as total_amount,
              (SELECT COALESCE(SUM(quantity_delivered * COALESCE(unit_price, 0)), 0) FROM purchase_order_items WHERE purchase_order_id = po.id) as delivered_amount,
              (SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = po.id AND unit_price IS NULL) as items_without_price
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN users u ON u.id = po.created_by
       ${where}
       ORDER BY po.order_date DESC, po.created_at DESC`,
      values
    );
    return result.rows;
  },

  async findEligibleForExpense(storeId?: string) {
    const storeFilter = storeId ? 'AND po.store_id = $1' : '';
    const params = storeId ? [storeId] : [];
    const result = await db.query(
      `SELECT po.id, po.order_number, po.order_date, po.status, po.supplier_id,
              s.name as supplier_name,
              (SELECT COALESCE(SUM(quantity_delivered * COALESCE(unit_price, 0)), 0) FROM purchase_order_items WHERE purchase_order_id = po.id) as total_amount
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.status IN ('livre_complet', 'livre_partiel', 'envoye', 'en_attente', 'en_attente_facturation')
       ${storeFilter}
       ORDER BY po.order_date DESC`,
      params
    );
    return result.rows;
  },

  async findById(id: string) {
    const poResult = await db.query(
      `SELECT po.*, s.name as supplier_name, s.phone as supplier_phone, s.contact_name as supplier_contact,
              u.first_name || ' ' || u.last_name as created_by_name
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN users u ON u.id = po.created_by
       WHERE po.id = $1`,
      [id]
    );
    if (!poResult.rows[0]) return null;

    const itemsResult = await db.query(
      `SELECT poi.*, ing.name as ingredient_name, ing.unit as ingredient_unit
       FROM purchase_order_items poi
       JOIN ingredients ing ON ing.id = poi.ingredient_id
       WHERE poi.purchase_order_id = $1
       ORDER BY ing.name`,
      [id]
    );

    return { ...poResult.rows[0], items: itemsResult.rows };
  },

  async generateOrderNumber(): Promise<string> {
    const year = getLocalYear();
    const result = await db.query(
      `SELECT COUNT(*) FROM purchase_orders WHERE EXTRACT(YEAR FROM order_date) = $1`,
      [year]
    );
    const seq = parseInt(result.rows[0].count) + 1;
    return `BC-${year}-${String(seq).padStart(4, '0')}`;
  },

  async create(data: {
    supplierId: string; expectedDeliveryDate?: string; notes?: string;
    createdBy: string; storeId?: string;
    items: { ingredientId: string; quantityOrdered: number; unitPrice?: number | null }[];
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const orderNumber = await this.generateOrderNumber();
      const poResult = await client.query(
        `INSERT INTO purchase_orders (order_number, supplier_id, expected_delivery_date, notes, created_by, store_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [orderNumber, data.supplierId, data.expectedDeliveryDate || null,
         data.notes || null, data.createdBy, data.storeId || null]
      );

      for (const item of data.items) {
        await client.query(
          `INSERT INTO purchase_order_items (purchase_order_id, ingredient_id, quantity_ordered, unit_price)
           VALUES ($1, $2, $3, $4)`,
          [poResult.rows[0].id, item.ingredientId, item.quantityOrdered, item.unitPrice ?? null]
        );
      }

      await client.query('COMMIT');
      return poResult.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async updateStatus(id: string, status: string) {
    const result = await db.query(
      `UPDATE purchase_orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, id]
    );
    return result.rows[0];
  },

  async confirmDelivery(
    id: string,
    items: { itemId: string; quantityDelivered: number; unitPrice?: number | null; supplierLotNumber?: string; expirationDate?: string; manufacturedDate?: string }[],
    performedBy: string,
    storeId?: string
  ) {
    // Get PO items to map ingredientId
    const po = await this.findById(id);
    if (!po) throw new Error('Bon de commande non trouve');

    const rvItems = items
      .filter(it => it.quantityDelivered > 0)
      .map(it => {
        const poItem = po.items.find((pi: Record<string, unknown>) => pi.id === it.itemId);
        return {
          poItemId: it.itemId,
          ingredientId: poItem?.ingredient_id as string,
          quantityReceived: it.quantityDelivered,
          unitPrice: it.unitPrice ?? (poItem?.unit_price ? parseFloat(poItem.unit_price as string) : null),
          supplierLotNumber: it.supplierLotNumber,
          expirationDate: it.expirationDate,
          manufacturedDate: it.manufacturedDate,
        };
      });

    const result = await receptionVoucherRepository.create({
      purchaseOrderId: id,
      notes: `Reception depuis confirmation de livraison BC ${po.order_number}`,
      receivedBy: performedBy,
      storeId,
      items: rvItems,
    });

    return { status: result.status, voucherId: result.id, voucherNumber: result.voucher_number };
  },

  async updateItemPrices(id: string, items: { itemId: string; unitPrice: number }[]) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      for (const item of items) {
        await client.query(
          `UPDATE purchase_order_items SET unit_price = $1 WHERE id = $2 AND purchase_order_id = $3`,
          [item.unitPrice, item.itemId, id]
        );
      }

      // Check if all items now have prices
      const remaining = await client.query(
        `SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = $1 AND unit_price IS NULL`,
        [id]
      );
      const stillMissing = parseInt(remaining.rows[0].count);

      // If was en_attente_facturation and all prices now set, move to livre_complet
      if (stillMissing === 0) {
        const poCheck = await client.query(
          `SELECT status FROM purchase_orders WHERE id = $1`, [id]
        );
        if (poCheck.rows[0]?.status === 'en_attente_facturation') {
          // Check if actually all delivered
          const allItems = await client.query(
            `SELECT quantity_ordered, quantity_delivered FROM purchase_order_items WHERE purchase_order_id = $1`,
            [id]
          );
          const allDelivered = allItems.rows.every(
            (it: Record<string, unknown>) => parseFloat(it.quantity_delivered as string) >= parseFloat(it.quantity_ordered as string)
          );
          if (allDelivered) {
            await client.query(
              `UPDATE purchase_orders SET status = 'livre_complet', updated_at = NOW() WHERE id = $1`, [id]
            );
          }
        }
      }

      // Update ingredient unit_costs
      for (const item of items) {
        const poItem = await client.query(
          `SELECT ingredient_id FROM purchase_order_items WHERE id = $1`, [item.itemId]
        );
        if (poItem.rows[0]) {
          await client.query(
            `UPDATE ingredients SET unit_cost = $1 WHERE id = $2`,
            [item.unitPrice, poItem.rows[0].ingredient_id]
          );
        }
      }

      await client.query('COMMIT');
      return { itemsUpdated: items.length, stillMissingPrices: stillMissing };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async findOverdue(days: number = 3) {
    const result = await db.query(
      `SELECT po.*, s.name as supplier_name,
              (SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = po.id) as item_count,
              (SELECT COALESCE(SUM(quantity_ordered * COALESCE(unit_price, 0)), 0) FROM purchase_order_items WHERE purchase_order_id = po.id) as total_amount
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.status IN ('en_attente', 'envoye', 'livre_partiel')
         AND po.expected_delivery_date IS NOT NULL
         AND po.expected_delivery_date < CURRENT_DATE - $1::int * INTERVAL '1 day'
       ORDER BY po.expected_delivery_date ASC`,
      [days]
    );
    return result.rows;
  },

  async delete(id: string) {
    await db.query('DELETE FROM purchase_orders WHERE id = $1 AND status = \'en_attente\'', [id]);
  },
};
