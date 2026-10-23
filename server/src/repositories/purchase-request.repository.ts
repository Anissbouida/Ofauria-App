import { db } from '../config/database.js';
import { applyContainerRule } from '../services/container-rule.js';
import { purchaseOrderRepository } from './purchase-order.repository.js';
import type { PoolClient } from 'pg';

type HttpError = Error & { statusCode: number; code?: string };
function httpError(statusCode: number, message: string, code?: string): HttpError {
  const e = new Error(message) as HttpError;
  e.statusCode = statusCode;
  if (code) e.code = code;
  return e;
}

/** Filtre magasin des mutations : un utilisateur rattaché à un magasin n'agit que sur ses demandes. */
function storeClause(storeId: string | undefined, paramIndex: number) {
  return storeId ? { sql: ` AND store_id = $${paramIndex}`, params: [storeId] } : { sql: '', params: [] as unknown[] };
}

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
              ing.container_size, ing.container_type_id, ct.label as container_type_label,
              s.name as supplier_name,
              u.first_name || ' ' || u.last_name as requested_by_name,
              po.order_number as purchase_order_number,
              cov.quantity_ordered, cov.quantity_received,
              cu.first_name || ' ' || cu.last_name as cancelled_by_name,
              clu.first_name || ' ' || clu.last_name as closed_by_name
       FROM purchase_requests pr
       JOIN v_purchase_request_coverage cov ON cov.purchase_request_id = pr.id
       LEFT JOIN users cu ON cu.id = pr.cancelled_by
       LEFT JOIN users clu ON clu.id = pr.closed_by
       JOIN ingredients ing ON ing.id = pr.ingredient_id
       LEFT JOIN ref_entries ct ON ct.id = ing.container_type_id
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
           'container_size', ing.container_size,
           'container_type_id', ing.container_type_id,
           'container_type_label', ct.label,
           'quantity', pr.quantity,
           'unit', pr.unit,
           'reason', pr.reason,
           'note', pr.note,
           'requested_by_name', u.first_name || ' ' || u.last_name,
           'created_at', pr.created_at
         ) ORDER BY ing.name) as requests
       FROM purchase_requests pr
       JOIN ingredients ing ON ing.id = pr.ingredient_id
       LEFT JOIN ref_entries ct ON ct.id = ing.container_type_id
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
    // Regle « contenant entier » : la demande est arrondie au contenant superieur
    // (un manquant de 1 kg en sacs de 2,5 kg = 1 sac).
    const { qty } = await applyContainerRule(db, data.ingredientId, data.quantity);
    const result = await db.query(
      `INSERT INTO purchase_requests (ingredient_id, supplier_id, quantity, unit, reason, note, requested_by, store_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        data.ingredientId,
        data.supplierId || null,
        qty,
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
  async updateQuantity(id: string, quantity: number, userId: string, storeId?: string) {
    const cur = await db.query(`SELECT ingredient_id FROM purchase_requests WHERE id = $1`, [id]);
    const qty = cur.rows[0] ? (await applyContainerRule(db, cur.rows[0].ingredient_id as string, quantity)).qty : quantity;
    const sc = storeClause(storeId, 4);
    const result = await db.query(
      `UPDATE purchase_requests SET quantity = $1, updated_by = $3, updated_at = NOW()
        WHERE id = $2 AND status = 'pending'${sc.sql} RETURNING *`,
      [qty, id, userId, ...sc.params]
    );
    return result.rows[0] || null;
  },

  /** Assign or change supplier on a pending request */
  async updateSupplier(id: string, supplierId: string | null, userId: string, storeId?: string) {
    const sc = storeClause(storeId, 4);
    const result = await db.query(
      `UPDATE purchase_requests SET supplier_id = $1, updated_by = $3, updated_at = NOW()
        WHERE id = $2 AND status = 'pending'${sc.sql} RETURNING *`,
      [supplierId, id, userId, ...sc.params]
    );
    return result.rows[0] || null;
  },

  /** Bulk assign supplier to multiple pending requests */
  async bulkUpdateSupplier(ids: string[], supplierId: string | null, userId: string, storeId?: string) {
    if (ids.length === 0) return [];
    const sc = storeClause(storeId, 4);
    const result = await db.query(
      `UPDATE purchase_requests SET supplier_id = $1, updated_by = $3, updated_at = NOW()
        WHERE id = ANY($2) AND status = 'pending'${sc.sql} RETURNING *`,
      [supplierId, ids, userId, ...sc.params]
    );
    return result.rows;
  },

  /**
   * Annule une demande non commandée. Motif et auteur obligatoires (mig 305) ;
   * l'ancienne concaténation dans `note` est remplacée par des colonnes dédiées.
   */
  async cancel(id: string, reason: string, userId: string, storeId?: string) {
    const sc = storeClause(storeId, 4);
    const result = await db.query(
      `UPDATE purchase_requests
          SET status = 'cancelled', cancel_reason = $2, cancelled_by = $3, cancelled_at = NOW(),
              updated_by = $3, updated_at = NOW()
        WHERE id = $1 AND status = 'pending'${sc.sql} RETURNING *`,
      [id, reason, userId, ...sc.params]
    );
    return result.rows[0] || null;
  },

  /**
   * Clôture le reliquat d'une demande partiellement couverte : on renonce au
   * manquant (ex. livraison incomplète acceptée). Action motivée et définitive.
   */
  async close(id: string, reason: string, userId: string, storeId?: string) {
    const sc = storeClause(storeId, 4);
    const result = await db.query(
      `UPDATE purchase_requests
          SET status = 'closed', close_reason = $2, closed_by = $3, closed_at = NOW(),
              updated_by = $3, updated_at = NOW()
        WHERE id = $1 AND status IN ('assigned', 'ordered')${sc.sql} RETURNING *`,
      [id, reason, userId, ...sc.params]
    );
    return result.rows[0] || null;
  },

  /** Historique d'une demande et de ses couvertures (journal SGBD, mig 305). */
  async history(id: string) {
    const r = await db.query(
      `SELECT a.id, a.table_name, a.operation, a.changed_at, a.diff, a.new_row, a.old_row,
              COALESCE(u.first_name || ' ' || u.last_name, u.email) AS changed_by_name
         FROM purchasing_document_audit a
         LEFT JOIN users u ON u.id = a.changed_by
        WHERE a.record_id = $1
        ORDER BY a.changed_at, a.id`,
      [id]
    );
    return r.rows;
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
      const po = await this._generatePurchaseOrderTx(client, data);
      await client.query('COMMIT');
      return po;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /** Cœur de la génération d'un BC depuis des demandes, dans la transaction de l'appelant. */
  async _generatePurchaseOrderTx(client: PoolClient, data: {
    supplierId: string;
    requestIds: string[];
    expectedDeliveryDate?: string;
    notes?: string;
    createdBy: string;
    storeId?: string;
    quantityOverrides?: Record<string, number>;
  }) {
    {
      // Get the requests
      const reqResult = await client.query(
        `SELECT pr.*, ing.unit_cost as ingredient_unit_cost
         FROM purchase_requests pr
         JOIN ingredients ing ON ing.id = pr.ingredient_id
         WHERE pr.id = ANY($1) AND pr.status = 'pending' AND pr.supplier_id = $2
           AND ($3::uuid IS NULL OR pr.store_id = $3)
         FOR UPDATE OF pr`,
        [data.requestIds, data.supplierId, data.storeId ?? null]
      );

      // On ne commande que ce qui a réellement été verrouillé. Si une demande a été
      // annulée, réaffectée ou commandée par quelqu'un d'autre entre l'affichage et
      // le clic, on refuse plutôt que de rattacher une demande que le BC ne contient pas.
      if (reqResult.rows.length === 0) {
        throw httpError(409, 'Aucune demande en attente trouvée pour ce fournisseur', 'PR_NONE_PENDING');
      }
      const uniqueRequested = new Set(data.requestIds);
      if (reqResult.rows.length !== uniqueRequested.size) {
        throw httpError(409, `${uniqueRequested.size - reqResult.rows.length} demande(s) ne sont plus en attente pour ce fournisseur : rechargez la liste`, 'PR_STALE_SELECTION');
      }

      // Numero de BC : on reutilise le generateur unique du module Achats
      // (MAX(suffixe)+1 sous advisory lock). L'ancienne version locale faisait
      // COUNT(*)+1, qui retombait sur un numero deja attribue des qu'un BC
      // etait supprime au milieu de la sequence -> duplicate key sur
      // order_number, transaction en erreur, generation impossible.
      const orderNumber = await purchaseOrderRepository.generateOrderNumber(client);

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
      const mergedByIngredient = new Map<string, {
        ingredientId: string; totalQty: number; unitPrice: number | null;
        requests: Array<{ id: string; qty: number }>;
      }>();
      for (const req of reqResult.rows) {
        const finalQty = data.quantityOverrides?.[req.id] ?? parseFloat(req.quantity);
        const unitPrice = req.ingredient_unit_cost ? parseFloat(req.ingredient_unit_cost) : null;
        const existing = mergedByIngredient.get(req.ingredient_id);
        if (existing) {
          existing.totalQty += finalQty;
          existing.requests.push({ id: req.id, qty: finalQty });
        } else {
          mergedByIngredient.set(req.ingredient_id, { ingredientId: req.ingredient_id, totalQty: finalQty, unitPrice, requests: [{ id: req.id, qty: finalQty }] });
        }
      }

      // Create PO items (one per ingredient, with merged quantities), par contenant
      // entier pour les ingredients qui en ont un (regle d'affaires).
      for (const item of mergedByIngredient.values()) {
        const { qty } = await applyContainerRule(client, item.ingredientId, item.totalQty);
        const line = await client.query(
          `INSERT INTO purchase_order_items (purchase_order_id, ingredient_id, quantity_ordered, unit_price)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [poId, item.ingredientId, qty, item.unitPrice]
        );
        // Couverture : chaque demande pointe la ligne de BC qui la porte réellement.
        // Le statut de la demande est recalculé par la base (trigger, mig 305).
        for (const r of item.requests) {
          await client.query(
            `INSERT INTO request_po_lines (purchase_request_id, po_item_id, quantity, created_by)
             VALUES ($1, $2, $3, $4)`,
            [r.id, line.rows[0].id, r.qty, data.createdBy]
          );
        }
      }

      return poResult.rows[0];
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
