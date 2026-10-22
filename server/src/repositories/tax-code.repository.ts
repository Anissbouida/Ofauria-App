import { db } from '../config/database.js';
import { setAuditUser, auditedQuery } from '../utils/audit-context.js';

/** Codes de TVA datés (mig 309 / 331). Un taux ne se modifie pas : on ouvre une nouvelle période. */
export const taxCodeRepository = {
  async available(): Promise<boolean> {
    return (await db.query(`SELECT to_regclass('public.tax_codes') IS NOT NULL AS ok`)).rows[0].ok as boolean;
  },

  async list(country: string) {
    const r = await db.query(
      `SELECT t.*,
              CASE WHEN t.valid_from > CURRENT_DATE THEN 'future'
                   WHEN t.valid_to IS NOT NULL AND t.valid_to < CURRENT_DATE THEN 'past'
                   ELSE 'current' END AS status
         FROM tax_codes t
        WHERE t.country_code = $1
        ORDER BY t.code, t.valid_from DESC`, [country]);
    return r.rows;
  },

  /**
   * Nouveau taux pour un code à partir d'une date. La période ouverte du même
   * code est close la veille ; un code nouveau est simplement créé.
   */
  async addRate(data: {
    country: string; code: string; label: string; rate: number; kind: string; recoverable: boolean;
    validFrom: string; legalRef: string | null;
  }, actorId?: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setAuditUser(client, actorId);
      await client.query(
        `UPDATE tax_codes SET valid_to = $3::date - 1
          WHERE country_code = $1 AND code = $2 AND valid_from < $3::date
            AND (valid_to IS NULL OR valid_to >= $3::date)`,
        [data.country, data.code, data.validFrom]);
      const r = await client.query(
        `INSERT INTO tax_codes (country_code, code, label, rate, kind, recoverable, valid_from, legal_ref)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [data.country, data.code, data.label, data.rate, data.kind, data.recoverable, data.validFrom, data.legalRef]);
      await client.query('COMMIT');
      return r.rows[0];
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },

  /** Libellé, référence légale et fin de validité seulement : le taux et la date d'effet sont figés. */
  async update(id: string, data: { label?: string; legalRef?: string | null; validTo?: string | null }, actorId?: string) {
    const sets: string[] = [];
    const vals: unknown[] = [id];
    if (data.label !== undefined) { vals.push(data.label); sets.push(`label = $${vals.length}`); }
    if (data.legalRef !== undefined) { vals.push(data.legalRef); sets.push(`legal_ref = $${vals.length}`); }
    if (data.validTo !== undefined) { vals.push(data.validTo); sets.push(`valid_to = $${vals.length}::date`); }
    if (!sets.length) return (await db.query(`SELECT * FROM tax_codes WHERE id = $1`, [id])).rows[0] ?? null;
    const r = await auditedQuery(actorId, `UPDATE tax_codes SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals);
    return r.rows[0] ?? null;
  },
};
