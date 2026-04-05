import { db } from '../config/database.js';

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
              (SELECT COALESCE(SUM(quantity_ordered * unit_price), 0) FROM purchase_order_items WHERE purchase_order_id = po.id) as total_amount,
              (SELECT COALESCE(SUM(quantity_delivered * unit_price), 0) FROM purchase_order_items WHERE purchase_order_id = po.id) as delivered_amount
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN users u ON u.id = po.created_by
       ${where}
       ORDER BY po.order_date DESC, po.created_at DESC`,
      values
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
    const year = new Date().getFullYear();
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
    items: { ingredientId: string; quantityOrdered: number; unitPrice: number }[];
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
          [poResult.rows[0].id, item.ingredientId, item.quantityOrdered, item.unitPrice]
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
    items: { itemId: string; quantityDelivered: number }[],
    performedBy: string,
    storeId?: string
  ) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Get PO info
      const poResult = await client.query(
        `SELECT po.*, s.name as supplier_name FROM purchase_orders po
         JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = $1`,
        [id]
      );
      const po = poResult.rows[0];
      if (!po) throw new Error('Bon de commande non trouve');

      let totalDeliveredValue = 0;

      for (const item of items) {
        if (item.quantityDelivered <= 0) continue;

        // Update purchase_order_items.quantity_delivered
        const itemResult = await client.query(
          `UPDATE purchase_order_items
           SET quantity_delivered = quantity_delivered + $1
           WHERE id = $2 RETURNING *`,
          [item.quantityDelivered, item.itemId]
        );
        const poItem = itemResult.rows[0];
        if (!poItem) continue;

        totalDeliveredValue += item.quantityDelivered * parseFloat(poItem.unit_price);

        // Update inventory
        const storeFilter = storeId ? ' AND store_id = $3' : '';
        const invParams: unknown[] = [item.quantityDelivered, poItem.ingredient_id];
        if (storeId) invParams.push(storeId);

        await client.query(
          `UPDATE inventory SET current_quantity = current_quantity + $1,
                  last_restocked_at = NOW(), updated_at = NOW()
           WHERE ingredient_id = $2${storeFilter}`,
          invParams
        );

        // Also update ingredient unit_cost from PO price
        if (parseFloat(poItem.unit_price) > 0) {
          await client.query(
            `UPDATE ingredients SET unit_cost = $1 WHERE id = $2`,
            [poItem.unit_price, poItem.ingredient_id]
          );
        }

        // Insert inventory transaction with traceability
        await client.query(
          `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, note, performed_by, purchase_order_item_id, store_id)
           VALUES ($1, 'purchase_order', $2, $3, $4, $5, $6)`,
          [poItem.ingredient_id, item.quantityDelivered,
           `Reception BC ${po.order_number} — Fournisseur: ${po.supplier_name}`,
           performedBy, item.itemId, storeId || null]
        );
      }

      // Determine new PO status
      const allItems = await client.query(
        `SELECT quantity_ordered, quantity_delivered FROM purchase_order_items WHERE purchase_order_id = $1`,
        [id]
      );
      const allDelivered = allItems.rows.every(
        (it: Record<string, unknown>) => parseFloat(it.quantity_delivered as string) >= parseFloat(it.quantity_ordered as string)
      );
      const someDelivered = allItems.rows.some(
        (it: Record<string, unknown>) => parseFloat(it.quantity_delivered as string) > 0
      );

      const newStatus = allDelivered ? 'livre_complet' : someDelivered ? 'livre_partiel' : 'non_livre';
      await client.query(
        `UPDATE purchase_orders SET status = $1, delivery_date = CURRENT_DATE, updated_at = NOW() WHERE id = $2`,
        [newStatus, id]
      );

      // Auto-create invoice for received goods
      if (totalDeliveredValue > 0) {
        // Find "Matieres premieres" category
        const catResult = await client.query(
          `SELECT id FROM expense_categories WHERE name ILIKE '%matieres%' OR name ILIKE '%matiere%' LIMIT 1`
        );
        const categoryId = catResult.rows[0]?.id || null;

        const invNumber = `FC-${po.order_number}`;
        await client.query(
          `INSERT INTO invoices (invoice_number, supplier_id, category_id, invoice_date, amount, tax_amount, total_amount, notes, created_by)
           VALUES ($1, $2, $3, CURRENT_DATE, $4, 0, $4, $5, $6)
           ON CONFLICT DO NOTHING`,
          [invNumber, po.supplier_id, categoryId, totalDeliveredValue,
           `Auto-genere depuis reception ${po.order_number}`, performedBy]
        );
      }

      await client.query('COMMIT');
      return { status: newStatus };
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
              (SELECT COALESCE(SUM(quantity_ordered * unit_price), 0) FROM purchase_order_items WHERE purchase_order_id = po.id) as total_amount
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.status IN ('en_attente', 'envoye')
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
