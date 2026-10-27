import { db } from '../config/database.js';
import { nextDocumentNumber } from '../utils/document-number.js';

/**
 * Projets (mig 358) : projets, tâches, temps passé. Module générique : client et
 * commande optionnels ; le coût et le facturable se lisent sur les lignes de temps,
 * qui figent le coût horaire de la personne et le taux facturé au client.
 */

export type ProjectStatus = 'draft' | 'active' | 'on_hold' | 'completed' | 'cancelled';
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';
export type Priority = 'low' | 'normal' | 'high' | 'critical';
export type BillingType = 'none' | 'fixed' | 'time';

const NAME = (a: string) => `${a}.first_name || ' ' || ${a}.last_name`;

/** Coût horaire d'un salarié : taux horaire, sinon mensuel / 208 h, sinon hebdo / 48 h. */
const EMPLOYEE_COST_RATE = `COALESCE(e.hourly_rate, e.monthly_salary / 208.0, e.weekly_salary / 48.0, 0)`;

/** Agrégats de temps par projet (heures, coût, facturable, non facturé). */
const TIME_AGG = `
  SELECT t.project_id,
         COALESCE(SUM(t.hours), 0) AS hours,
         COALESCE(SUM(t.hours * t.cost_rate), 0) AS cost,
         COALESCE(SUM(t.hours * t.billing_rate) FILTER (WHERE t.billable), 0) AS billable_amount,
         COALESCE(SUM(t.hours * t.billing_rate) FILTER (WHERE t.billable AND t.invoice_id IS NULL), 0) AS unbilled_amount,
         COALESCE(SUM(t.hours) FILTER (WHERE t.billable AND t.invoice_id IS NULL), 0) AS unbilled_hours
    FROM project_time_entries t GROUP BY t.project_id`;

const SELECT = `
  SELECT p.*,
         COALESCE(NULLIF(btrim(COALESCE(cu.company_name, '')), ''),
                  NULLIF(btrim(COALESCE(cu.first_name, '') || ' ' || COALESCE(cu.last_name, '')), '')) AS customer_label,
         o.order_number,
         ${NAME('m')} AS manager_name,
         ${NAME('cb')} AS created_by_name,
         COALESCE(ta.hours, 0) AS hours_spent,
         COALESCE(ta.cost, 0) AS cost_spent,
         COALESCE(ta.billable_amount, 0) AS billable_amount,
         COALESCE(ta.unbilled_amount, 0) AS unbilled_amount,
         COALESCE(ta.unbilled_hours, 0) AS unbilled_hours,
         COALESCE(tk.total, 0)::int AS task_count,
         COALESCE(tk.done, 0)::int AS task_done,
         COALESCE(tk.late, 0)::int AS task_late,
         (p.status IN ('active', 'on_hold') AND p.due_date IS NOT NULL AND p.due_date < CURRENT_DATE) AS is_overdue
    FROM projects p
    LEFT JOIN customers cu ON cu.id = p.customer_id
    LEFT JOIN orders o ON o.id = p.order_id
    LEFT JOIN users m ON m.id = p.manager_id
    LEFT JOIN users cb ON cb.id = p.created_by
    LEFT JOIN (${TIME_AGG}) ta ON ta.project_id = p.id
    LEFT JOIN (
      SELECT project_id, COUNT(*) FILTER (WHERE status <> 'cancelled') AS total,
             COUNT(*) FILTER (WHERE status = 'done') AS done,
             COUNT(*) FILTER (WHERE status IN ('todo', 'in_progress') AND due_date < CURRENT_DATE) AS late
        FROM project_tasks GROUP BY project_id
    ) tk ON tk.project_id = p.id`;

const TASK_SELECT = `
  SELECT t.*, ${NAME('e')} AS assignee_name, e.role AS assignee_role,
         COALESCE(th.hours, 0) AS hours_spent,
         (t.status IN ('todo', 'in_progress') AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE) AS is_overdue
    FROM project_tasks t
    LEFT JOIN employees e ON e.id = t.assignee_id
    LEFT JOIN (SELECT task_id, SUM(hours) AS hours FROM project_time_entries WHERE task_id IS NOT NULL GROUP BY task_id) th ON th.task_id = t.id`;

