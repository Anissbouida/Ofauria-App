import { db } from '../config/database.js';
import { getLocalYear } from '../utils/timezone.js';

export const purchaseRequestRepository = {
  /** List requests with filters */
  async findAll(params: {
    status?: string;
    supplierId?: string;
    storeId?: string;
    requestedBy?: string;
  }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (params.storeId) { conditions.push(`pr.store_id = $${i++}`); values.push(params.storeId); }
    if (params.status) { conditions.push(`pr.status = $${i++}`); values.push(params.status); }
    if (params.supplierId) { conditions.push(`pr.supplier_id = $${i++}`); values.push(params.supplierId); }
    if (params.requestedBy) { conditions.push(`pr.requested_by = $${i++}`); values.push(params.requestedBy); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await db.query(
      `SELECT pr.*,
              ing.name as ingredient_name, ing.unit as ingredient_unit, ing.unit_cost as ingredient_unit_cost,
              ing.category as ingredient_category,
              s.name as supplier_name,
              u.first_name || ' ' || u.last_name as requested_by_name,
              po.order_number as purchase_order_number
       FROM purchase_requests pr
       JOIN ingredients ing ON ing.id = pr.ingredient_id
       LEFT JOIN suppliers s ON s.id = pr.supplier_id
       LEFT JOIN users u ON u.id = pr.requested_by
       LEFT JOIN purchase_orders po ON po.id = pr.purchase_order_id
       ${where}
       ORDER BY pr.created_at DESC`,
      values
    );
    return result.rows;
  },

  /** Get grouped by supplier (only pending) */
  async findGroupedBySupplier(storeId?: string) {
    const storeFilter = storeId ? 'AND pr.store_id = $1' : '';
    const params = storeId ? [storeId] : [];
    const result = await db.query(
      `SELECT
         pr.supplier_id,
         s.name as supplier_name,
         s.phone as supplier_phone,
         s.contact_name as supplier_contact,
         COUNT(*) as request_count,
         SUM(pr.quantity * COALESCE(ing.unit_cost, 0)) as estimated_total,
         json_agg(json_build_object(
           'id', pr.id,
           'ingredient_id', pr.ingredient_id,
           'ingredient_name', ing.name,
           'ingredient_unit', ing.unit,
           'ingredient_unit_cost', ing.unit_cost,
           'ingredient_category', ing.category,
           'quantity', pr.quantity,
           'unit', pr.unit,
           'reason', pr.reason,
           'note', pr.note,
           'requested_by_name', u.first_name || ' ' || u.last_name,
           'created_at', pr.created_at
         ) ORDER BY ing.name) as requests
       FROM purchase_requests pr
       JOIN ingredients ing ON ing.id = pr.ingredient_id
       LEFT JOIN suppliers s ON s.id = pr.supplier_id
       LEFT JOIN users u ON u.id = pr.requested_by
       WHERE pr.status = 'pending' ${storeFilter}
       GROUP BY pr.supplier_id, s.name, s.phone, s.contact_name
       ORDER BY s.name NULLS LAST`,
      params
    );
    return result.rows;
  },

  /** Create a single request */
  async create(data: {
    ingredientId: string;
    supplierId?: string | null;
    quantity: number;
    unit: string;
    reason?: string;
    note?: string;
    requestedBy: string;
    storeId?: string;
  }) {
    const result = await db.query(
      `INSERT INTO purchase_requests (ingredient_id, supplier_id, quantity, unit, reason, note, requested_by, store_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        data.ingredientId,
        data.supplierId || null,
        data.quantity,
        data.unit,
        data.reason || 'manual',
        data.note || null,
        data.requestedBy,
        data.storeId || null,
      ]
    );
    return result.rows[0];
  },

  /** Update quantity of a pending request */
  async updateQuantity(id: string, quantity: number) {
    const result = await db.query(
      `UPDATE purchase_requests SET quantity = $1, updated_at = NOW() WHERE id = $2 AND status = 'pending' RETURNING *`,
      [quantity, id]
    );
    return result.rows[0] || null;
  },

  /** Cancel a pending request */
  async cancel(id: string, note?: string) {
    const updates = note
      ? `status = 'cancelled', note = COALESCE(note, '') || ' | Annule: ' || $2, updated_at = NOW()`
      : `status = 'cancelled', updated_at = NOW()`;
    const params: unknown[] = [id];
    if (note) params.push(note);
    const result = await db.query(
      `UPDATE purchase_requests SET ${updates} WHERE id = $1 AND status = 'pending' RETURNING *`,
      params
    );
    return result.rows[0] || null;
  },

  /** Generate a purchase order from pending requests for a supplier */
  async generatePurchaseOrder(data: {
    supplierId: string;
    requestIds: string[];
    expectedDeliveryDate?: string;
    notes?: string;
    createdBy: string;
    storeId?: string;
    quantityOverrides?: Record<string, number>; // requestId -> new quantity
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Get the requests
      const reqResult = await client.query(
        `SELECT pr.*, ing.unit_cost as ingredient_unit_cost
         FROM purchase_requests pr
         JOIN ingredients ing ON ing.id = pr.ingredient_id
         WHERE pr.id = ANY($1) AND pr.status = 'pending' AND pr.supplier_id = $2
         FOR UPDATE`,
        [data.requestIds, data.supplierId]
      );

      if (reqResult.rows.length === 0) {
        throw new Error('Aucune demande en attente trouvee pour ce fournisseur');
      }

      // Generate order number
      const year = getLocalYear();
      const countResult = await client.query(
        `SELECT COUNT(*) FROM purchase_orders WHERE EXTRACT(YEAR FROM order_date) = $1`,
        [year]
      );
      const seq = parseInt(countResult.rows[0].count) + 1;
      const orderNumber = `BC-${year}-${String(seq).padStart(4, '0')}`;

      // Create purchase order
      const poResult = await client.query(
        `INSERT INTO purchase_orders (order_number, supplier_id, expected_delivery_date, notes, created_by, store_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          orderNumber,
          data.supplierId,
          data.expectedDeliveryDate || null,
          data.notes || null,
          data.createdBy,
          data.storeId || null,
        ]
      );
      const poId = poResult.rows[0].id;

      // Merge requests by ingredient (sum quantities for same ingredient)
      const mergedByIngredient = new Map<string, { ingredientId: string; totalQty: number; unitPrice: number | null }>();
      for (const req of reqResult.rows) {
        const finalQty = data.quantityOverrides?.[req.id] ?? parseFloat(req.quantity);
        const unitPrice = req.ingredient_unit_cost ? parseFloat(req.ingredient_unit_cost) : null;
        const existing = mergedByIngredient.get(req.ingredient_id);
        if (existing) {
          existing.totalQty += finalQty;
          // Keep the unit price (should be the same for same ingredient)
        } else {
          mergedByIngredient.set(req.ingredient_id, { ingredientId: req.ingredient_id, totalQty: finalQty, unitPrice });
        }
      }

      // Create PO items (one per ingredient, with merged quantities)
      for (const item of mergedByIngredient.values()) {
        await client.query(
          `INSERT INTO purchase_order_items (purchase_order_id, ingredient_id, quantity_ordered, unit_price)
           VALUES ($1, $2, $3, $4)`,
          [poId, item.ingredientId, item.totalQty, item.unitPrice]
        );
      }

      // Mark requests as assigned
      await client.query(
        `UPDATE purchase_requests SET status = 'assigned', purchase_order_id = $1, updated_at = NOW()
         WHERE id = ANY($2)`,
        [poId, data.requestIds]
      );

      await client.query('COMMIT');
      return poResult.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /** Count pending requests */
  async countPending(storeId?: string) {
    const storeFilter = storeId ? ' AND store_id = $1' : '';
    const params = storeId ? [storeId] : [];
    const result = await db.query(
      `SELECT COUNT(*) FROM purchase_requests WHERE status = 'pending'${storeFilter}`,
      params
    );
    return parseInt(result.rows[0].count);
  },
};
