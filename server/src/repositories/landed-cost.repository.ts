import { db } from '../config/database.js';
import { nextDocumentNumber } from '../utils/document-number.js';

/**
 * Frais d'approche (mig 361) : frais annexes d'une réception (transport, douane…)
 * répartis sur ses lignes puis appliqués au coût du lot reçu et au coût standard
 * de l'article (CMUP), sans écriture comptable.
 */

export type AllocationMethod = 'value' | 'quantity';
export type ChargeInput = { label: string; amount: number; categoryId?: string | null; supplierId?: string | null; invoiceId?: string | null };

const NAME = (a: string) => `${a}.first_name || ' ' || ${a}.last_name`;

/** Lignes d'une réception valorisables (entrées positives, article identifié). */
const RECEPTION_LINES = `
  SELECT rvi.id, rvi.ingredient_id, rvi.packaging_id, rvi.kind,
         COALESCE(ing.name, pk.name) AS label, COALESCE(ing.unit, pk.unit) AS unit,
         rvi.quantity_received AS quantity, COALESCE(rvi.unit_price, rvi.po_unit_price, 0) AS unit_price,
         rvi.quantity_received * COALESCE(rvi.unit_price, rvi.po_unit_price, 0) AS value,
         il.id AS ingredient_lot_id, il.lot_number, il.unit_cost AS lot_unit_cost,
         COALESCE(ing.unit_cost, pk.unit_cost) AS standard_cost
    FROM reception_voucher_items rvi
    LEFT JOIN ingredients ing ON ing.id = rvi.ingredient_id
    LEFT JOIN packaging_items pk ON pk.id = rvi.packaging_id
    LEFT JOIN ingredient_lots il ON il.reception_voucher_item_id = rvi.id
   WHERE rvi.reception_voucher_id = $1 AND rvi.kind = 'receive' AND rvi.quantity_received > 0
     AND (rvi.ingredient_id IS NOT NULL OR rvi.packaging_id IS NOT NULL)
   ORDER BY rvi.created_at`;

const SELECT = `
  SELECT v.*, rv.voucher_number AS reception_number, rv.reception_date, po.order_number, s.name AS supplier_name,
         ${NAME('cb')} AS created_by_name, ${NAME('ab')} AS applied_by_name,
         (SELECT COUNT(*)::int FROM landed_cost_charges c WHERE c.voucher_id = v.id) AS charge_count,
         (SELECT COUNT(*)::int FROM landed_cost_allocations a WHERE a.voucher_id = v.id) AS line_count
    FROM landed_cost_vouchers v
    JOIN reception_vouchers rv ON rv.id = v.reception_voucher_id
    LEFT JOIN purchase_orders po ON po.id = rv.purchase_order_id
    LEFT JOIN suppliers s ON s.id = po.supplier_id
    LEFT JOIN users cb ON cb.id = v.created_by
    LEFT JOIN users ab ON ab.id = v.applied_by`;

function round(v: number, d: number) { const f = 10 ** d; return Math.round(v * f) / f; }

/** Répartition au prorata (valeur ou quantité) ; le dernier reçoit l'arrondi résiduel. */
export function allocate(lines: { id: string; quantity: number; value: number }[], total: number, method: AllocationMethod) {
  const basisOf = (l: { quantity: number; value: number }) => (method === 'value' ? l.value : l.quantity);
  const sum = lines.reduce((s, l) => s + basisOf(l), 0);
  if (!lines.length || sum <= 0) return [];
  const out: { id: string; basis: number; sharePct: number; amount: number; quantity: number; unitIncrement: number }[] = [];
  let allocated = 0;
  lines.forEach((l, i) => {
    const basis = basisOf(l);
    const share = basis / sum;
    const amount = i === lines.length - 1 ? round(total - allocated, 2) : round(total * share, 2);
    allocated += amount;
    out.push({ id: l.id, basis: round(basis, 4), sharePct: round(share * 100, 4), amount, quantity: l.quantity, unitIncrement: l.quantity > 0 ? round(amount / l.quantity, 6) : 0 });
  });
  return out;
}