const TIME_SELECT = `
  SELECT t.*, ${NAME('e')} AS employee_name, e.role AS employee_role, tk.title AS task_title,
         p.number AS project_number, p.name AS project_name,
         re.label AS activity_label,
         ROUND(t.hours * t.cost_rate, 2) AS cost, ROUND(t.hours * t.billing_rate, 2) AS amount
    FROM project_time_entries t
    JOIN employees e ON e.id = t.employee_id
    JOIN projects p ON p.id = t.project_id
    LEFT JOIN project_tasks tk ON tk.id = t.task_id
    LEFT JOIN ref_entries re ON re.table_id = 'project_activity_types' AND re.code = t.activity_code`;

export type ProjectInput = {
  name: string; description?: string | null; customerId?: string | null; orderId?: string | null;
  priority?: Priority; startDate?: string | null; dueDate?: string | null; managerId?: string | null;
  billingType?: BillingType; hourlyRate?: number | null; budgetAmount?: number | null; estimatedHours?: number | null;
  notes?: string | null;
};
export type TaskInput = {
  title: string; description?: string | null; parentTaskId?: string | null; priority?: Priority;
  assigneeId?: string | null; startDate?: string | null; dueDate?: string | null; estimatedHours?: number | null;
  displayOrder?: number;
};
export type TimeInput = {
  projectId: string; taskId?: string | null; employeeId: string; workDate: string; hours: number;
  activityCode?: string | null; note?: string | null; billable?: boolean; billingRate?: number | null;
};

const PROJECT_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  draft: ['active', 'cancelled'],
  active: ['on_hold', 'completed', 'cancelled'],
  on_hold: ['active', 'cancelled'],
  completed: ['active'],
  cancelled: ['draft'],
};

function storeCond(storeId: string | undefined, col: string, add: (v: unknown) => string) {
  return storeId ? `(${col} IS NULL OR ${col} = ${add(storeId)}::uuid)` : 'true';
}

