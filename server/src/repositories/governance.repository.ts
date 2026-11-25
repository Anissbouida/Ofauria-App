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

  /**
   * Délégations réunies (refonte Utilisateurs, lot 5) : rôle complet (role_delegations, posées par
   * l'administrateur) et approbations seulement (approval_delegations, posées par la personne
   * depuis Approbations ou par l'administrateur). Statut : en cours, programmée ou terminée.
   */
  async listAllDelegations() {
    const role = (await this.listDelegations()).map(d => ({
      kind: 'role' as const, id: String(d.id), from_user_id: d.from_user_id, to_user_id: d.to_user_id,
      from_name: d.from_name, to_name: d.to_name, role_code: d.role_code as string | null, role_label: d.role_label as string | null,
      reason: d.reason ?? null, starts_at: d.starts_at, ends_at: d.ends_at,
      status: d.active ? 'active' : new Date(d.starts_at).getTime() > Date.now() ? 'scheduled' : 'ended',
    }));
    const hasApprovals = (await db.query(`SELECT to_regclass('public.approval_delegations') IS NOT NULL AS ok`)).rows[0]?.ok;
    if (!hasApprovals) return role;
    const hasReason = (await db.query(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'approval_delegations' AND column_name = 'reason') AS ok`)).rows[0]?.ok;
    const approvals = (await db.query(
      `SELECT d.id::text, d.from_user_id, d.to_user_id, ${hasReason ? 'd.reason' : 'NULL::text AS reason'},
              d.starts_on, d.ends_on,
              concat_ws(' ', fu.first_name, fu.last_name) AS from_name,
              concat_ws(' ', tu.first_name, tu.last_name) AS to_name,
              CASE WHEN CURRENT_DATE BETWEEN d.starts_on AND d.ends_on THEN 'active'
                   WHEN d.starts_on > CURRENT_DATE THEN 'scheduled' ELSE 'ended' END AS status
         FROM approval_delegations d
         JOIN users fu ON fu.id = d.from_user_id
         JOIN users tu ON tu.id = d.to_user_id
        ORDER BY d.ends_on DESC`)).rows.map(d => ({
      kind: 'approvals' as const, id: d.id as string, from_user_id: d.from_user_id, to_user_id: d.to_user_id,
      from_name: d.from_name, to_name: d.to_name, role_code: null, role_label: null,
      reason: d.reason ?? null, starts_at: d.starts_on, ends_at: d.ends_on, status: d.status as string,
    }));
    return [...role, ...approvals].sort((a, b) => new Date(b.ends_at).getTime() - new Date(a.ends_at).getTime());
  },
  async createApprovalDelegation(d: { fromUserId: string; toUserId: string; startsOn?: string; endsOn: string; reason?: string | null }, actorId?: string) {
    const r = await auditedQuery(actorId,
      `INSERT INTO approval_delegations (from_user_id, to_user_id, starts_on, ends_on, created_by, reason)
       VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4::date, $5, $6) RETURNING *`,
      [d.fromUserId, d.toUserId, d.startsOn ?? null, d.endsOn, actorId ?? null, d.reason ?? null]);
    return r.rows[0];
  },
  async removeApprovalDelegation(id: string, actorId?: string) {
    await auditedQuery(actorId, `DELETE FROM approval_delegations WHERE id = $1`, [id]);
  },
  /** Prolonger ou raccourcir : nouvelle date de fin (toujours après le début). */
  async extendDelegation(kind: 'role' | 'approvals', id: string, endsAt: string, actorId?: string) {
    const r = kind === 'role'
      ? await auditedQuery(actorId, `UPDATE role_delegations SET ends_at = $2 WHERE id = $1 AND $2::timestamptz > starts_at RETURNING id`, [Number(id), endsAt])
      : await auditedQuery(actorId, `UPDATE approval_delegations SET ends_on = $2::date WHERE id = $1 AND $2::date >= starts_on RETURNING id`, [id, endsAt]);
    return (r.rowCount ?? 0) > 0;
  },

  // ─── Séparation des tâches sur les pièces (mig 442) ─────────────────
  async documentSod() {
    const ready = (await db.query(`SELECT to_regclass('public.sod_document_rules') IS NOT NULL AS ok`)).rows[0]?.ok;
    const mode = (await db.query(`SELECT value->>'mode' AS m FROM module_parameters WHERE key = 'purchasing.sod_mode'`)).rows[0]?.m ?? 'warn';
    if (!ready) return { mode, rules: [], violations: [], overridesThisMonth: 0 };
    const rules = (await db.query(`SELECT code, action, forbidden, label, is_active FROM sod_document_rules ORDER BY code`)).rows;
    const violations = (await db.query(
      `SELECT v.rule_code, v.actor_id, COALESCE(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email, v.actor_id::text) AS actor,
              count(*)::int AS occurrences, count(DISTINCT v.doc_id)::int AS documents, max(v.occurred_at) AS last_at
         FROM sod_violations v LEFT JOIN users u ON u.id = v.actor_id
        WHERE v.occurred_at >= now() - INTERVAL '90 days'
        GROUP BY v.rule_code, v.actor_id, actor ORDER BY max(v.occurred_at) DESC LIMIT 50`)).rows;
    const overridesThisMonth = Number((await db.query(
      `SELECT count(*)::int AS n FROM sod_overrides WHERE created_at >= date_trunc('month', now())`)).rows[0]?.n ?? 0);
    return { mode, rules, violations, overridesThisMonth };
  },
  async setDocumentSodRule(code: string, isActive: boolean, actorId?: string) {
    const r = await auditedQuery(actorId, `UPDATE sod_document_rules SET is_active = $2 WHERE code = $1 RETURNING code`, [code, isActive]);
    return (r.rowCount ?? 0) > 0;
  },

  /** Circuits d'approbation par type de pièce, avec leurs approbateurs (plafonds, lot 5). */
  async circuitsByDocType(): Promise<Map<string, { code: string; label: string; enabled: boolean; approvers: string[] }[]>> {
    const out = new Map<string, { code: string; label: string; enabled: boolean; approvers: string[] }[]>();
    if (!(await db.query(`SELECT to_regclass('public.approval_rules') IS NOT NULL AS ok`)).rows[0]?.ok) return out;
    const rows = (await db.query(
      `SELECT r.doc_type, r.code, r.label, r.enabled,
              array_remove(array_agg(COALESCE(ro.label, nullif(concat_ws(' ', u.first_name, u.last_name), '')) ORDER BY s.step_order), NULL) AS approvers
         FROM approval_rules r
         LEFT JOIN approval_rule_steps s ON s.rule_id = r.id
         LEFT JOIN roles ro ON ro.code = s.approver_role
         LEFT JOIN users u ON u.id = s.approver_user_id
        GROUP BY r.id, r.doc_type, r.code, r.label, r.enabled, r.display_order
        ORDER BY r.display_order NULLS LAST, r.label`)).rows;
    for (const r of rows) out.set(r.doc_type, [...(out.get(r.doc_type) ?? []), { code: r.code, label: r.label, enabled: !!r.enabled, approvers: r.approvers ?? [] }]);
    return out;
  },

  // ─── Mode de contrôle SoD ───────────────────────────────────────────
  async setSodMode(mode: string, actorId?: string) {
    await auditedQuery(actorId, `UPDATE company_settings SET sod_enforcement = $1, updated_at = now() WHERE id = 1`, [mode]);
  },
};