export const landedCostRepository = {
  /** Réceptions récentes pour choisir celle à charger (avec frais déjà appliqués). */
  async receptions(p: { storeId?: string; search?: string; limit: number }) {
    const values: unknown[] = [];
    const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
    const cond = [`rv.voucher_kind = 'receipt'`, `rv.status = 'posted'`];
    if (p.storeId) cond.push(`(rv.store_id IS NULL OR rv.store_id = ${add(p.storeId)}::uuid)`);
    if (p.search) { const s = add(`%${p.search}%`); cond.push(`(rv.voucher_number ILIKE ${s} OR po.order_number ILIKE ${s} OR s.name ILIKE ${s})`); }
    const lim = add(p.limit);
    const r = await db.query(
      `SELECT rv.id, rv.voucher_number, rv.reception_date, po.order_number, s.name AS supplier_name,
              (SELECT COUNT(*)::int FROM reception_voucher_items i WHERE i.reception_voucher_id = rv.id AND i.kind = 'receive') AS line_count,
              (SELECT COALESCE(SUM(i.quantity_received * COALESCE(i.unit_price, i.po_unit_price, 0)), 0) FROM reception_voucher_items i WHERE i.reception_voucher_id = rv.id AND i.kind = 'receive') AS total_value,
              (SELECT COALESCE(SUM(v.total_amount), 0) FROM landed_cost_vouchers v WHERE v.reception_voucher_id = rv.id AND v.status = 'applied') AS landed_applied
         FROM reception_vouchers rv
         LEFT JOIN purchase_orders po ON po.id = rv.purchase_order_id
         LEFT JOIN suppliers s ON s.id = po.supplier_id
        WHERE ${cond.join(' AND ')}
        ORDER BY rv.reception_date DESC, rv.created_at DESC LIMIT ${lim}`, values);
    return r.rows;
  },

  async receptionLines(receptionVoucherId: string) {
    const r = await db.query(RECEPTION_LINES, [receptionVoucherId]);
    return r.rows;
  },

  /** Aperçu de la répartition sans rien enregistrer. */
  async preview(receptionVoucherId: string, total: number, method: AllocationMethod) {
    const lines = await this.receptionLines(receptionVoucherId);
    const alloc = allocate(lines.map(l => ({ id: l.id, quantity: Number(l.quantity), value: Number(l.value) })), total, method);
    return lines.map(l => {
      const a = alloc.find(x => x.id === l.id);
      return { ...l, basis_value: a?.basis ?? 0, share_pct: a?.sharePct ?? 0, amount: a?.amount ?? 0, unit_increment: a?.unitIncrement ?? 0 };
    });
  },

  async create(input: { receptionVoucherId: string; method: AllocationMethod; charges: ChargeInput[]; notes?: string | null }, ctx: { userId: string; storeId: string | null }) {
    const total = round(input.charges.reduce((s, c) => s + c.amount, 0), 2);
    const lines = await this.receptionLines(input.receptionVoucherId);
    if (!lines.length) return { error: 'no_lines' as const };
    const alloc = allocate(lines.map(l => ({ id: l.id, quantity: Number(l.quantity), value: Number(l.value) })), total, input.method);
    if (!alloc.length) return { error: 'no_basis' as const };
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const number = await nextDocumentNumber(client, 'landed_cost');
      const v = await client.query(
        `INSERT INTO landed_cost_vouchers (number, store_id, reception_voucher_id, allocation_method, total_amount, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [number, ctx.storeId, input.receptionVoucherId, input.method, total, input.notes?.trim() || null, ctx.userId],
      );
      const id = v.rows[0].id as string;
      let order = 0;
      for (const c of input.charges) {
        await client.query(
          `INSERT INTO landed_cost_charges (voucher_id, label, amount, category_id, supplier_id, invoice_id, display_order) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, c.label.trim(), c.amount, c.categoryId ?? null, c.supplierId ?? null, c.invoiceId ?? null, (order += 10)],
        );
      }
      for (const a of alloc) {
        await client.query(
          `INSERT INTO landed_cost_allocations (voucher_id, reception_voucher_item_id, basis_value, share_pct, amount, quantity, unit_increment, ingredient_lot_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, a.id, a.basis, a.sharePct, a.amount, a.quantity, a.unitIncrement, lines.find(l => l.id === a.id)?.ingredient_lot_id ?? null],
        );
      }
      await client.query('COMMIT');
      return { data: await this.findById(id) };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async findById(id: string) {
    const r = await db.query(`${SELECT} WHERE v.id = $1`, [id]);
    const v = r.rows[0];
    if (!v) return null;
    const [charges, allocations] = await Promise.all([
      db.query(`SELECT c.*, ec.name AS category_name, s.name AS supplier_name, i.invoice_number
                  FROM landed_cost_charges c LEFT JOIN expense_categories ec ON ec.id = c.category_id
                  LEFT JOIN suppliers s ON s.id = c.supplier_id LEFT JOIN invoices i ON i.id = c.invoice_id
                 WHERE c.voucher_id = $1 ORDER BY c.display_order`, [id]),
      db.query(`SELECT a.*, COALESCE(ing.name, pk.name) AS label, COALESCE(ing.unit, pk.unit) AS unit, il.lot_number,
                       COALESCE(rvi.unit_price, rvi.po_unit_price, 0) AS unit_price,
                       COALESCE(il.unit_cost, ing.unit_cost, pk.unit_cost) AS current_cost
                  FROM landed_cost_allocations a
                  JOIN reception_voucher_items rvi ON rvi.id = a.reception_voucher_item_id
                  LEFT JOIN ingredients ing ON ing.id = rvi.ingredient_id
                  LEFT JOIN packaging_items pk ON pk.id = rvi.packaging_id
                  LEFT JOIN ingredient_lots il ON il.id = a.ingredient_lot_id
                 WHERE a.voucher_id = $1 ORDER BY rvi.created_at`, [id]),
    ]);
    return { ...v, charges: charges.rows, allocations: allocations.rows };
  },

  async list(p: { status?: string; search?: string; storeId?: string; limit: number; offset: number }) {
    const values: unknown[] = [];
    const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
    const cond = [p.storeId ? `(v.store_id IS NULL OR v.store_id = ${add(p.storeId)}::uuid)` : 'true'];
    if (p.status) cond.push(`v.status = ${add(p.status)}`);
    if (p.search) { const s = add(`%${p.search}%`); cond.push(`(v.number ILIKE ${s} OR rv.voucher_number ILIKE ${s} OR po.order_number ILIKE ${s} OR s.name ILIKE ${s})`); }
    const n = values.length;
    const lim = add(p.limit); const off = add(p.offset);
    const [rows, total] = await Promise.all([
      db.query(`${SELECT} WHERE ${cond.join(' AND ')} ORDER BY (v.status = 'draft') DESC, v.created_at DESC LIMIT ${lim} OFFSET ${off}`, values),
      db.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(v.total_amount) FILTER (WHERE v.status = 'applied'), 0) AS applied_total
                  FROM landed_cost_vouchers v JOIN reception_vouchers rv ON rv.id = v.reception_voucher_id
                  LEFT JOIN purchase_orders po ON po.id = rv.purchase_order_id LEFT JOIN suppliers s ON s.id = po.supplier_id
                 WHERE ${cond.join(' AND ')}`, values.slice(0, n)),
    ]);
    return { rows: rows.rows, total: total.rows[0].n as number, appliedTotal: total.rows[0].applied_total };
  },

  /**
   * Application : pour chaque ligne, le lot reçu prend l'incrément unitaire en plein ;
   * le coût standard (CMUP) prend la part du montant encore en stock, diluée dans le
   * stock total actif — même logique que le CMUP à la réception. Verrous FOR UPDATE
   * sur l'article pour sérialiser avec les réceptions.
   */
  async apply(id: string, userId: string) {
    const v = await this.findById(id);
    if (!v) return { error: 'not_found' as const };
    if (v.status !== 'draft') return { error: 'status' as const, status: v.status as string };
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      for (const a of v.allocations as Record<string, any>[]) {
        const line = (await client.query(`SELECT ingredient_id, packaging_id FROM reception_voucher_items WHERE id = $1`, [a.reception_voucher_item_id])).rows[0];
        const inc = Number(a.unit_increment);
        let lotBefore: number | null = null; let lotAfter: number | null = null;
        let stdBefore: number | null = null; let stdAfter: number | null = null;
        if (line.ingredient_id) {
          const ing = (await client.query(`SELECT unit_cost FROM ingredients WHERE id = $1 FOR UPDATE`, [line.ingredient_id])).rows[0];
          stdBefore = ing?.unit_cost != null ? Number(ing.unit_cost) : null;
          let remaining = Number(a.quantity);
          if (a.ingredient_lot_id) {
            const lot = (await client.query(`SELECT unit_cost, economat_quantity + pesage_quantity AS remaining, status FROM ingredient_lots WHERE id = $1 FOR UPDATE`, [a.ingredient_lot_id])).rows[0];
            if (lot) {
              lotBefore = Number(lot.unit_cost ?? 0); lotAfter = round(lotBefore + inc, 4);
              remaining = lot.status === 'active' ? Math.max(0, Number(lot.remaining)) : 0;
              await client.query(`UPDATE ingredient_lots SET unit_cost = $2 WHERE id = $1`, [a.ingredient_lot_id, lotAfter]);
            }
          }
          const stock = Number((await client.query(
            `SELECT COALESCE(SUM(economat_quantity + pesage_quantity), 0) AS qty FROM ingredient_lots WHERE ingredient_id = $1 AND status = 'active'`,
            [line.ingredient_id])).rows[0].qty);
          // Part des frais encore en stock (lot restant × incrément), diluée dans tout le stock.
          const delta = stock > 0 ? (inc * Math.min(remaining, stock)) / stock : inc;
          stdAfter = round((stdBefore ?? 0) + delta, 4);
          await client.query(`UPDATE ingredients SET unit_cost = $2 WHERE id = $1`, [line.ingredient_id, stdAfter]);
        } else if (line.packaging_id) {
          const pk = (await client.query(`SELECT unit_cost FROM packaging_items WHERE id = $1 FOR UPDATE`, [line.packaging_id])).rows[0];
          stdBefore = pk?.unit_cost != null ? Number(pk.unit_cost) : null;
          const stock = Number((await client.query(`SELECT COALESCE(SUM(stock_quantity), 0) AS qty FROM packaging_store_stock WHERE packaging_id = $1`, [line.packaging_id])).rows[0].qty);
          const delta = stock > 0 ? (inc * Math.min(Number(a.quantity), stock)) / stock : inc;
          stdAfter = round((stdBefore ?? 0) + delta, 4);
          await client.query(`UPDATE packaging_items SET unit_cost = $2, updated_at = NOW() WHERE id = $1`, [line.packaging_id, stdAfter]);
        }
        await client.query(
          `UPDATE landed_cost_allocations SET lot_cost_before = $2, lot_cost_after = $3, standard_cost_before = $4, standard_cost_after = $5 WHERE id = $1`,
          [a.id, lotBefore, lotAfter, stdBefore, stdAfter],
        );
      }
      await client.query(`UPDATE landed_cost_vouchers SET status = 'applied', applied_at = now(), applied_by = $2 WHERE id = $1`, [id, userId]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return { data: await this.findById(id) };
  },

  async cancel(id: string) {
    const r = await db.query(`UPDATE landed_cost_vouchers SET status = 'cancelled' WHERE id = $1 AND status = 'draft' RETURNING id`, [id]);
    return r.rows[0] ? this.findById(id) : null;
  },
};
