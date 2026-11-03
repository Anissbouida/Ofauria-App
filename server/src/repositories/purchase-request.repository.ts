import { db } from '../config/database.js';
import { applyContainerRule } from '../services/container-rule.js';

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
           'approval_status', pr.approval_status,
           'requested_by_name', u.first_name || ' ' || u.last_name,
           'created_at', pr.created_at
         ) ORDER BY ing.name) as requests
       FROM purchase_requests pr
       JOIN ingredients ing ON ing.id = pr.ingredient_id
       LEFT JOIN ref_entries ct ON ct.id = ing.container_type_id
       LEFT JOIN suppliers s ON s.id = pr.supplier_id
       LEFT JOIN users u ON u.id = pr.requested_by
       WHERE pr.status = 'pending' ${storeFilter}
         -- DA déjà en sourcing (AO vivant) : retirée de la liste pour ne pas être sourcée deux fois (mig 457).
         AND NOT EXISTS (SELECT 1 FROM rfq_requests rr JOIN rfqs r ON r.id = rr.rfq_id
                          WHERE rr.purchase_request_id = pr.id AND r.status IN ('draft', 'sent', 'quoted'))
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
    // Auto-sourcing (mig 404) : à défaut de fournisseur précisé, on prend le
    // fournisseur PRÉFÉRÉ de l'article (fiche article × fournisseur). Profite aussi
    // aux demandes générées par le MRP (lot 8), qui n'en précisent pas.
    let supplierId = data.supplierId || null;
    if (!supplierId) {
      const pref = await db.query(
        `SELECT supplier_id FROM supplier_items
         WHERE purchasable_kind = 'ingredient' AND purchasable_id = $1
           AND is_preferred AND NOT is_blocked AND archived_at IS NULL
         LIMIT 1`, [data.ingredientId]);
      supplierId = pref.rows[0]?.supplier_id ?? null;
    }
    const result = await db.query(
      `INSERT INTO purchase_requests (ingredient_id, supplier_id, quantity, unit, reason, note, requested_by, store_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        data.ingredientId,
        supplierId,
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

  // Flux procure-to-pay (mig 457) : le BC ne naît plus directement d'une DA. Une DA
  // approuvée passe OBLIGATOIREMENT par un appel d'offres (sourcing) ; le BC est créé
  // à l'attribution de l'AO, qui couvre les DA (rfq.repository.award → request_po_lines).
  // L'ancien chemin « Générer le BC depuis la DA » (generatePurchaseOrder /
  // _generatePurchaseOrderTx) est donc supprimé.

  /**
   * État du circuit d'approbation de la DA (mig 456), dimension SÉPARÉE du statut
   * de couverture. Posé à la création (pending si une règle a matché, approved
   * sinon) et par le moteur d'approbation (approved / rejected à la décision).
   */
  async setApprovalStatus(id: string, approvalStatus: 'draft' | 'pending' | 'approved' | 'rejected') {
    const result = await db.query(
      `UPDATE purchase_requests SET approval_status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, approvalStatus]
    );
    return result.rows[0] || null;
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
