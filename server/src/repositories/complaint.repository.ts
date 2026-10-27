import { db } from '../config/database.js';
import { nextDocumentNumber } from '../utils/document-number.js';
import { getParameter } from '../services/module-parameters.service.js';

/**
 * SAV : réclamations clients (mig 357). Module générique : le client peut être une
 * fiche ou un nom libre, et les liens vers l'article, le lot, la vente, la commande
 * ou la facture sont tous optionnels. Chaque changement d'état est journalisé dans
 * complaint_events ; la priorité fixe un délai (sav.sla_hours) figé dans due_at.
 */

export type ComplaintStatus = 'open' | 'in_progress' | 'resolved' | 'closed' | 'rejected';
export type ComplaintPriority = 'low' | 'normal' | 'high' | 'critical';
export type ComplaintChannel = 'counter' | 'phone' | 'email' | 'social' | 'other';
export type ResolutionCode = 'refund' | 'replacement' | 'voucher' | 'discount' | 'apology' | 'none' | 'not_founded';

type SlaHours = Record<ComplaintPriority, number>;
const SLA_DEFAULT: SlaHours = { critical: 4, high: 24, normal: 72, low: 168 };

/** Transitions permises : d'où → vers où. Rouvrir = retour à « ouverte ». */
const TRANSITIONS: Record<ComplaintStatus, ComplaintStatus[]> = {
  open: ['in_progress', 'resolved', 'rejected'],
  in_progress: ['resolved', 'rejected', 'open'],
  resolved: ['closed', 'open'],
  closed: ['open'],
  rejected: ['open'],
};

const NAME = (alias: string) => `${alias}.first_name || ' ' || ${alias}.last_name`;

/** Colonnes de la fiche, avec les libellés joints (client, article, lot, pièces, personnes). */
const SELECT = `
  SELECT c.*,
         COALESCE(c.customer_name, NULLIF(btrim(COALESCE(cu.company_name, '')), ''),
                  NULLIF(btrim(COALESCE(cu.first_name, '') || ' ' || COALESCE(cu.last_name, '')), '')) AS customer_label,
         cu.customer_type,
         p.name AS product_name,
         pl.lot_number,
         s.sale_number,
         o.order_number,
         i.invoice_number,
         ${NAME('ca')} AS assigned_name,
         ${NAME('cb')} AS created_by_name,
         ${NAME('cr')} AS resolved_by_name,
         re.label AS category_label, re.color AS category_color,
         (c.status IN ('open', 'in_progress') AND c.due_at IS NOT NULL AND c.due_at < now()) AS is_overdue
    FROM complaints c
    LEFT JOIN customers cu ON cu.id = c.customer_id
    LEFT JOIN products p ON p.id = c.product_id
    LEFT JOIN product_lots pl ON pl.id = c.product_lot_id
    LEFT JOIN sales s ON s.id = c.sale_id
    LEFT JOIN orders o ON o.id = c.order_id
    LEFT JOIN invoices i ON i.id = c.invoice_id
    LEFT JOIN users ca ON ca.id = c.assigned_to
    LEFT JOIN users cb ON cb.id = c.created_by
    LEFT JOIN users cr ON cr.id = c.resolved_by
    LEFT JOIN ref_entries re ON re.table_id = 'complaint_categories' AND re.code = c.category_code`;

async function slaHours(): Promise<SlaHours> {
  const v = await getParameter<Partial<SlaHours> | null>('sav.sla_hours');
  return { ...SLA_DEFAULT, ...(v ?? {}) };
}

function dueAt(from: Date, priority: ComplaintPriority, sla: SlaHours): Date {
  return new Date(from.getTime() + (sla[priority] ?? SLA_DEFAULT[priority]) * 3600 * 1000);
}

