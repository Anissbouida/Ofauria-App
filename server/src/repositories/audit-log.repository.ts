import { db } from '../config/database.js';

export interface AuditLogFilters {
  table?: string;        // nom de table, ou 'referentiel' pour toutes les tables de valeurs
  changedBy?: string;
  subjectId?: string;
  from?: string;         // AAAA-MM-JJ inclus
  to?: string;           // AAAA-MM-JJ inclus
  q?: string;
  limit: number;
  offset: number;
}

/**
 * Vue unifiée : journal du paramétrage (config_audit_log, mig 328) + historique
 * du référentiel (ref_audit_log, mig 058). Le libellé de la ligne concernée est
 * lu dans la ligne journalisée (nom du magasin, de l'imprimante…) pour rester
 * lisible même après suppression.
 */
const UNIFIED = `
  SELECT 'c' || cal.id::text AS id, cal.table_name, cal.operation, cal.record_id, cal.subject_id,
         cal.changed_by, cal.changed_at, cal.diff, cal.old_row, cal.new_row,
         CASE cal.table_name
           WHEN 'stores'             THEN COALESCE(cal.new_row, cal.old_row) ->> 'name'
           WHEN 'users'              THEN concat_ws(' ', COALESCE(cal.new_row, cal.old_row) ->> 'first_name', COALESCE(cal.new_row, cal.old_row) ->> 'last_name')
           WHEN 'user_permissions'   THEN cal.record_id
           WHEN 'printer_configs'    THEN COALESCE(cal.new_row, cal.old_row) ->> 'name'
           WHEN 'sales_channels'     THEN COALESCE(cal.new_row, cal.old_row) ->> 'label'
           WHEN 'public_holidays'    THEN concat_ws(' · ', cal.record_id, COALESCE(cal.new_row, cal.old_row) ->> 'label')
           WHEN 'payroll_tax_scales' THEN COALESCE(cal.new_row, cal.old_row) ->> 'label'
           WHEN 'tax_codes'          THEN concat_ws(' · ', COALESCE(cal.new_row, cal.old_row) ->> 'code', COALESCE(cal.new_row, cal.old_row) ->> 'label')
           WHEN 'module_parameters'  THEN cal.record_id
           WHEN 'roles'              THEN COALESCE(cal.new_row, cal.old_row) ->> 'label'
           WHEN 'role_permissions'   THEN cal.record_id
           WHEN 'document_sequences' THEN COALESCE(cal.new_row, cal.old_row) ->> 'label'
           WHEN 'company_bank_accounts' THEN COALESCE(cal.new_row, cal.old_row) ->> 'label'
           WHEN 'document_templates' THEN COALESCE(cal.new_row, cal.old_row) ->> 'label'
           WHEN 'notification_rules' THEN COALESCE(cal.new_row, cal.old_row) ->> 'label'
           ELSE NULL
         END AS record_label
    FROM config_audit_log cal
  UNION ALL
  SELECT 'r' || ral.id::text, 'ref:' || ral.table_id,
         CASE ral.action WHEN 'create' THEN 'INSERT' WHEN 'delete' THEN 'DELETE' ELSE 'UPDATE' END,
         ral.entry_id, NULL, ral.user_id, ral.created_at,
         CASE WHEN ral.action IN ('create', 'delete') THEN NULL ELSE ral.changes END,
         CASE WHEN ral.action = 'delete' THEN ral.changes END,
         CASE WHEN ral.action = 'create' THEN ral.changes END,
         concat_ws(' · ', COALESCE(rt.label, ral.table_id),
                   CASE ral.action WHEN 'deactivate' THEN 'désactivation' WHEN 'reactivate' THEN 'réactivation' END)
    FROM ref_audit_log ral
    LEFT JOIN ref_tables rt ON rt.id = ral.table_id
`;

export const auditLogRepository = {
  async list(f: AuditLogFilters) {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };

    if (f.table === 'referentiel') where.push(`u.table_name LIKE 'ref:%'`);
    else if (f.table) add('u.table_name = ?', f.table);
    if (f.changedBy) add('u.changed_by = ?::uuid', f.changedBy);
    if (f.subjectId) add('u.subject_id = ?', f.subjectId);
    if (f.from) add(`u.changed_at >= ?::date`, f.from);
    if (f.to) add(`u.changed_at < (?::date + 1)`, f.to);
    if (f.q) add(`(u.record_label ILIKE '%' || ? || '%' OR u.diff::text ILIKE '%' || $${params.length + 1} || '%')`, f.q);

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sql = `
      WITH u AS (${UNIFIED})
      SELECT u.*, count(*) OVER () AS total,
             concat_ws(' ', a.first_name, a.last_name) AS changed_by_name,
             concat_ws(' ', s.first_name, s.last_name) AS subject_name
        FROM u
        LEFT JOIN users a ON a.id = u.changed_by
        LEFT JOIN users s ON u.table_name IN ('users', 'user_permissions') AND s.id::text = u.subject_id
        ${whereSql}
       ORDER BY u.changed_at DESC, u.id DESC
       LIMIT ${Math.trunc(f.limit)} OFFSET ${Math.trunc(f.offset)}`;
    const r = await db.query(sql, params);
    return { rows: r.rows, total: r.rows.length ? Number(r.rows[0].total) : 0 };
  },

  /** Tables présentes dans le journal (pour le filtre). */
  async tables(): Promise<string[]> {
    const r = await db.query(`SELECT DISTINCT table_name FROM config_audit_log ORDER BY 1`);
    return r.rows.map((x: { table_name: string }) => x.table_name);
  },

  async authEvents(f: { eventType?: string; userId?: string; success?: boolean; from?: string; to?: string; limit: number; offset: number }) {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
    if (f.eventType) add('e.event_type = ?', f.eventType);
    if (f.userId) add('(e.user_id = ?::uuid OR e.target_user_id = $' + (params.length + 1) + '::uuid)', f.userId);
    if (f.success !== undefined) add('e.success = ?', f.success);
    if (f.from) add('e.created_at >= ?::date', f.from);
    if (f.to) add('e.created_at < (?::date + 1)', f.to);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const r = await db.query(
      `SELECT e.id, e.event_type, e.user_id, e.target_user_id, e.email, host(e.ip) AS ip,
              e.user_agent, e.success, e.details, e.created_at,
              concat_ws(' ', u.first_name, u.last_name) AS user_name,
              concat_ws(' ', t.first_name, t.last_name) AS target_name,
              count(*) OVER () AS total
         FROM auth_events e
         LEFT JOIN users u ON u.id = e.user_id
         LEFT JOIN users t ON t.id = e.target_user_id
         ${whereSql}
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT ${Math.trunc(f.limit)} OFFSET ${Math.trunc(f.offset)}`,
      params,
    );
    return { rows: r.rows, total: r.rows.length ? Number(r.rows[0].total) : 0 };
  },
};
