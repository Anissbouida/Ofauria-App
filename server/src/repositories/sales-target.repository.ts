import { db } from '../config/database.js';

/**
 * Phase 11 (D3-13) — objectifs par commercial.
 *
 * Objectif de CA par vendeur et par période ; le réalisé se lit sur les
 * factures émises attribuées au vendeur (invoices.salesperson_id), net des
 * avoirs. Le rapport croise objectif et réalisé sur une période donnée.
 */

export interface TargetInput {
  salespersonId: string;
  periodStart: string;
  periodEnd: string;
  targetAmount: number;
  createdBy?: string | null;
}

export const salesTargetRepository = {
  /** Pose/met à jour l'objectif d'un vendeur pour une période (clé unique). */
  async upsert(input: TargetInput) {
    if (!(Number(input.targetAmount) >= 0)) return { error: 'Montant invalide' };
    const row = (await db.query(
      `INSERT INTO sales_targets (salesperson_id, period_start, period_end, target_amount, created_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (salesperson_id, period_start, period_end)
       DO UPDATE SET target_amount = EXCLUDED.target_amount, updated_at = now()
       RETURNING *`,
      [input.salespersonId, input.periodStart, input.periodEnd, input.targetAmount, input.createdBy ?? null])).rows[0];
    return { data: row };
  },

  async remove(id: string) {
    await db.query(`DELETE FROM sales_targets WHERE id = $1`, [id]);
  },

  /**
   * Rapport objectif / réalisé pour une période : une ligne par vendeur ayant
   * un objectif OU du réalisé sur la période. Réalisé net des avoirs.
   */
  async report(periodStart: string, periodEnd: string) {
    const rows = (await db.query(
      `WITH sp AS (
         SELECT salesperson_id AS id FROM sales_targets
          WHERE period_start = $1 AND period_end = $2
         UNION
         SELECT salesperson_id FROM invoices
          WHERE invoice_type = 'emitted' AND salesperson_id IS NOT NULL
            AND invoice_date BETWEEN $1 AND $2
       )
       SELECT u.id AS salesperson_id, u.first_name, u.last_name,
              COALESCE(t.id::text, '') AS target_id,
              COALESCE(t.target_amount, 0)::numeric AS target_amount,
              COALESCE((
                SELECT SUM(CASE WHEN i.kind = 'credit_note' THEN -i.total_amount ELSE i.total_amount END)
                  FROM invoices i
                 WHERE i.invoice_type = 'emitted' AND i.status <> 'cancelled'
                   AND i.salesperson_id = u.id AND i.invoice_date BETWEEN $1 AND $2
              ), 0)::numeric AS realized
         FROM sp JOIN users u ON u.id = sp.id
         LEFT JOIN sales_targets t ON t.salesperson_id = u.id AND t.period_start = $1 AND t.period_end = $2
        WHERE sp.id IS NOT NULL
        ORDER BY realized DESC, u.last_name`, [periodStart, periodEnd])).rows;
    return rows.map((r: Record<string, unknown>) => {
      const target = Math.round(Number(r.target_amount) * 100) / 100;
      const realized = Math.round(Number(r.realized) * 100) / 100;
      return {
        salespersonId: r.salesperson_id,
        name: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim(),
        targetId: (r.target_id as string) || null,
        target, realized,
        gap: Math.round((realized - target) * 100) / 100,
        pct: target > 0 ? Math.round((realized / target) * 100) : null,
      };
    });
  },
};