async function addEvent(runner: { query: typeof db.query }, complaintId: string, p: {
  type: 'created' | 'comment' | 'status' | 'assigned' | 'priority' | 'edited';
  from?: string | null; to?: string | null; note?: string | null; userId: string;
}) {
  await runner.query(
    `INSERT INTO complaint_events (complaint_id, event_type, from_value, to_value, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [complaintId, p.type, p.from ?? null, p.to ?? null, p.note ?? null, p.userId],
  );
}

async function notify(p: { role: string; storeId: string | null; type: string; title: string; message: string; complaintId: string; userId: string }) {
  await db.query(
    `INSERT INTO notifications (target_role, store_id, type, title, message, reference_type, reference_id, created_by)
     VALUES ($1, $2, $3, $4, $5, 'complaint', $6, $7)`,
    [p.role, p.storeId, p.type, p.title, p.message, p.complaintId, p.userId],
  );
}

export type ComplaintInput = {
  customerId?: string | null; customerName?: string | null; customerPhone?: string | null;
  channel?: ComplaintChannel; categoryCode: string; priority?: ComplaintPriority;
  subject: string; description?: string | null;
  productId?: string | null; productLotId?: string | null; saleId?: string | null;
  orderId?: string | null; invoiceId?: string | null; quantity?: number | null; photoUrl?: string | null;
  assignedTo?: string | null;
};

export const complaintRepository = {
  async create(input: ComplaintInput, ctx: { userId: string; storeId: string | null }) {
    const sla = await slaHours();
    const safetyCritical = await getParameter<boolean>('sav.safety_is_critical');
    const priority: ComplaintPriority = input.categoryCode === 'safety' && safetyCritical !== false ? 'critical' : (input.priority ?? 'normal');
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const number = await nextDocumentNumber(client, 'complaint');
      const now = new Date();
      const r = await client.query(
        `INSERT INTO complaints (number, store_id, customer_id, customer_name, customer_phone, channel, category_code, priority,
                                 subject, description, product_id, product_lot_id, sale_id, order_id, invoice_id, quantity,
                                 photo_url, due_at, assigned_to, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
         RETURNING id`,
        [number, ctx.storeId, input.customerId ?? null, input.customerName?.trim() || null, input.customerPhone?.trim() || null,
         input.channel ?? 'counter', input.categoryCode, priority, input.subject.trim(), input.description?.trim() || null,
         input.productId ?? null, input.productLotId ?? null, input.saleId ?? null, input.orderId ?? null, input.invoiceId ?? null,
         input.quantity ?? null, input.photoUrl ?? null, dueAt(now, priority, sla), input.assignedTo ?? null, ctx.userId],
      );
      const id = r.rows[0].id as string;
      await addEvent(client, id, { type: 'created', to: priority, userId: ctx.userId });
      await client.query('COMMIT');
      // Le gérant est prévenu de chaque réclamation ; l'admin en plus si elle est critique.
      const title = priority === 'critical' ? `Réclamation critique ${number}` : `Nouvelle réclamation ${number}`;
      await notify({ role: 'manager', storeId: ctx.storeId, type: priority === 'critical' ? 'complaint_critical' : 'complaint_created',
        title, message: input.subject.trim(), complaintId: id, userId: ctx.userId });
      if (priority === 'critical') {
        await notify({ role: 'admin', storeId: ctx.storeId, type: 'complaint_critical', title, message: input.subject.trim(), complaintId: id, userId: ctx.userId });
      }
      return this.findById(id);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async findById(id: string) {
    const r = await db.query(`${SELECT} WHERE c.id = $1`, [id]);
    const row = r.rows[0];
    if (!row) return null;
    const ev = await db.query(
      `SELECT e.*, ${NAME('u')} AS by_name FROM complaint_events e LEFT JOIN users u ON u.id = e.created_by
        WHERE e.complaint_id = $1 ORDER BY e.created_at`,
      [id],
    );
    return { ...row, events: ev.rows };
  },

  /** Liste paginée + compteurs par statut (sur le même filtre, hors statut) et retards. */
  async list(p: {
    status?: ComplaintStatus; priority?: ComplaintPriority; categoryCode?: string; assignedTo?: string;
    overdueOnly?: boolean; search?: string; dateFrom?: string; dateTo?: string; storeId?: string;
    limit: number; offset: number;
  }) {
    const values: unknown[] = [];
    const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
    const base: string[] = ['true'];
    if (p.storeId) base.push(`(c.store_id IS NULL OR c.store_id = ${add(p.storeId)}::uuid)`);
    if (p.dateFrom) base.push(`c.created_at::date >= ${add(p.dateFrom)}::date`);
    if (p.dateTo) base.push(`c.created_at::date <= ${add(p.dateTo)}::date`);
    if (p.priority) base.push(`c.priority = ${add(p.priority)}`);
    if (p.categoryCode) base.push(`c.category_code = ${add(p.categoryCode)}`);
    if (p.assignedTo) base.push(`c.assigned_to = ${add(p.assignedTo)}::uuid`);
    if (p.search) {
      const s = add(`%${p.search}%`);
      base.push(`(c.number ILIKE ${s} OR c.subject ILIKE ${s} OR COALESCE(c.customer_name, '') ILIKE ${s}
                  OR EXISTS (SELECT 1 FROM customers cu2 WHERE cu2.id = c.customer_id
                              AND (cu2.company_name ILIKE ${s} OR (COALESCE(cu2.first_name, '') || ' ' || COALESCE(cu2.last_name, '')) ILIKE ${s}))
                  OR EXISTS (SELECT 1 FROM products p2 WHERE p2.id = c.product_id AND p2.name ILIKE ${s}))`);
    }
    const baseWhere = base.join(' AND ');
    const cond = [...base];
    if (p.status) cond.push(`c.status = ${add(p.status)}`);
    if (p.overdueOnly) cond.push(`c.status IN ('open', 'in_progress') AND c.due_at < now()`);
    const lim = add(p.limit);
    const off = add(p.offset);
    const [rows, counts] = await Promise.all([
      db.query(`${SELECT} WHERE ${cond.join(' AND ')}
                ORDER BY (c.status IN ('open', 'in_progress')) DESC,
                         CASE c.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                         c.due_at NULLS LAST, c.created_at DESC
                LIMIT ${lim} OFFSET ${off}`, values),
      db.query(`SELECT c.status, COUNT(*)::int AS count,
                       COUNT(*) FILTER (WHERE c.status IN ('open', 'in_progress') AND c.due_at < now())::int AS overdue
                  FROM complaints c WHERE ${baseWhere} GROUP BY c.status`, values.slice(0, values.length - 2 - (p.status ? 1 : 0))),
    ]);
    const total = (await db.query(`SELECT COUNT(*)::int AS n FROM complaints c WHERE ${cond.join(' AND ')}`, values.slice(0, values.length - 2))).rows[0].n as number;
    const byStatus: Record<string, { count: number; overdue: number }> = {};
    for (const r of counts.rows) byStatus[r.status] = { count: r.count, overdue: r.overdue };
    return { rows: rows.rows, total, byStatus };
  },

  /** Indicateurs pour Contrôle & Qualité : ouvertes, en retard, critiques ouvertes, résolues sur la période. */
  async indicators(p: { storeId?: string; dateFrom?: string; dateTo?: string }) {
    const values: unknown[] = [];
    const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
    const store = p.storeId ? `(c.store_id IS NULL OR c.store_id = ${add(p.storeId)}::uuid)` : 'true';
    const period = [
      p.dateFrom ? `c.created_at::date >= ${add(p.dateFrom)}::date` : 'true',
      p.dateTo ? `c.created_at::date <= ${add(p.dateTo)}::date` : 'true',
    ].join(' AND ');
    const r = await db.query(
      `SELECT COUNT(*) FILTER (WHERE c.status IN ('open', 'in_progress'))::int AS open,
              COUNT(*) FILTER (WHERE c.status IN ('open', 'in_progress') AND c.due_at < now())::int AS overdue,
              COUNT(*) FILTER (WHERE c.status IN ('open', 'in_progress') AND c.priority = 'critical')::int AS critical,
              COUNT(*) FILTER (WHERE ${period})::int AS created,
              COALESCE(SUM(c.resolution_amount) FILTER (WHERE ${period} AND c.resolution_amount IS NOT NULL), 0) AS amount
         FROM complaints c WHERE ${store}`,
      values,
    );
    return r.rows[0];
  },

  async update(id: string, patch: Partial<ComplaintInput>, userId: string) {
    const cols: Record<string, unknown> = {
      customer_id: patch.customerId, customer_name: patch.customerName?.trim() || null, customer_phone: patch.customerPhone?.trim() || null,
      channel: patch.channel, category_code: patch.categoryCode, subject: patch.subject?.trim(), description: patch.description?.trim() ?? null,
      product_id: patch.productId, product_lot_id: patch.productLotId, sale_id: patch.saleId, order_id: patch.orderId,
      invoice_id: patch.invoiceId, quantity: patch.quantity, photo_url: patch.photoUrl,
    };
    const sets: string[] = []; const values: unknown[] = [];
    for (const [k, v] of Object.entries(cols)) {
      if (v === undefined) continue;
      values.push(v); sets.push(`${k} = $${values.length}`);
    }
    if (!sets.length) return this.findById(id);
    values.push(id);
    const r = await db.query(`UPDATE complaints SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING id`, values);
    if (!r.rows[0]) return null;
    await addEvent(db, id, { type: 'edited', userId });
    return this.findById(id);
  },

  async setStatus(id: string, to: ComplaintStatus, p: {
    note?: string | null; resolutionCode?: ResolutionCode | null; resolution?: string | null; resolutionAmount?: number | null; userId: string;
  }) {
    const cur = await db.query(`SELECT status, resolution_code FROM complaints WHERE id = $1`, [id]);
    const from = cur.rows[0]?.status as ComplaintStatus | undefined;
    if (!from) return { error: 'not_found' as const };
    if (!TRANSITIONS[from].includes(to)) return { error: 'transition' as const, from };
    if (to === 'resolved' && !p.resolutionCode) return { error: 'resolution_required' as const };
    const sets: string[] = ['status = $2']; const values: unknown[] = [id, to];
    const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
    if (to === 'resolved' || to === 'rejected') {
      sets.push(`resolution_code = ${add(to === 'rejected' ? 'not_founded' : p.resolutionCode)}`);
      sets.push(`resolution = ${add(p.resolution?.trim() || p.note?.trim() || null)}`);
      sets.push(`resolution_amount = ${add(p.resolutionAmount ?? null)}`);
      sets.push(`resolved_by = ${add(p.userId)}`, 'resolved_at = now()');
    } else if (to === 'closed') {
      sets.push('closed_at = now()');
    } else {
      // open / in_progress : on repart, la résolution précédente est effacée.
      sets.push('resolution_code = NULL', 'resolution = NULL', 'resolution_amount = NULL', 'resolved_by = NULL', 'resolved_at = NULL', 'closed_at = NULL');
    }
    await db.query(`UPDATE complaints SET ${sets.join(', ')} WHERE id = $1`, values);
    await addEvent(db, id, { type: 'status', from, to, note: p.note ?? null, userId: p.userId });
    return { data: await this.findById(id) };
  },

  async assign(id: string, assignedTo: string | null, userId: string) {
    const cur = await db.query(`SELECT assigned_to FROM complaints WHERE id = $1`, [id]);
    if (!cur.rows[0]) return null;
    await db.query(`UPDATE complaints SET assigned_to = $2 WHERE id = $1`, [id, assignedTo]);
    await addEvent(db, id, { type: 'assigned', from: cur.rows[0].assigned_to, to: assignedTo, userId });
    return this.findById(id);
  },

  async setPriority(id: string, priority: ComplaintPriority, userId: string) {
    const cur = await db.query(`SELECT priority, created_at FROM complaints WHERE id = $1`, [id]);
    if (!cur.rows[0]) return null;
    const sla = await slaHours();
    await db.query(`UPDATE complaints SET priority = $2, due_at = $3 WHERE id = $1`,
      [id, priority, dueAt(new Date(cur.rows[0].created_at), priority, sla)]);
    await addEvent(db, id, { type: 'priority', from: cur.rows[0].priority, to: priority, userId });
    return this.findById(id);
  },

  async comment(id: string, note: string, userId: string) {
    const cur = await db.query(`SELECT 1 FROM complaints WHERE id = $1`, [id]);
    if (!cur.rows[0]) return null;
    await addEvent(db, id, { type: 'comment', note, userId });
    return this.findById(id);
  },

  /** Lots d'un article pour rattacher la réclamation : ceux de la vente d'abord, sinon les derniers produits. */
  async lotsForProduct(productId: string, saleId?: string | null) {
    if (saleId) {
      const r = await db.query(
        `SELECT DISTINCT pl.id, pl.lot_number, pl.produced_at, pl.expires_at
           FROM sale_items si JOIN sale_item_lots sil ON sil.sale_item_id = si.id JOIN product_lots pl ON pl.id = sil.product_lot_id
          WHERE si.sale_id = $1 AND si.product_id = $2 ORDER BY pl.produced_at DESC`,
        [saleId, productId],
      );
      if (r.rows.length) return r.rows;
    }
    const r = await db.query(
      `SELECT id, lot_number, produced_at, expires_at FROM product_lots WHERE product_id = $1 ORDER BY produced_at DESC LIMIT 20`,
      [productId],
    );
    return r.rows;
  },
};
