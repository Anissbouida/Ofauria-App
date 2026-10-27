import { db } from '../config/database.js';
import { getParameter } from '../services/module-parameters.service.js';

/**
 * Évaluation des fournisseurs (mig 362) : note 0-100 calculée sur une période à
 * partir des BC, réceptions, contrôles qualité et factures. Chaque critère donne un
 * taux 0-100 ; la note est la moyenne pondérée des critères renseignés (un critère
 * sans donnée est écarté et les poids restants renormalisés).
 */

export type ScoreWeights = {
  on_time: number; fill_rate: number; quality: number; price: number; disputes: number;
  min_orders: number; months: number; a_min: number; b_min: number; c_min: number;
};
export const DEFAULT_WEIGHTS: ScoreWeights = { on_time: 30, fill_rate: 20, quality: 20, price: 20, disputes: 10, min_orders: 3, months: 12, a_min: 85, b_min: 70, c_min: 50 };
export type Standing = 'A' | 'B' | 'C' | 'D' | 'new';

export type SupplierMetrics = {
  orders: number;
  on_time: { ok: number; total: number; rate: number | null; avg_late_days: number | null };
  fill_rate: { ok: number; total: number; rate: number | null };
  quality: { ok: number; total: number; rate: number | null };
  price: { ok: number; total: number; rate: number | null; avg_increase_pct: number | null };
  disputes: { disputed: number; total: number; rate: number | null };
};

export async function loadWeights(): Promise<ScoreWeights> {
  const v = await getParameter<Partial<ScoreWeights> | null>('purchasing.supplier_score');
  return { ...DEFAULT_WEIGHTS, ...(v ?? {}) };
}

/** Note pondérée des critères renseignés ; null si aucun critère n'a de donnée. */
export function computeScore(m: SupplierMetrics, w: ScoreWeights): { score: number | null; standing: Standing; parts: Record<string, number | null> } {
  const parts: Record<string, number | null> = {
    on_time: m.on_time.rate, fill_rate: m.fill_rate.rate, quality: m.quality.rate, price: m.price.rate,
    disputes: m.disputes.rate == null ? null : Math.max(0, 100 - m.disputes.rate * 2),
  };
  let num = 0; let den = 0;
  for (const k of ['on_time', 'fill_rate', 'quality', 'price', 'disputes'] as const) {
    const v = parts[k]; const weight = Number(w[k]) || 0;
    if (v == null || weight <= 0) continue;
    num += v * weight; den += weight;
  }
  const score = den > 0 ? Math.round((num / den) * 10) / 10 : null;
  let standing: Standing = 'new';
  if (m.orders >= w.min_orders && score != null) standing = score >= w.a_min ? 'A' : score >= w.b_min ? 'B' : score >= w.c_min ? 'C' : 'D';
  return { score, standing, parts };
}

const pct = (ok: number, total: number) => (total > 0 ? Math.round((ok / total) * 1000) / 10 : null);

