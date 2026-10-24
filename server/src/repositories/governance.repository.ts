import { db } from '../config/database.js';
import { auditedQuery } from '../utils/audit-context.js';

/** Gouvernance : règles SoD, plafonds d'approbation, délégations (mig 336). */
export const governanceRepository = {
  // ─── Séparation des tâches ──────────────────────────────────────────
  async listSodRules() {
    return (await db.query(
      `SELECT id, code, label, description, a_module, a_right, b_module, b_right, severity, is_active, updated_at
         FROM sod_rules ORDER BY is_active DESC, code`)).rows;
  },
  async findSodRule(code: string) {
    return (await db.query(`SELECT * FROM sod_rules WHERE code = $1`, [code])).rows[0] ?? null;
  },
  async createSodRule(d: {
    code: string; label: string; description?: string | null;
    aModule: string; aRight: string; bModule: string; bRight: string; severity: string;
  }, actorId?: string) {
    const r = await auditedQuery(actorId,
      `INSERT INTO sod_rules (code, label, description, a_module, a_right, b_module, b_right, severity, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [d.code, d.label, d.description ?? null, d.aModule, d.aRight, d.bModule, d.bRight, d.severity, actorId ?? null]);
    return r.rows[0];
  },
  async updateSodRule(code: string, d: Partial<{ label: string; description: string | null; severity: string; isActive: boolean }>, actorId?: string) {
    const fields: string[] = []; const values: unknown[] = [code];
    const set = (c: string, v: unknown) => { values.push(v); fields.push(`${c} = $${values.length}`); };
    if (d.label !== undefined) set('label', d.label);
    if (d.description !== undefined) set('description', d.description);
    if (d.severity !== undefined) set('severity', d.severity);
    if (d.isActive !== undefined) set('is_active', d.isActive);
    if (!fields.length) return this.findSodRule(code);
    set('updated_by', actorId ?? null);
    const r = await auditedQuery(actorId,
      `UPDATE sod_rules SET ${fields.join(', ')}, updated_at = now() WHERE code = $1 RETURNING *`, values);
    return r.rows[0] ?? null;
  },
  async removeSodRule(code: string, actorId?: string) {
    await auditedQuery(actorId, `DELETE FROM sod_rules WHERE code = $1`, [code]);
  },

  // ─── Plafonds d'approbation ─────────────────────────────────────────
  async listApprovalLimits() {
    return (await db.query(
      `SELECT al.id, al.role_code, r.label AS role_label, al.document_type, al.max_amount, al.currency, al.updated_at
         FROM approval_limits al JOIN roles r ON r.code = al.role_code
        ORDER BY al.document_type, r.label`)).rows;
  },
  async setApprovalLimit(roleCode: string, documentType: string, maxAmount: number, currency: string, actorId?: string) {
    const r = await auditedQuery(actorId,
      `INSERT INTO approval_limits (role_code, document_type, max_amount, currency, updated_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (role_code, document_type) DO UPDATE SET
         max_amount = EXCLUDED.max_amount, currency = EXCLUDED.currency,
         updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING *`,
      [roleCode, documentType, maxAmount, currency, actorId ?? null]);
    return r.rows[0];
  },
  async removeApprovalLimit(id: number, actorId?: string) {
    await auditedQuery(actorId, `DELETE FROM approval_limits WHERE id = $1`, [id]);
  },

  // ─── Délégations ────────────────────────────────────────────────────
  async listDelegations() {
    return (await db.query(
      `SELECT d.id, d.from_user_id, d.to_user_id, d.role_code, d.reason, d.starts_at, d.ends_at, d.created_at,
              fr.label AS role_label,
              concat_ws(' ', fu.first_name, fu.last_name) AS from_name,
              concat_ws(' ', tu.first_name, tu.last_name) AS to_name,
              (now() BETWEEN d.starts_at AND d.ends_at) AS active
         FROM role_delegations d
         JOIN roles fr ON fr.code = d.role_code
         JOIN users fu ON fu.id = d.from_user_id
         JOIN users tu ON tu.id = d.to_user_id
        ORDER BY d.ends_at DESC`)).rows;
  },
  async createDelegation(d: {
    fromUserId: string; toUserId: string; roleCode: string; reason?: string | null; startsAt?: string; endsAt: string;
  }, actorId?: string) {
    const r = await auditedQuery(actorId,
      `INSERT INTO role_delegations (from_user_id, to_user_id, role_code, reason, starts_at, ends_at, created_by)
       VALUES ($1,$2,$3,$4, COALESCE($5::timestamptz, now()), $6, $7) RETURNING *`,
      [d.fromUserId, d.toUserId, d.roleCode, d.reason ?? null, d.startsAt ?? null, d.endsAt, actorId ?? null]);
    return r.rows[0];
  },
  async removeDelegation(id: number, actorId?: string) {
    await auditedQuery(actorId, `DELETE FROM role_delegations WHERE id = $1`, [id]);
  },

  // ─── Mode de contrôle SoD ───────────────────────────────────────────
  async setSodMode(mode: string, actorId?: string) {
    await auditedQuery(actorId, `UPDATE company_settings SET sod_enforcement = $1, updated_at = now() WHERE id = 1`, [mode]);
  },
};
