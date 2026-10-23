import { db } from '../config/database.js';

/**
 * Pilotage des achats (mig 312, D9). Lectures seules sur des vues :
 * le rapprochement se fait par LIGNE de BC, au prix du BC.
 */
export const purchasingReportsRepository = {
  async summary() {
    const r = await db.query(`
      SELECT
        (SELECT json_build_object('lines', count(*), 'pos', count(DISTINCT po_id), 'amount', COALESCE(round(sum(amount_at_po_price), 2), 0),
                                  'aged', count(*) FILTER (WHERE age_days > 30), 'price_missing', count(*) FILTER (WHERE price_missing))
           FROM kpi_received_not_invoiced) AS received_not_invoiced,
        (SELECT json_build_object('lines', count(*), 'pos', count(DISTINCT po_id), 'amount', COALESCE(round(sum(amount_invoiced), 2), 0))
           FROM kpi_invoiced_not_received) AS invoiced_not_received,
        (SELECT json_build_object('pos', count(*), 'amount', COALESCE(round(sum(amount), 2), 0))
           FROM kpi_open_commitments) AS open_commitments,
        (SELECT json_build_object('count', count(*), 'amount', COALESCE(round(sum(total_amount), 2), 0))
           FROM kpi_invoices_without_lines) AS invoices_without_lines`);
    return r.rows[0];
  },

  async receivedNotInvoiced(params: { supplierId?: string; minAgeDays?: number }) {
    const r = await db.query(
      `SELECT * FROM kpi_received_not_invoiced
        WHERE ($1::uuid IS NULL OR supplier_id = $1) AND ($2::int IS NULL OR age_days >= $2)
        ORDER BY supplier_name, age_days DESC NULLS LAST`, [params.supplierId ?? null, params.minAgeDays ?? null]);
    return r.rows;
  },

  async invoicedNotReceived(params: { supplierId?: string }) {
    const r = await db.query(
      `SELECT * FROM kpi_invoiced_not_received WHERE ($1::uuid IS NULL OR supplier_id = $1)
        ORDER BY supplier_name, order_number`, [params.supplierId ?? null]);
    return r.rows;
  },

  async openCommitments(params: { supplierId?: string }) {
    const r = await db.query(
      `SELECT * FROM kpi_open_commitments WHERE ($1::uuid IS NULL OR supplier_id = $1)
        ORDER BY supplier_name, order_date`, [params.supplierId ?? null]);
    return r.rows;
  },

  /**
   * Écran Pilotage : une des 4 listes de rapprochement, filtrée et paginée côté serveur,
   * au détail (ligne / BC / facture) ou regroupée par fournisseur. Total du filtre inclus.
   */
  async board(params: {
    kind: 'commitments' | 'rni' | 'inr' | 'nolines'; group: 'detail' | 'supplier';
    supplierId?: string; search?: string; dateFrom?: string; dateTo?: string; minAgeDays?: number;
    limit: number; offset: number;
  }) {
    // Source normalisée : chaque liste expose les mêmes colonnes de base (doc_date, doc_amount, age_days, search_text).
    const SOURCES: Record<typeof params.kind, string> = {
      commitments: `SELECT c.*, c.order_date::date AS doc_date, c.amount AS doc_amount, (CURRENT_DATE - c.order_date::date)::int AS age_days,
                           po.expected_delivery_date,
                           (po.expected_delivery_date IS NOT NULL AND po.expected_delivery_date < CURRENT_DATE) AS is_late,
                           concat_ws(' ', c.supplier_name, c.order_number) AS search_text,
                           c.po_id::text AS doc_key
                    FROM kpi_open_commitments c JOIN purchase_orders po ON po.id = c.po_id`,
      rni: `SELECT r.*, r.last_received_at::date AS doc_date, r.amount_at_po_price AS doc_amount, (r.age_days > 30) AS is_late,
                   concat_ws(' ', r.supplier_name, r.order_number, r.item_name) AS search_text, r.po_id::text AS doc_key
            FROM kpi_received_not_invoiced r`,
      inr: `SELECT r.*, r.last_invoiced_at::date AS doc_date, r.amount_invoiced AS doc_amount, true AS is_late,
                   concat_ws(' ', r.supplier_name, r.order_number, r.item_name) AS search_text, r.po_id::text AS doc_key
            FROM kpi_invoiced_not_received r`,
      nolines: `SELECT w.*, w.invoice_date::date AS doc_date, w.total_amount AS doc_amount, (CURRENT_DATE - w.invoice_date::date)::int AS age_days,
                       inv.status AS invoice_status, inv.supplier_invoice_number, false AS is_late,
                       concat_ws(' ', w.supplier_name, w.invoice_number, inv.supplier_invoice_number) AS search_text,
                       w.invoice_id::text AS doc_key
                FROM kpi_invoices_without_lines w JOIN invoices inv ON inv.id = w.invoice_id`,
    };
    const values: unknown[] = [];
    const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
    const cond: string[] = ['true'];
    if (params.supplierId) cond.push(`supplier_id = ${add(params.supplierId)}::uuid`);
    if (params.search) cond.push(`search_text ILIKE ${add(`%${params.search}%`)}`);
    if (params.dateFrom) cond.push(`doc_date >= ${add(params.dateFrom)}::date`);
    if (params.dateTo) cond.push(`doc_date <= ${add(params.dateTo)}::date`);
    if (params.minAgeDays != null) cond.push(`age_days >= ${add(params.minAgeDays)}::int`);
    const limit = add(params.limit);
    const offset = add(params.offset);
    const src = `WITH src AS (${SOURCES[params.kind]}), f AS (SELECT * FROM src WHERE ${cond.join(' AND ')})`;
    const sql = params.group === 'supplier'
      ? `${src}, g AS (
           SELECT supplier_id, MAX(supplier_name) AS supplier_name, COUNT(*)::int AS lines,
                  COUNT(DISTINCT doc_key)::int AS docs, COALESCE(SUM(doc_amount), 0) AS doc_amount,
                  MAX(age_days) AS max_age, MIN(doc_date) AS oldest_date, bool_or(is_late) AS is_late
           FROM f GROUP BY supplier_id)
         SELECT g.*, COUNT(*) OVER() AS total_count, SUM(doc_amount) OVER() AS sum_amount
         FROM g ORDER BY doc_amount DESC, supplier_name
         LIMIT ${limit} OFFSET ${offset}`
      : `${src}
         SELECT f.*, COUNT(*) OVER() AS total_count, SUM(doc_amount) OVER() AS sum_amount
         FROM f ORDER BY supplier_name NULLS LAST, supplier_id, is_late DESC, age_days DESC NULLS LAST
         LIMIT ${limit} OFFSET ${offset}`;
    const r = await db.query(sql, values);
    const first = r.rows[0];
    return {
      rows: r.rows.map(({ total_count: _t, sum_amount: _s, search_text: _q, ...row }) => row),
      total: first ? parseInt(first.total_count, 10) : 0,
      sumAmount: first ? Number(first.sum_amount) : 0,
    };
  },

  async invoicesWithoutLines() {
    const r = await db.query(`SELECT * FROM kpi_invoices_without_lines ORDER BY invoice_date DESC`);
    return r.rows;
  },

  async goodsEntryRegister(params: { from?: string; to?: string; supplierId?: string; lot?: string; incompleteOnly?: boolean; storeId?: string }) {
    const r = await db.query(
      `SELECT * FROM v_goods_entry_register
        WHERE ($1::date IS NULL OR entry_date >= $1) AND ($2::date IS NULL OR entry_date <= $2)
          AND ($3::uuid IS NULL OR supplier_id = $3)
          AND ($4::text IS NULL OR supplier_lot ILIKE '%' || $4 || '%' OR internal_lot ILIKE '%' || $4 || '%')
          AND (NOT $5::boolean OR incomplete)
          AND ($6::uuid IS NULL OR store_id IS NULL OR store_id = $6)
        ORDER BY entry_date DESC, recorded_at DESC
        LIMIT 5000`,
      [params.from ?? null, params.to ?? null, params.supplierId ?? null, params.lot || null, !!params.incompleteOnly, params.storeId ?? null]);
    return r.rows;
  },

  /**
   * Registre des entrées paginé (écran Stock › Registre) : mêmes filtres que l'export,
   * plus un critère (incomplète / non conforme / hors BC) et une recherche libre ;
   * compteurs de la période renvoyés pour les cartes.
   */
  async goodsEntryRegisterPage(params: {
    from?: string; to?: string; supplierId?: string; search?: string; flag?: string; storeId?: string; limit: number; offset: number;
  }) {
    const values: unknown[] = [];
    const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
    const base: string[] = ['true'];
    if (params.from) base.push(`entry_date >= ${add(params.from)}::date`);
    if (params.to) base.push(`entry_date <= ${add(params.to)}::date`);
    if (params.supplierId) base.push(`supplier_id = ${add(params.supplierId)}::uuid`);
    if (params.storeId) base.push(`(store_id IS NULL OR store_id = ${add(params.storeId)}::uuid)`);
    if (params.search) {
      const p = add(`%${params.search}%`);
      base.push(`(COALESCE(item_name, '') ILIKE ${p} OR COALESCE(supplier_name, '') ILIKE ${p} OR COALESCE(supplier_lot, '') ILIKE ${p}
               OR COALESCE(internal_lot, '') ILIKE ${p} OR COALESCE(voucher_number, '') ILIKE ${p} OR COALESCE(order_number, '') ILIKE ${p})`);
    }
    const flag = params.flag === 'incomplete' ? 'incomplete'
      : params.flag === 'nonconform' ? 'overall_conformity = false'
      : params.flag === 'hors_bc' ? `source = 'hors_bc'` : 'true';
    const lim = add(params.limit);
    const off = add(params.offset);
    const r = await db.query(
      `WITH f AS (SELECT * FROM v_goods_entry_register WHERE ${base.join(' AND ')})
       SELECT f.*,
              COUNT(*) OVER() AS total_count,
              (SELECT COUNT(*) FROM f) AS all_count,
              (SELECT COUNT(*) FROM f WHERE incomplete) AS incomplete_count,
              (SELECT COUNT(*) FROM f WHERE overall_conformity = false) AS nonconform_count,
              (SELECT COUNT(*) FROM f WHERE source = 'hors_bc') AS hors_bc_count
         FROM f WHERE ${flag}
        ORDER BY entry_date DESC, recorded_at DESC
        LIMIT ${lim} OFFSET ${off}`,
      values);
    const first = r.rows[0];
    // Compteurs indépendants du critère : si la page est vide on les recalcule sans lui.
    let counts = first ? {
      all: Number(first.all_count), incomplete: Number(first.incomplete_count),
      nonconform: Number(first.nonconform_count), hors_bc: Number(first.hors_bc_count),
    } : null;
    if (!counts) {
      const c = await db.query(
        `SELECT COUNT(*) AS all_count, COUNT(*) FILTER (WHERE incomplete) AS incomplete_count,
                COUNT(*) FILTER (WHERE overall_conformity = false) AS nonconform_count,
                COUNT(*) FILTER (WHERE source = 'hors_bc') AS hors_bc_count
           FROM v_goods_entry_register WHERE ${base.join(' AND ')}`,
        values.slice(0, values.length - 2));
      const x = c.rows[0];
      counts = { all: Number(x.all_count), incomplete: Number(x.incomplete_count), nonconform: Number(x.nonconform_count), hors_bc: Number(x.hors_bc_count) };
    }
    return {
      rows: r.rows.map(({ total_count: _a, all_count: _b, incomplete_count: _c, nonconform_count: _d, hors_bc_count: _e, ...row }) => row),
      total: first ? parseInt(first.total_count, 10) : 0,
      counts,
    };
  },

  async purchaseJournal(params: { from: string; to: string }) {
    const r = await db.query(
      `SELECT * FROM v_purchase_journal WHERE invoice_date BETWEEN $1 AND $2 ORDER BY invoice_date, invoice_number`,
      [params.from, params.to]);
    return r.rows;
  },
};

/** CSV « ; » avec BOM (Excel FR), généré côté serveur pour un fichier complet. */
export function toCsv(headers: { key: string; label: string }[], rows: Record<string, unknown>[]): string {
  const cell = (v: unknown) => {
    if (v == null) return '';
    let s = v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'boolean' ? (v ? 'oui' : 'non') : String(v);
    if (/^\d+\.\d+$/.test(s)) s = s.replace('.', ',');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [headers.map(h => h.label).join(';'), ...rows.map(r => headers.map(h => cell(r[h.key])).join(';'))].join('\n');
}