export const projectRepository = {
  /* ─── Projets ─────────────────────────────────────────────────────────── */
  async create(input: ProjectInput, ctx: { userId: string; storeId: string | null }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const number = await nextDocumentNumber(client, 'project');
      const r = await client.query(
        `INSERT INTO projects (number, name, description, store_id, customer_id, order_id, priority, start_date, due_date, manager_id,
                               billing_type, hourly_rate, budget_amount, estimated_hours, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
        [number, input.name.trim(), input.description?.trim() || null, ctx.storeId, input.customerId ?? null, input.orderId ?? null,
         input.priority ?? 'normal', input.startDate ?? null, input.dueDate ?? null, input.managerId ?? ctx.userId,
         input.billingType ?? 'none', input.hourlyRate ?? null, input.budgetAmount ?? null, input.estimatedHours ?? null,
         input.notes?.trim() || null, ctx.userId],
      );
      await client.query('COMMIT');
      return this.findById(r.rows[0].id);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async findById(id: string) {
    const r = await db.query(`${SELECT} WHERE p.id = $1`, [id]);
    return r.rows[0] ?? null;
  },

  async list(p: { status?: ProjectStatus; customerId?: string; managerId?: string; search?: string; storeId?: string; limit: number; offset: number }) {
    const values: unknown[] = [];
    const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
    const base = [storeCond(p.storeId, 'p.store_id', add)];
    if (p.customerId) base.push(`p.customer_id = ${add(p.customerId)}::uuid`);
    if (p.managerId) base.push(`p.manager_id = ${add(p.managerId)}::uuid`);
    if (p.search) {
      const s = add(`%${p.search}%`);
      base.push(`(p.number ILIKE ${s} OR p.name ILIKE ${s} OR EXISTS (
                   SELECT 1 FROM customers cu2 WHERE cu2.id = p.customer_id
                      AND (cu2.company_name ILIKE ${s} OR (COALESCE(cu2.first_name, '') || ' ' || COALESCE(cu2.last_name, '')) ILIKE ${s})))`);
    }
    const baseWhere = base.join(' AND ');
    const nBase = values.length;
    const cond = [...base];
    if (p.status) cond.push(`p.status = ${add(p.status)}`);
    const nCond = values.length;
    const lim = add(p.limit); const off = add(p.offset);
    const [rows, total, counts] = await Promise.all([
      db.query(`${SELECT} WHERE ${cond.join(' AND ')}
                ORDER BY (p.status IN ('active', 'on_hold', 'draft')) DESC, p.due_date NULLS LAST, p.created_at DESC
                LIMIT ${lim} OFFSET ${off}`, values),
      db.query(`SELECT COUNT(*)::int AS n FROM projects p WHERE ${cond.join(' AND ')}`, values.slice(0, nCond)),
      db.query(`SELECT p.status, COUNT(*)::int AS count,
                       COUNT(*) FILTER (WHERE p.status IN ('active', 'on_hold') AND p.due_date < CURRENT_DATE)::int AS overdue
                  FROM projects p WHERE ${baseWhere} GROUP BY p.status`, values.slice(0, nBase)),
    ]);
    const byStatus: Record<string, { count: number; overdue: number }> = {};
    for (const r of counts.rows) byStatus[r.status] = { count: r.count, overdue: r.overdue };
    return { rows: rows.rows, total: total.rows[0].n as number, byStatus };
  },

  async update(id: string, patch: Partial<ProjectInput>, _userId: string) {
    const cols: Record<string, unknown> = {
      name: patch.name?.trim(), description: patch.description?.trim() ?? patch.description, customer_id: patch.customerId,
      order_id: patch.orderId, priority: patch.priority, start_date: patch.startDate, due_date: patch.dueDate,
      manager_id: patch.managerId, billing_type: patch.billingType, hourly_rate: patch.hourlyRate,
      budget_amount: patch.budgetAmount, estimated_hours: patch.estimatedHours, notes: patch.notes?.trim() ?? patch.notes,
    };
    const sets: string[] = []; const values: unknown[] = [];
    for (const [k, v] of Object.entries(cols)) { if (v === undefined) continue; values.push(v); sets.push(`${k} = $${values.length}`); }
    if (!sets.length) return this.findById(id);
    values.push(id);
    const r = await db.query(`UPDATE projects SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING id`, values);
    return r.rows[0] ? this.findById(id) : null;
  },

  async setStatus(id: string, to: ProjectStatus) {
    const cur = await db.query(`SELECT status FROM projects WHERE id = $1`, [id]);
    const from = cur.rows[0]?.status as ProjectStatus | undefined;
    if (!from) return { error: 'not_found' as const };
    if (!PROJECT_TRANSITIONS[from].includes(to)) return { error: 'transition' as const, from };
    await db.query(
      `UPDATE projects SET status = $2::text, completed_at = CASE WHEN $2::text = 'completed' THEN now() ELSE NULL END WHERE id = $1`,
      [id, to],
    );
    return { data: await this.findById(id) };
  },

  /* ─── Tâches ──────────────────────────────────────────────────────────── */
  async listTasks(projectId: string) {
    const r = await db.query(`${TASK_SELECT} WHERE t.project_id = $1 ORDER BY t.display_order, t.created_at`, [projectId]);
    return r.rows;
  },

  /** Tâches ouvertes tous projets (pour « Mes tâches » et le tableau de bord). */
  async openTasks(p: { assigneeId?: string; storeId?: string; limit: number }) {
    const values: unknown[] = [];
    const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
    const cond = [`t.status IN ('todo', 'in_progress')`, `p.status IN ('draft', 'active')`, storeCond(p.storeId, 'p.store_id', add)];
    if (p.assigneeId) cond.push(`t.assignee_id = ${add(p.assigneeId)}::uuid`);
    const lim = add(p.limit);
    const r = await db.query(
      `SELECT x.*, p.number AS project_number, p.name AS project_name FROM (${TASK_SELECT}) x
         JOIN projects p ON p.id = x.project_id
        WHERE ${cond.join(' AND ').replace(/\bt\./g, 'x.')}
        ORDER BY x.is_overdue DESC, x.due_date NULLS LAST,
                 CASE x.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END
        LIMIT ${lim}`, values);
    return r.rows;
  },

  async createTask(projectId: string, input: TaskInput, userId: string) {
    const r = await db.query(
      `INSERT INTO project_tasks (project_id, parent_task_id, title, description, priority, assignee_id, start_date, due_date, estimated_hours, display_order, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
               COALESCE($10, (SELECT COALESCE(MAX(display_order), 0) + 10 FROM project_tasks WHERE project_id = $1)), $11)
       RETURNING id`,
      [projectId, input.parentTaskId ?? null, input.title.trim(), input.description?.trim() || null, input.priority ?? 'normal',
       input.assigneeId ?? null, input.startDate ?? null, input.dueDate ?? null, input.estimatedHours ?? null, input.displayOrder ?? null, userId],
    );
    if (input.assigneeId) await this.notifyAssignee(r.rows[0].id, input.assigneeId, userId);
    return this.findTask(r.rows[0].id);
  },

  async findTask(id: string) {
    const r = await db.query(`${TASK_SELECT} WHERE t.id = $1`, [id]);
    return r.rows[0] ?? null;
  },

  async updateTask(id: string, patch: Partial<TaskInput> & { status?: TaskStatus }, userId: string) {
    const cur = await db.query(`SELECT assignee_id, status FROM project_tasks WHERE id = $1`, [id]);
    if (!cur.rows[0]) return null;
    const cols: Record<string, unknown> = {
      title: patch.title?.trim(), description: patch.description?.trim() ?? patch.description, parent_task_id: patch.parentTaskId,
      priority: patch.priority, assignee_id: patch.assigneeId, start_date: patch.startDate, due_date: patch.dueDate,
      estimated_hours: patch.estimatedHours, display_order: patch.displayOrder, status: patch.status,
    };
    const sets: string[] = []; const values: unknown[] = [];
    for (const [k, v] of Object.entries(cols)) { if (v === undefined) continue; values.push(v); sets.push(`${k} = $${values.length}`); }
    if (patch.status) sets.push(`completed_at = CASE WHEN '${patch.status}' = 'done' THEN COALESCE(completed_at, now()) ELSE NULL END`);
    if (!sets.length) return this.findTask(id);
    values.push(id);
    await db.query(`UPDATE project_tasks SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
    if (patch.assigneeId && patch.assigneeId !== cur.rows[0].assignee_id) await this.notifyAssignee(id, patch.assigneeId, userId);
    return this.findTask(id);
  },

  async deleteTask(id: string) {
    const r = await db.query(`DELETE FROM project_tasks WHERE id = $1 RETURNING project_id`, [id]);
    return r.rows[0] ?? null;
  },

  /** Prévient la personne affectée si sa fiche salarié est reliée à un compte. */
  async notifyAssignee(taskId: string, employeeId: string, userId: string) {
    const r = await db.query(
      `SELECT e.user_id, t.title, p.number, p.store_id FROM employees e, project_tasks t JOIN projects p ON p.id = t.project_id
        WHERE e.id = $1 AND t.id = $2`, [employeeId, taskId]);
    const row = r.rows[0];
    if (!row?.user_id || row.user_id === userId) return;
    await db.query(
      `INSERT INTO notifications (target_role, target_user_id, store_id, type, title, message, reference_type, reference_id, created_by)
       VALUES ('all', $1, $2, 'project_task_assigned', $3, $4, 'project_task', $5, $6)`,
      [row.user_id, row.store_id, `Tâche affectée · ${row.number}`, row.title, taskId, userId],
    );
  },

  /* ─── Temps ───────────────────────────────────────────────────────────── */
  async addTime(input: TimeInput, userId: string) {
    // Coût horaire de la personne et taux facturé, figés : projet (au temps passé)
    // → sinon taux de l'activité → sinon 0.
    const rates = await db.query(
      `SELECT ${EMPLOYEE_COST_RATE} AS cost_rate,
              (SELECT CASE WHEN p.billing_type = 'time' THEN COALESCE(p.hourly_rate, (re.metadata->>'billing_rate')::numeric, 0) ELSE 0 END
                 FROM projects p LEFT JOIN ref_entries re ON re.table_id = 'project_activity_types' AND re.code = $2
                WHERE p.id = $3) AS billing_rate
         FROM employees e WHERE e.id = $1`,
      [input.employeeId, input.activityCode ?? null, input.projectId],
    );
    if (!rates.rows[0]) return null;
    const r = await db.query(
      `INSERT INTO project_time_entries (project_id, task_id, employee_id, work_date, hours, activity_code, note, billable, cost_rate, billing_rate, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [input.projectId, input.taskId ?? null, input.employeeId, input.workDate, input.hours, input.activityCode ?? null,
       input.note?.trim() || null, input.billable ?? true, Number(rates.rows[0].cost_rate) || 0,
       input.billingRate ?? (Number(rates.rows[0].billing_rate) || 0), userId],
    );
    const t = await db.query(`${TIME_SELECT} WHERE t.id = $1`, [r.rows[0].id]);
    return t.rows[0];
  },

  async listTime(p: { projectId?: string; employeeId?: string; dateFrom?: string; dateTo?: string; unbilledOnly?: boolean; storeId?: string; limit: number; offset: number }) {
    const values: unknown[] = [];
    const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
    const cond = [storeCond(p.storeId, 'p.store_id', add)];
    if (p.projectId) cond.push(`t.project_id = ${add(p.projectId)}::uuid`);
    if (p.employeeId) cond.push(`t.employee_id = ${add(p.employeeId)}::uuid`);
    if (p.dateFrom) cond.push(`t.work_date >= ${add(p.dateFrom)}::date`);
    if (p.dateTo) cond.push(`t.work_date <= ${add(p.dateTo)}::date`);
    if (p.unbilledOnly) cond.push(`t.billable AND t.invoice_id IS NULL`);
    const n = values.length;
    const lim = add(p.limit); const off = add(p.offset);
    const [rows, agg] = await Promise.all([
      db.query(`${TIME_SELECT} WHERE ${cond.join(' AND ')} ORDER BY t.work_date DESC, t.created_at DESC LIMIT ${lim} OFFSET ${off}`, values),
      db.query(`SELECT COUNT(*)::int AS total, COALESCE(SUM(t.hours), 0) AS hours, COALESCE(SUM(t.hours * t.cost_rate), 0) AS cost,
                       COALESCE(SUM(t.hours * t.billing_rate) FILTER (WHERE t.billable), 0) AS amount
                  FROM project_time_entries t JOIN projects p ON p.id = t.project_id WHERE ${cond.join(' AND ')}`, values.slice(0, n)),
    ]);
    return { rows: rows.rows, ...agg.rows[0] };
  },

  async deleteTime(id: string) {
    const r = await db.query(`DELETE FROM project_time_entries WHERE id = $1 AND invoice_id IS NULL RETURNING project_id`, [id]);
    return r.rows[0] ?? null;
  },

  /* ─── Tableau de bord ─────────────────────────────────────────────────── */
  async overview(p: { storeId?: string; dateFrom?: string; dateTo?: string }) {
    // Le filtre magasin est le seul paramètre commun ; la période ne sert qu'aux heures.
    const storeVals: unknown[] = p.storeId ? [p.storeId] : [];
    const store = p.storeId ? `(p.store_id IS NULL OR p.store_id = $1::uuid)` : 'true';
    const periodVals = [...storeVals];
    const period = [
      p.dateFrom ? `t.work_date >= $${periodVals.push(p.dateFrom)}::date` : 'true',
      p.dateTo ? `t.work_date <= $${periodVals.push(p.dateTo)}::date` : 'true',
    ].join(' AND ');
    const [projects, time, tasks, byProject] = await Promise.all([
      db.query(`SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS active,
                       COUNT(*) FILTER (WHERE status = 'on_hold')::int AS on_hold,
                       COUNT(*) FILTER (WHERE status = 'draft')::int AS draft,
                       COUNT(*) FILTER (WHERE status IN ('active', 'on_hold') AND due_date < CURRENT_DATE)::int AS overdue
                  FROM projects p WHERE ${store}`, storeVals),
      db.query(`SELECT COALESCE(SUM(t.hours), 0) AS hours, COALESCE(SUM(t.hours * t.cost_rate), 0) AS cost,
                       COALESCE(SUM(t.hours * t.billing_rate) FILTER (WHERE t.billable), 0) AS amount,
                       COALESCE(SUM(t.hours * t.billing_rate) FILTER (WHERE t.billable AND t.invoice_id IS NULL), 0) AS unbilled
                  FROM project_time_entries t JOIN projects p ON p.id = t.project_id WHERE ${store} AND ${period}`, periodVals),
      db.query(`SELECT COUNT(*) FILTER (WHERE t.status IN ('todo', 'in_progress'))::int AS open,
                       COUNT(*) FILTER (WHERE t.status IN ('todo', 'in_progress') AND t.due_date < CURRENT_DATE)::int AS overdue
                  FROM project_tasks t JOIN projects p ON p.id = t.project_id WHERE ${store} AND p.status IN ('draft', 'active')`, storeVals),
      db.query(`${SELECT} WHERE ${store} AND p.status IN ('active', 'on_hold') ORDER BY p.due_date NULLS LAST LIMIT 8`, storeVals),
    ]);
    return { projects: projects.rows[0], time: time.rows[0], tasks: tasks.rows[0], active: byProject.rows };
  },

  /** Salariés actifs, pour affecter une tâche ou déclarer du temps (sans le droit Personnel). */
  async people(storeId?: string) {
    const values: unknown[] = [];
    const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
    const r = await db.query(
      `SELECT e.id, ${NAME('e')} AS name, e.role, e.user_id, ROUND(${EMPLOYEE_COST_RATE}, 2) AS cost_rate
         FROM employees e WHERE e.is_active AND ${storeCond(storeId, 'e.store_id', add)} ORDER BY e.first_name, e.last_name`, values);
    return r.rows;
  },
};
