import { db } from '../config/database.js';
import type { OfflineAbandonedInput } from '../validators/pos-offline.validator.js';

/**
 * Journal des ventes hors ligne abandonnées (G0-21, mig 596).
 * Écriture idempotente par clé : une caisse qui renvoie le même abandon (réseau coupé
 * pendant la réponse) retrouve la ligne déjà enregistrée, sans doublon.
 */
export const posOfflineAbandonedRepository = {
  async record(d: OfflineAbandonedInput, by: { userId: string; storeId?: string | null }) {
    const inserted = await db.query(
      `INSERT INTO pos_offline_abandoned_sales
         (idempotency_key, store_id, abandoned_by, queued_at, rejected_at, abandoned_at, total, summary,
          reject_reason, reject_status, reject_code, abandon_reason, payload, sale_id)
       VALUES ($1::text, $2, $3, $4::timestamptz, $5::timestamptz, $6::timestamptz, $7::numeric, $8,
               $9, $10, $11, $12, $13::jsonb, (SELECT id FROM sales WHERE idempotency_key = $1::text LIMIT 1))
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [d.idempotencyKey, by.storeId ?? null, by.userId, d.queuedAt || null, d.rejectedAt || null, d.abandonedAt,
       d.total == null ? null : Math.round(d.total * 100) / 100, d.summary || null,
       d.rejectReason, d.rejectStatus ?? null, d.rejectCode || null, d.abandonReason, JSON.stringify(d.payload)]);
    if (inserted.rows[0]) return { row: inserted.rows[0], created: true };
    const existing = await db.query(`SELECT * FROM pos_offline_abandoned_sales WHERE idempotency_key = $1`, [d.idempotencyKey]);
    return { row: existing.rows[0], created: false };
  },

  /** Consultation direction : par magasin (celui de l'utilisateur s'il en a un), période sur la date d'abandon. */
  async list(f: { storeId?: string | null; dateFrom?: string; dateTo?: string; limit?: number }) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (f.storeId) { params.push(f.storeId); where.push(`a.store_id = $${params.length}`); }
    if (f.dateFrom) { params.push(f.dateFrom); where.push(`a.abandoned_at >= $${params.length}::date`); }
    if (f.dateTo) { params.push(f.dateTo); where.push(`a.abandoned_at < $${params.length}::date + 1`); }
    params.push(Math.min(Math.max(f.limit ?? 200, 1), 500));
    const r = await db.query(
      `SELECT a.id, a.idempotency_key, a.store_id, s.name AS store_name, a.abandoned_by,
              concat_ws(' ', u.first_name, u.last_name) AS abandoned_by_name,
              a.queued_at, a.rejected_at, a.abandoned_at, a.total, a.summary,
              a.reject_reason, a.reject_status, a.reject_code, a.abandon_reason, a.payload,
              a.sale_id, sa.sale_number, a.created_at
         FROM pos_offline_abandoned_sales a
         LEFT JOIN stores s ON s.id = a.store_id
         LEFT JOIN users u ON u.id = a.abandoned_by
         LEFT JOIN sales sa ON sa.id = a.sale_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY a.abandoned_at DESC
        LIMIT $${params.length}`, params);
    return r.rows;
  },
};