export const supplierScoreRepository = {
  /** Métriques brutes de tous les fournisseurs actifs ayant au moins un BC sur la période. */
  async metrics(p: { from: string; to: string; storeId?: string; supplierId?: string }): Promise<Map<string, SupplierMetrics & { supplier_id: string; supplier_name: string }>> {
    const values: unknown[] = [p.from, p.to];
    const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
    const store = p.storeId ? `AND (po.store_id IS NULL OR po.store_id = ${add(p.storeId)}::uuid)` : '';
    const one = p.supplierId ? `AND s.id = ${add(p.supplierId)}::uuid` : '';
    const r = await db.query(
      `WITH pos AS (
         SELECT po.id, po.supplier_id, po.status, po.expected_delivery_date,
                (SELECT MIN(rv.reception_date) FROM reception_vouchers rv WHERE rv.purchase_order_id = po.id AND rv.voucher_kind = 'receipt' AND rv.status = 'posted') AS first_reception
           FROM purchase_orders po
          WHERE po.order_date BETWEEN $1::date AND $2::date AND po.status <> 'annule' ${store}
       ),
       delays AS (
         SELECT supplier_id,
                COUNT(*) FILTER (WHERE first_reception IS NOT NULL AND expected_delivery_date IS NOT NULL) AS total,
                COUNT(*) FILTER (WHERE first_reception IS NOT NULL AND expected_delivery_date IS NOT NULL AND first_reception <= expected_delivery_date) AS ok,
                AVG(first_reception - expected_delivery_date) FILTER (WHERE first_reception > expected_delivery_date) AS avg_late
           FROM pos GROUP BY supplier_id
       ),
       fills AS (
         SELECT supplier_id,
                COUNT(*) FILTER (WHERE status IN ('livre_complet', 'en_attente_facturation', 'livre_partiel', 'non_livre')) AS total,
                COUNT(*) FILTER (WHERE status IN ('livre_complet', 'en_attente_facturation')) AS ok
           FROM pos GROUP BY supplier_id
       ),
       quality AS (
         SELECT po.supplier_id, COUNT(*) AS total, COUNT(*) FILTER (WHERE qc.overall_conformity) AS ok
           FROM reception_quality_checks qc
           JOIN reception_vouchers rv ON rv.id = qc.reception_voucher_id
           JOIN pos po ON po.id = rv.purchase_order_id
          GROUP BY po.supplier_id
       ),
       prices AS (
         SELECT po.supplier_id,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE rvi.unit_price <= rvi.po_unit_price * 1.001) AS ok,
                AVG((rvi.unit_price - rvi.po_unit_price) / NULLIF(rvi.po_unit_price, 0) * 100) FILTER (WHERE rvi.unit_price > rvi.po_unit_price * 1.001) AS avg_increase
           FROM reception_voucher_items rvi
           JOIN reception_vouchers rv ON rv.id = rvi.reception_voucher_id
           JOIN pos po ON po.id = rv.purchase_order_id
          WHERE rvi.kind = 'receive' AND rvi.unit_price IS NOT NULL AND rvi.po_unit_price IS NOT NULL AND rvi.po_unit_price > 0
          GROUP BY po.supplier_id
       ),
       disputes AS (
         SELECT i.supplier_id, COUNT(*) AS total,
                COUNT(*) FILTER (WHERE i.status = 'disputed' OR EXISTS (SELECT 1 FROM invoice_holds h WHERE h.invoice_id = i.id AND h.blocks_payment AND h.released_at IS NULL)) AS disputed
           FROM invoices i
          WHERE i.invoice_type = 'received' AND i.status <> 'cancelled' AND i.invoice_date BETWEEN $1::date AND $2::date AND i.supplier_id IS NOT NULL
          GROUP BY i.supplier_id
       )
       SELECT s.id AS supplier_id, s.name AS supplier_name,
              (SELECT COUNT(*) FROM pos WHERE pos.supplier_id = s.id)::int AS orders,
              COALESCE(d.total, 0)::int AS d_total, COALESCE(d.ok, 0)::int AS d_ok, d.avg_late,
              COALESCE(f.total, 0)::int AS f_total, COALESCE(f.ok, 0)::int AS f_ok,
              COALESCE(q.total, 0)::int AS q_total, COALESCE(q.ok, 0)::int AS q_ok,
              COALESCE(pr.total, 0)::int AS p_total, COALESCE(pr.ok, 0)::int AS p_ok, pr.avg_increase,
              COALESCE(di.total, 0)::int AS i_total, COALESCE(di.disputed, 0)::int AS i_disputed
         FROM suppliers s
         LEFT JOIN delays d ON d.supplier_id = s.id
         LEFT JOIN fills f ON f.supplier_id = s.id
         LEFT JOIN quality q ON q.supplier_id = s.id
         LEFT JOIN prices pr ON pr.supplier_id = s.id
         LEFT JOIN disputes di ON di.supplier_id = s.id
        WHERE (EXISTS (SELECT 1 FROM pos WHERE pos.supplier_id = s.id) OR di.total > 0) ${one}
        ORDER BY s.name`, values);
    const out = new Map<string, SupplierMetrics & { supplier_id: string; supplier_name: string }>();
    for (const x of r.rows) {
      out.set(x.supplier_id, {
        supplier_id: x.supplier_id, supplier_name: x.supplier_name, orders: x.orders,
        on_time: { ok: x.d_ok, total: x.d_total, rate: pct(x.d_ok, x.d_total), avg_late_days: x.avg_late != null ? Math.round(Number(x.avg_late) * 10) / 10 : null },
        fill_rate: { ok: x.f_ok, total: x.f_total, rate: pct(x.f_ok, x.f_total) },
        quality: { ok: x.q_ok, total: x.q_total, rate: pct(x.q_ok, x.q_total) },
        price: { ok: x.p_ok, total: x.p_total, rate: pct(x.p_ok, x.p_total), avg_increase_pct: x.avg_increase != null ? Math.round(Number(x.avg_increase) * 10) / 10 : null },
        disputes: { disputed: x.i_disputed, total: x.i_total, rate: pct(x.i_disputed, x.i_total) },
      });
    }
    return out;
  },

  /** Tableau de notation : une ligne par fournisseur noté, avec la note de l'instantané précédent. */
  async board(p: { from: string; to: string; storeId?: string }) {
    const [w, m] = await Promise.all([loadWeights(), this.metrics(p)]);
    const prev = await db.query(
      `SELECT DISTINCT ON (supplier_id) supplier_id, score, standing, period_to FROM supplier_score_snapshots
        WHERE period_to < $1::date ORDER BY supplier_id, period_to DESC`, [p.to]);
    const prevBy = new Map(prev.rows.map(r => [r.supplier_id, r]));
    const rows = [...m.values()].map(x => {
      const s = computeScore(x, w);
      const pv = prevBy.get(x.supplier_id);
      return { ...x, ...s, previous_score: pv?.score != null ? Number(pv.score) : null, previous_standing: pv?.standing ?? null, previous_period_to: pv?.period_to ?? null };
    });
    rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    const counts = { A: 0, B: 0, C: 0, D: 0, new: 0 } as Record<Standing, number>;
    for (const r of rows) counts[r.standing]++;
    return { rows, weights: w, counts };
  },

  /** Les faits derrière la note d'un fournisseur : BC en retard, réceptions non conformes, hausses de prix, factures en litige. */
  async facts(p: { supplierId: string; from: string; to: string }) {
    const [late, nonconform, increases, disputed] = await Promise.all([
      db.query(`SELECT po.order_number, po.expected_delivery_date, MIN(rv.reception_date) AS first_reception,
                       MIN(rv.reception_date) - po.expected_delivery_date AS late_days
                  FROM purchase_orders po JOIN reception_vouchers rv ON rv.purchase_order_id = po.id AND rv.voucher_kind = 'receipt' AND rv.status = 'posted'
                 WHERE po.supplier_id = $1 AND po.order_date BETWEEN $2::date AND $3::date AND po.expected_delivery_date IS NOT NULL
                 GROUP BY po.id HAVING MIN(rv.reception_date) > po.expected_delivery_date ORDER BY late_days DESC LIMIT 20`, [p.supplierId, p.from, p.to]),
      db.query(`SELECT rv.voucher_number, rv.reception_date, qc.notes, qc.temperature_ok, qc.visual_ok, qc.packaging_ok, qc.labels_ok
                  FROM reception_quality_checks qc JOIN reception_vouchers rv ON rv.id = qc.reception_voucher_id JOIN purchase_orders po ON po.id = rv.purchase_order_id
                 WHERE po.supplier_id = $1 AND po.order_date BETWEEN $2::date AND $3::date AND NOT qc.overall_conformity ORDER BY rv.reception_date DESC LIMIT 20`, [p.supplierId, p.from, p.to]),
      db.query(`SELECT rv.voucher_number, rv.reception_date, COALESCE(ing.name, pk.name) AS label, rvi.po_unit_price, rvi.unit_price,
                       ROUND((rvi.unit_price - rvi.po_unit_price) / rvi.po_unit_price * 100, 1) AS increase_pct
                  FROM reception_voucher_items rvi JOIN reception_vouchers rv ON rv.id = rvi.reception_voucher_id JOIN purchase_orders po ON po.id = rv.purchase_order_id
                  LEFT JOIN ingredients ing ON ing.id = rvi.ingredient_id LEFT JOIN packaging_items pk ON pk.id = rvi.packaging_id
                 WHERE po.supplier_id = $1 AND po.order_date BETWEEN $2::date AND $3::date AND rvi.kind = 'receive'
                   AND rvi.po_unit_price > 0 AND rvi.unit_price > rvi.po_unit_price * 1.001 ORDER BY increase_pct DESC LIMIT 20`, [p.supplierId, p.from, p.to]),
      db.query(`SELECT i.invoice_number, i.invoice_date, i.total_amount, i.status,
                       (SELECT string_agg(h.hold_code, ', ') FROM invoice_holds h WHERE h.invoice_id = i.id AND h.blocks_payment AND h.released_at IS NULL) AS holds
                  FROM invoices i WHERE i.supplier_id = $1 AND i.invoice_type = 'received' AND i.invoice_date BETWEEN $2::date AND $3::date
                   AND (i.status = 'disputed' OR EXISTS (SELECT 1 FROM invoice_holds h WHERE h.invoice_id = i.id AND h.blocks_payment AND h.released_at IS NULL))
                 ORDER BY i.invoice_date DESC LIMIT 20`, [p.supplierId, p.from, p.to]),
    ]);
    return { late: late.rows, nonconform: nonconform.rows, increases: increases.rows, disputed: disputed.rows };
  },

  async history(supplierId: string) {
    const r = await db.query(`SELECT * FROM supplier_score_snapshots WHERE supplier_id = $1 ORDER BY period_to DESC LIMIT 24`, [supplierId]);
    return r.rows;
  },

  /** Fige la note de la période pour tous les fournisseurs notés (remplace un instantané identique). */
  async snapshot(p: { from: string; to: string; storeId?: string; userId: string; note?: string | null }) {
    const { rows, weights } = await this.board(p);
    let n = 0;
    for (const r of rows) {
      await db.query(
        `INSERT INTO supplier_score_snapshots (supplier_id, period_from, period_to, score, standing, metrics, weights, note, computed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (supplier_id, period_from, period_to) DO UPDATE SET score = EXCLUDED.score, standing = EXCLUDED.standing,
           metrics = EXCLUDED.metrics, weights = EXCLUDED.weights, note = EXCLUDED.note, computed_by = EXCLUDED.computed_by, computed_at = now()`,
        [r.supplier_id, p.from, p.to, r.score, r.standing,
         JSON.stringify({ orders: r.orders, on_time: r.on_time, fill_rate: r.fill_rate, quality: r.quality, price: r.price, disputes: r.disputes, parts: r.parts }),
         JSON.stringify(weights), p.note ?? null, p.userId],
      );
      n++;
    }
    return n;
  },

  /** Dernière note connue par fournisseur (instantané le plus récent), pour les badges. */
  async latest() {
    const r = await db.query(`SELECT DISTINCT ON (supplier_id) supplier_id, score, standing, period_to FROM supplier_score_snapshots ORDER BY supplier_id, period_to DESC`);
    return r.rows;
  },
};
