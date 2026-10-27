import { db } from '../config/database.js';
import { nextDocumentNumber } from '../utils/document-number.js';
import { purchaseOrderRepository } from './purchase-order.repository.js';

/**
 * Appels d'offres fournisseurs (mig 360) : articles demandés, fournisseurs
 * consultés, devis reçus, tableau comparatif, puis BC créé depuis le devis retenu.
 */

export type RfqStatus = 'draft' | 'sent' | 'quoted' | 'awarded' | 'cancelled' | 'closed';
export type LineType = 'ingredient' | 'consumable' | 'service' | 'asset';

export type RfqItemInput = {
  lineType?: LineType; ingredientId?: string | null; packagingId?: string | null; description?: string | null;
  categoryId?: string | null; unit?: string | null; quantity: number;
};
export type RfqInput = {
  title: string; neededBy?: string | null; responseDeadline?: string | null; notes?: string | null;
  items: RfqItemInput[]; supplierIds: string[];
};
export type QuotationInput = {
  supplierId: string; quotationRef?: string | null; receivedAt?: string; validUntil?: string | null; deliveryDays?: number | null;
  paymentTerms?: string | null; shippingCost?: number; discountPct?: number; notes?: string | null;
  /** Devise du devis et taux (mig 363) : prix et port saisis en devise. */
  currencyCode?: string; exchangeRate?: number;
  items: { rfqItemId: string; available?: boolean; unitPrice?: number | null; quantity?: number | null; note?: string | null }[];
};

const NAME = (a: string) => `${a}.first_name || ' ' || ${a}.last_name`;

const SELECT = `
  SELECT r.*, ${NAME('cb')} AS created_by_name, po.order_number AS purchase_order_number,
         (SELECT COUNT(*)::int FROM rfq_items i WHERE i.rfq_id = r.id) AS item_count,
         (SELECT COUNT(*)::int FROM rfq_suppliers s WHERE s.rfq_id = r.id) AS supplier_count,
         (SELECT COUNT(*)::int FROM supplier_quotations q WHERE q.rfq_id = r.id) AS quotation_count,
         (r.status IN ('sent', 'quoted') AND r.response_deadline IS NOT NULL AND r.response_deadline < CURRENT_DATE) AS is_overdue,
         aw.supplier_id AS awarded_supplier_id, aws.name AS awarded_supplier_name
    FROM rfqs r
    LEFT JOIN users cb ON cb.id = r.created_by
    LEFT JOIN purchase_orders po ON po.id = r.purchase_order_id
    LEFT JOIN supplier_quotations aw ON aw.id = r.awarded_quotation_id
    LEFT JOIN suppliers aws ON aws.id = aw.supplier_id`;

/** Lignes d'un AO avec le libellé de l'article et son dernier prix d'achat (référence). */
const ITEMS = `
  SELECT i.*, COALESCE(ing.name, pk.name, i.description) AS label, COALESCE(i.unit, ing.unit, pk.unit) AS unit_label,
         ec.name AS category_name,
         (SELECT poi.unit_price FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.purchase_order_id
           WHERE po.status NOT IN ('cancelled') AND poi.unit_price IS NOT NULL
             AND ((i.ingredient_id IS NOT NULL AND poi.ingredient_id = i.ingredient_id) OR (i.packaging_id IS NOT NULL AND poi.packaging_id = i.packaging_id))
           ORDER BY po.order_date DESC NULLS LAST, po.created_at DESC LIMIT 1) AS last_price
    FROM rfq_items i
    LEFT JOIN ingredients ing ON ing.id = i.ingredient_id
    LEFT JOIN packaging_items pk ON pk.id = i.packaging_id
    LEFT JOIN expense_categories ec ON ec.id = i.category_id`;

async function syncStatus(client: { query: typeof db.query }, rfqId: string) {
  // sent → quoted dès le premier devis ; on ne touche pas aux statuts finaux.
  await client.query(
    `UPDATE rfqs SET status = CASE
        WHEN status IN ('sent', 'quoted') THEN (CASE WHEN EXISTS (SELECT 1 FROM supplier_quotations q WHERE q.rfq_id = rfqs.id) THEN 'quoted' ELSE 'sent' END)
        ELSE status END
      WHERE id = $1`, [rfqId]);
}

