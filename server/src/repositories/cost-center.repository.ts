import { db } from '../config/database.js';

/**
 * Centres de coûts (mig 386) = sections des axes analytiques (mig 428).
 * Affecter un centre à une facture ventile ses écritures (trigger de la mig
 * 428) ; le résultat par section se lit dans la balance analytique
 * (analytic.repository).
 */
export const costCenterRepository = {
  async list(storeId?: string | null) {
    const params: unknown[] = [];
    let where = '';
    if (storeId) { params.push(storeId); where = `WHERE (c.store_id IS NULL OR c.store_id = $1)`; }
    const r = await db.query(
      `SELECT c.*, x.code AS axis_code, x.name AS axis_name,
              (SELECT COUNT(*) FROM invoices i WHERE i.cost_center_id = c.id)::int AS invoices_count
         FROM cost_centers c JOIN analytic_axes x ON x.id = c.axis_id ${where} ORDER BY x.code, c.is_active DESC, c.code`, params);
    return r.rows;
  },

  async create(input: { code: string; name: string; axisId?: string | null; storeId?: string | null; userId: string | null }) {
    const code = input.code.trim().toUpperCase().slice(0, 20);
    if (!code) return { error: 'Code requis' };
    const dup = await db.query(`SELECT 1 FROM cost_centers WHERE code = $1`, [code]);
    if (dup.rows.length) return { error: 'Ce code existe déjà' };
    const r = await db.query(
      `INSERT INTO cost_centers (code, name, store_id, created_by, axis_id)
       VALUES ($1, $2, $3, $4, COALESCE($5::uuid, (SELECT id FROM analytic_axes WHERE code = 'ACT'))) RETURNING *`,
      [code, input.name.trim().slice(0, 120), input.storeId ?? null, input.userId, input.axisId ?? null]);
    return { data: { ...r.rows[0], invoices_count: 0 } };
  },

  async setActive(id: string, active: boolean) {
    const r = await db.query(`UPDATE cost_centers SET is_active = $2 WHERE id = $1 RETURNING *`, [id, active]);
    return r.rows[0] || null;
  },

  /** Affecte (ou retire, costCenterId null) un centre de coût à une facture. */
  async assignInvoice(invoiceId: string, costCenterId: string | null) {
    const r = await db.query(`UPDATE invoices SET cost_center_id = $2 WHERE id = $1 RETURNING id`, [invoiceId, costCenterId]);
    return r.rows[0] ? { ok: true } : { error: 'Facture introuvable' };
  },

  /** Factures à ventiler (received/emitted, hors annulées) avec leur centre actuel. */
  async invoicesForAssignment(p: { storeId?: string | null; kind?: 'received' | 'emitted'; onlyUnassigned?: boolean; from?: string; to?: string; limit: number }) {
    const params: unknown[] = [];
    const cond = [`i.status <> 'cancelled'`];
    if (p.kind) { params.push(p.kind); cond.push(`i.invoice_type = $${params.length}`); }
    else cond.push(`i.invoice_type IN ('received','emitted')`);
    if (p.onlyUnassigned) cond.push(`i.cost_center_id IS NULL`);
    if (p.storeId) { params.push(p.storeId); cond.push(`(i.store_id IS NULL OR i.store_id = $${params.length})`); }
    if (p.from) { params.push(p.from); cond.push(`i.invoice_date >= $${params.length}`); }
    if (p.to) { params.push(p.to); cond.push(`i.invoice_date <= $${params.length}`); }
    params.push(p.limit);
    const r = await db.query(
      `SELECT i.id, i.invoice_number, i.invoice_type, i.invoice_date, i.amount::float8 AS amount, i.cost_center_id,
              COALESCE(s.name, cu.company_name, NULLIF(TRIM(COALESCE(cu.first_name,'')||' '||COALESCE(cu.last_name,'')), '')) AS party
         FROM invoices i
         LEFT JOIN suppliers s ON s.id = i.supplier_id
         LEFT JOIN customers cu ON cu.id = i.customer_id
        WHERE ${cond.join(' AND ')}
        ORDER BY i.invoice_date DESC, i.invoice_number DESC
        LIMIT $${params.length}`, params);
    return r.rows;
  },
};