export const rfqRepository = {
  async create(input: RfqInput, ctx: { userId: string; storeId: string | null }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const number = await nextDocumentNumber(client, 'rfq');
      const r = await client.query(
        `INSERT INTO rfqs (number, store_id, title, needed_by, response_deadline, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [number, ctx.storeId, input.title.trim(), input.neededBy ?? null, input.responseDeadline ?? null, input.notes?.trim() || null, ctx.userId],
      );
      const id = r.rows[0].id as string;
      await this.replaceItems(client, id, input.items);
      for (const sid of input.supplierIds) {
        await client.query(`INSERT INTO rfq_suppliers (rfq_id, supplier_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, sid]);
      }
      await client.query('COMMIT');
      return this.findById(id);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async replaceItems(client: { query: typeof db.query }, rfqId: string, items: RfqItemInput[]) {
    await client.query(`DELETE FROM rfq_items WHERE rfq_id = $1`, [rfqId]);
    let order = 0;
    for (const it of items) {
      const lineType: LineType = it.lineType ?? (it.packagingId ? 'consumable' : it.ingredientId ? 'ingredient' : 'service');
      await client.query(
        `INSERT INTO rfq_items (rfq_id, line_type, ingredient_id, packaging_id, description, category_id, unit, quantity, display_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [rfqId, lineType, it.ingredientId ?? null, it.packagingId ?? null, it.description?.trim() || null, it.categoryId ?? null,
         it.unit?.trim() || null, it.quantity, (order += 10)],
      );
    }
  },

  async update(id: string, patch: Partial<RfqInput>, _userId: string) {
    const cur = await db.query(`SELECT status FROM rfqs WHERE id = $1`, [id]);
    if (!cur.rows[0]) return null;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const cols: Record<string, unknown> = { title: patch.title?.trim(), needed_by: patch.neededBy, response_deadline: patch.responseDeadline, notes: patch.notes?.trim() ?? patch.notes };
      const sets: string[] = []; const values: unknown[] = [];
      for (const [k, v] of Object.entries(cols)) { if (v === undefined) continue; values.push(v); sets.push(`${k} = $${values.length}`); }
      if (sets.length) { values.push(id); await client.query(`UPDATE rfqs SET ${sets.join(', ')} WHERE id = $${values.length}`, values); }
      // Les lignes ne se modifient qu'avant l'envoi : des devis y font référence ensuite.
      if (patch.items && cur.rows[0].status === 'draft') await this.replaceItems(client, id, patch.items);
      if (patch.supplierIds) {
        await client.query(`DELETE FROM rfq_suppliers WHERE rfq_id = $1 AND supplier_id <> ALL($2::uuid[])
                              AND NOT EXISTS (SELECT 1 FROM supplier_quotations q WHERE q.rfq_id = $1 AND q.supplier_id = rfq_suppliers.supplier_id)`, [id, patch.supplierIds]);
        for (const sid of patch.supplierIds) await client.query(`INSERT INTO rfq_suppliers (rfq_id, supplier_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, sid]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return this.findById(id);
  },

  async findById(id: string) {
    const r = await db.query(`${SELECT} WHERE r.id = $1`, [id]);
    const rfq = r.rows[0];
    if (!rfq) return null;
    const [items, suppliers, quotations, qItems] = await Promise.all([
      db.query(`${ITEMS} WHERE i.rfq_id = $1 ORDER BY i.display_order`, [id]),
      db.query(`SELECT rs.*, s.name AS supplier_name, s.email, s.phone, s.contact_name, s.currency_code AS supplier_currency,
                       q.id AS quotation_id
                  FROM rfq_suppliers rs JOIN suppliers s ON s.id = rs.supplier_id
                  LEFT JOIN supplier_quotations q ON q.rfq_id = rs.rfq_id AND q.supplier_id = rs.supplier_id
                 WHERE rs.rfq_id = $1 ORDER BY s.name`, [id]),
      db.query(`SELECT q.*, s.name AS supplier_name, ${NAME('u')} AS created_by_name
                  FROM supplier_quotations q JOIN suppliers s ON s.id = q.supplier_id LEFT JOIN users u ON u.id = q.created_by
                 WHERE q.rfq_id = $1 ORDER BY q.received_at, s.name`, [id]),
      db.query(`SELECT qi.* FROM supplier_quotation_items qi JOIN supplier_quotations q ON q.id = qi.quotation_id WHERE q.rfq_id = $1`, [id]),
    ]);
    // Tableau comparatif : pour chaque devis, le total HT (lignes × quantité demandée,
    // remise, port) et la couverture ; pour chaque ligne, le meilleur prix.
    const byQuot = new Map<string, Record<string, unknown>[]>();
    for (const qi of qItems.rows) { const arr = byQuot.get(qi.quotation_id) ?? []; arr.push(qi); byQuot.set(qi.quotation_id, arr); }
    const quotes = quotations.rows.map(q => {
      // Lignes ramenées en DH au taux du devis (mig 363) ; le prix d'origine reste dans foreign_unit_price.
      const rate = Number(q.exchange_rate) || 1;
      const lines: Record<string, any>[] = (byQuot.get(q.id) ?? []).map(l => ({ ...l, foreign_unit_price: l.unit_price, unit_price: l.unit_price == null ? null : Number(l.unit_price) * rate }));
      let subtotal = 0; let covered = 0;
      for (const it of items.rows) {
        const l = lines.find(x => x.rfq_item_id === it.id);
        if (l && l.available && l.unit_price != null) { subtotal += Number(l.unit_price) * Number(l.quantity ?? it.quantity); covered++; }
      }
      const discount = subtotal * Number(q.discount_pct) / 100;
      const total = subtotal - discount + Number(q.shipping_cost) * rate;
      return { ...q, lines, subtotal: subtotal.toFixed(2), discount_amount: discount.toFixed(2), total_ht: total.toFixed(2),
               total_foreign: rate !== 1 ? (total / rate).toFixed(2) : null, covered, complete: covered === items.rows.length };
    });
    const bestByItem: Record<string, { quotationId: string; unitPrice: number } | null> = {};
    for (const it of items.rows) {
      let best: { quotationId: string; unitPrice: number } | null = null;
      for (const q of quotes) {
        const l = (q.lines as Record<string, unknown>[]).find(x => x.rfq_item_id === it.id);
        if (l && l.available && l.unit_price != null && (!best || Number(l.unit_price) < best.unitPrice)) best = { quotationId: q.id as string, unitPrice: Number(l.unit_price) };
      }
      bestByItem[it.id] = best;
    }
    const complete = quotes.filter(q => q.complete);
    const bestTotalId = complete.length ? complete.reduce((a, b) => (Number(a.total_ht) <= Number(b.total_ht) ? a : b)).id : null;
    return { ...rfq, items: items.rows, suppliers: suppliers.rows, quotations: quotes, best_by_item: bestByItem, best_total_quotation_id: bestTotalId };
  },

  async list(p: { status?: RfqStatus; search?: string; storeId?: string; limit: number; offset: number }) {
    const values: unknown[] = [];
    const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
    const base = [p.storeId ? `(r.store_id IS NULL OR r.store_id = ${add(p.storeId)}::uuid)` : 'true'];
    if (p.search) {
      const s = add(`%${p.search}%`);
      base.push(`(r.number ILIKE ${s} OR r.title ILIKE ${s} OR EXISTS (SELECT 1 FROM rfq_suppliers rs JOIN suppliers s2 ON s2.id = rs.supplier_id WHERE rs.rfq_id = r.id AND s2.name ILIKE ${s}))`);
    }
    const nBase = values.length;
    const cond = [...base];
    if (p.status) cond.push(`r.status = ${add(p.status)}`);
    const nCond = values.length;
    const lim = add(p.limit); const off = add(p.offset);
    const [rows, total, counts] = await Promise.all([
      db.query(`${SELECT} WHERE ${cond.join(' AND ')} ORDER BY (r.status IN ('draft', 'sent', 'quoted')) DESC, r.response_deadline NULLS LAST, r.created_at DESC LIMIT ${lim} OFFSET ${off}`, values),
      db.query(`SELECT COUNT(*)::int AS n FROM rfqs r WHERE ${cond.join(' AND ')}`, values.slice(0, nCond)),
      db.query(`SELECT r.status, COUNT(*)::int AS count,
                       COUNT(*) FILTER (WHERE r.status IN ('sent', 'quoted') AND r.response_deadline < CURRENT_DATE)::int AS overdue
                  FROM rfqs r WHERE ${base.join(' AND ')} GROUP BY r.status`, values.slice(0, nBase)),
    ]);
    const byStatus: Record<string, { count: number; overdue: number }> = {};
    for (const c of counts.rows) byStatus[c.status] = { count: c.count, overdue: c.overdue };
    return { rows: rows.rows, total: total.rows[0].n as number, byStatus };
  },

  /** Envoi : l'AO est figé (lignes), les fournisseurs sont marqués consultés. */
  async send(id: string) {
    const cur = await db.query(`SELECT status, (SELECT COUNT(*) FROM rfq_items WHERE rfq_id = $1) AS n, (SELECT COUNT(*) FROM rfq_suppliers WHERE rfq_id = $1) AS s FROM rfqs WHERE id = $1`, [id]);
    const row = cur.rows[0];
    if (!row) return { error: 'not_found' as const };
    if (row.status !== 'draft') return { error: 'transition' as const, from: row.status as RfqStatus };
    if (Number(row.n) === 0 || Number(row.s) === 0) return { error: 'incomplete' as const };
    await db.query(`UPDATE rfqs SET status = 'sent', sent_at = now() WHERE id = $1`, [id]);
    await db.query(`UPDATE rfq_suppliers SET invited_at = COALESCE(invited_at, now()) WHERE rfq_id = $1`, [id]);
    return { data: await this.findById(id) };
  },

  async setStatus(id: string, to: 'cancelled' | 'closed' | 'draft') {
    const cur = await db.query(`SELECT status FROM rfqs WHERE id = $1`, [id]);
    const from = cur.rows[0]?.status as RfqStatus | undefined;
    if (!from) return { error: 'not_found' as const };
    const ok = (to === 'cancelled' && ['draft', 'sent', 'quoted'].includes(from))
      || (to === 'closed' && ['sent', 'quoted'].includes(from))
      || (to === 'draft' && ['cancelled', 'closed'].includes(from));
    if (!ok) return { error: 'transition' as const, from };
    await db.query(`UPDATE rfqs SET status = $2::text WHERE id = $1`, [id, to]);
    return { data: await this.findById(id) };
  },

  async setSupplierStatus(id: string, supplierId: string, status: 'invited' | 'declined' | 'no_response', note?: string | null) {
    await db.query(`UPDATE rfq_suppliers SET status = $3, contact_note = COALESCE($4, contact_note) WHERE rfq_id = $1 AND supplier_id = $2`, [id, supplierId, status, note ?? null]);
    return this.findById(id);
  },

  /** Devis d'un fournisseur : créé ou remplacé (un seul par fournisseur et par AO). */
  async saveQuotation(rfqId: string, input: QuotationInput, userId: string) {
    const rfq = await db.query(`SELECT status FROM rfqs WHERE id = $1`, [rfqId]);
    if (!rfq.rows[0]) return { error: 'not_found' as const };
    if (!['sent', 'quoted'].includes(rfq.rows[0].status)) return { error: 'transition' as const, from: rfq.rows[0].status as RfqStatus };
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO rfq_suppliers (rfq_id, supplier_id, status, invited_at) VALUES ($1, $2, 'quoted', now())
                          ON CONFLICT (rfq_id, supplier_id) DO UPDATE SET status = 'quoted'`, [rfqId, input.supplierId]);
      const q = await client.query(
        `INSERT INTO supplier_quotations (rfq_id, supplier_id, quotation_ref, received_at, valid_until, delivery_days, payment_terms, shipping_cost, discount_pct, notes, created_by, currency_code, exchange_rate)
         VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (rfq_id, supplier_id) DO UPDATE SET quotation_ref = EXCLUDED.quotation_ref, received_at = EXCLUDED.received_at, valid_until = EXCLUDED.valid_until,
           delivery_days = EXCLUDED.delivery_days, payment_terms = EXCLUDED.payment_terms, shipping_cost = EXCLUDED.shipping_cost, discount_pct = EXCLUDED.discount_pct,
           notes = EXCLUDED.notes, status = 'received', currency_code = EXCLUDED.currency_code, exchange_rate = EXCLUDED.exchange_rate
         RETURNING id`,
        [rfqId, input.supplierId, input.quotationRef?.trim() || null, input.receivedAt ?? null, input.validUntil ?? null, input.deliveryDays ?? null,
         input.paymentTerms?.trim() || null, input.shippingCost ?? 0, input.discountPct ?? 0, input.notes?.trim() || null, userId,
         input.currencyCode && input.currencyCode !== 'MAD' ? input.currencyCode : 'MAD',
         input.currencyCode && input.currencyCode !== 'MAD' && input.exchangeRate ? input.exchangeRate : 1],
      );
      const qid = q.rows[0].id as string;
      await client.query(`DELETE FROM supplier_quotation_items WHERE quotation_id = $1`, [qid]);
      for (const it of input.items) {
        const available = it.available ?? it.unitPrice != null;
        await client.query(
          `INSERT INTO supplier_quotation_items (quotation_id, rfq_item_id, available, unit_price, quantity, note) VALUES ($1, $2, $3, $4, $5, $6)`,
          [qid, it.rfqItemId, available, available ? it.unitPrice : null, it.quantity ?? null, it.note?.trim() || null],
        );
      }
      await syncStatus(client, rfqId);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return { data: await this.findById(rfqId) };
  },

  /** Retenir un devis : crée le BC depuis ses lignes disponibles, fige l'AO. */
  async award(rfqId: string, quotationId: string, p: { userId: string; storeId?: string; expectedDeliveryDate?: string | null; notes?: string | null }) {
    const rfq = await this.findById(rfqId);
    if (!rfq) return { error: 'not_found' as const };
    if (!['sent', 'quoted'].includes(rfq.status)) return { error: 'transition' as const, from: rfq.status as RfqStatus };
    const q = rfq.quotations.find((x: Record<string, unknown>) => x.id === quotationId);
    if (!q) return { error: 'quotation' as const };
    const items = rfq.items
      .map((it: Record<string, unknown>) => {
        const l = (q.lines as Record<string, unknown>[]).find(x => x.rfq_item_id === it.id);
        if (!l || !l.available || l.unit_price == null) return null;
        return {
          lineType: it.line_type, ingredientId: it.ingredient_id, packagingId: it.packaging_id, description: it.description, categoryId: it.category_id,
          unit: it.unit, quantityOrdered: Number(l.quantity ?? it.quantity), unitPrice: Math.round(Number(l.unit_price) * 10000) / 10000,
          foreignUnitPrice: q.currency_code !== 'MAD' ? Number(l.foreign_unit_price) : null,
        };
      })
      .filter(Boolean);
    if (!items.length) return { error: 'empty' as const };
    const po = await purchaseOrderRepository.create({
      supplierId: q.supplier_id as string,
      expectedDeliveryDate: p.expectedDeliveryDate ?? (q.delivery_days != null ? new Date(Date.now() + Number(q.delivery_days) * 86400000).toISOString().slice(0, 10) : undefined),
      notes: p.notes ?? `Appel d'offres ${rfq.number}${q.quotation_ref ? ` · devis ${q.quotation_ref}` : ''}`,
      createdBy: p.userId, storeId: p.storeId, items: items as never,
      currencyCode: q.currency_code as string, exchangeRate: Number(q.exchange_rate) || 1,
    });
    await db.query(`UPDATE supplier_quotations SET status = CASE WHEN id = $2 THEN 'selected' ELSE 'rejected' END WHERE rfq_id = $1`, [rfqId, quotationId]);
    await db.query(`UPDATE rfqs SET status = 'awarded', awarded_quotation_id = $2, awarded_at = now(), purchase_order_id = $3 WHERE id = $1`, [rfqId, quotationId, po.id]);
    return { data: await this.findById(rfqId), purchaseOrder: po };
  },
};
