import { db } from '../config/database.js';
import { nextDocumentNumber } from '../utils/document-number.js';

/**
 * Maintenance (mig 359) : plans d'entretien préventif et interventions, sur un
 * équipement interne (immobilisation) ou chez un client. Module générique.
 */

export type InterventionKind = 'preventive' | 'corrective' | 'installation' | 'warranty';
export type InterventionStatus = 'requested' | 'scheduled' | 'in_progress' | 'done' | 'cancelled';
export type Priority = 'low' | 'normal' | 'high' | 'critical';

const NAME = (a: string) => `${a}.first_name || ' ' || ${a}.last_name`;
const CUSTOMER_LABEL = (a: string) =>
  `COALESCE(NULLIF(btrim(COALESCE(${a}.company_name, '')), ''), NULLIF(btrim(COALESCE(${a}.first_name, '') || ' ' || COALESCE(${a}.last_name, '')), ''))`;
const EMPLOYEE_COST_RATE = `COALESCE(e.hourly_rate, e.monthly_salary / 208.0, e.weekly_salary / 48.0, 0)`;

const TRANSITIONS: Record<InterventionStatus, InterventionStatus[]> = {
  requested: ['scheduled', 'in_progress', 'cancelled'],
  scheduled: ['in_progress', 'requested', 'cancelled'],
  in_progress: ['done', 'scheduled', 'cancelled'],
  done: ['in_progress'],
  cancelled: ['requested'],
};

const SELECT = `
  SELECT i.*,
         COALESCE(fa.label, i.equipment_label) AS equipment_name,
         fa.label AS asset_label,
         ${CUSTOMER_LABEL('cu')} AS customer_label,
         ${NAME('e')} AS assignee_name,
         ${NAME('cb')} AS created_by_name,
         c.number AS complaint_number, p.number AS project_number, pl.label AS plan_label,
         ROUND(COALESCE(i.labor_hours, 0) * COALESCE(i.labor_rate, 0) + i.parts_cost, 2) AS total_cost,
         (i.status IN ('requested', 'scheduled') AND i.scheduled_at IS NOT NULL AND i.scheduled_at < now()) AS is_overdue
    FROM maintenance_interventions i
    LEFT JOIN fixed_assets fa ON fa.id = i.fixed_asset_id
    LEFT JOIN customers cu ON cu.id = i.customer_id
    LEFT JOIN employees e ON e.id = i.assignee_id
    LEFT JOIN users cb ON cb.id = i.created_by
    LEFT JOIN complaints c ON c.id = i.complaint_id
    LEFT JOIN projects p ON p.id = i.project_id
    LEFT JOIN maintenance_plans pl ON pl.id = i.plan_id`;

const PLAN_SELECT = `
  SELECT pl.*, COALESCE(fa.label, pl.equipment_label) AS equipment_name, ${CUSTOMER_LABEL('cu')} AS customer_label,
         ${NAME('e')} AS assignee_name,
         (pl.is_active AND pl.next_due_on < CURRENT_DATE) AS is_overdue,
         (pl.is_active AND pl.next_due_on <= CURRENT_DATE + 7) AS is_due_soon,
         (SELECT COUNT(*)::int FROM maintenance_interventions x WHERE x.plan_id = pl.id AND x.status IN ('requested', 'scheduled', 'in_progress')) AS open_count
    FROM maintenance_plans pl
    LEFT JOIN fixed_assets fa ON fa.id = pl.fixed_asset_id
    LEFT JOIN customers cu ON cu.id = pl.customer_id
    LEFT JOIN employees e ON e.id = pl.assignee_id`;

export type InterventionInput = {
  kind?: InterventionKind; priority?: Priority; title: string;
  fixedAssetId?: string | null; customerId?: string | null; equipmentLabel?: string | null; serialNo?: string | null; location?: string | null;
  planId?: string | null; complaintId?: string | null; projectId?: string | null; reportedProblem?: string | null;
  assigneeId?: string | null; scheduledAt?: string | null; underWarranty?: boolean; billable?: boolean; photoUrl?: string | null;
};
export type PlanInput = {
  label: string; fixedAssetId?: string | null; customerId?: string | null; equipmentLabel?: string | null; serialNo?: string | null;
  frequencyDays: number; checklist?: string | null; assigneeId?: string | null; nextDueOn: string; isActive?: boolean;
};

async function addEvent(runner: { query: typeof db.query }, id: string, p: { type: string; from?: string | null; to?: string | null; note?: string | null; userId: string }) {
  await runner.query(
    `INSERT INTO maintenance_events (intervention_id, event_type, from_value, to_value, note, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, p.type, p.from ?? null, p.to ?? null, p.note ?? null, p.userId],
  );
}

async function notifyAssignee(interventionId: string, employeeId: string, userId: string) {
  const r = await db.query(
    `SELECT e.user_id, i.title, i.number, i.store_id FROM employees e, maintenance_interventions i WHERE e.id = $1 AND i.id = $2`,
    [employeeId, interventionId],
  );
  const row = r.rows[0];
  if (!row?.user_id || row.user_id === userId) return;
  await db.query(
    `INSERT INTO notifications (target_role, target_user_id, store_id, type, title, message, reference_type, reference_id, created_by)
     VALUES ('all', $1, $2, 'maintenance_assigned', $3, $4, 'maintenance', $5, $6)`,
    [row.user_id, row.store_id, `Intervention affectée · ${row.number}`, row.title, interventionId, userId],
  );
}

const storeCond = (storeId: string | undefined, col: string, add: (v: unknown) => string) =>
  storeId ? `(${col} IS NULL OR ${col} = ${add(storeId)}::uuid)` : 'true';

export const maintenanceRepository = {
  /* ─── Interventions ──────────────────────────────────────────────────── */
  async create(input: InterventionInput, ctx: { userId: string; storeId: string | null }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const number = await nextDocumentNumber(client, 'maintenance');
      const r = await client.query(
        `INSERT INTO maintenance_interventions (number, store_id, kind, priority, title, fixed_asset_id, customer_id, equipment_label, serial_no, location,
                                                plan_id, complaint_id, project_id, reported_problem, assignee_id, scheduled_at, under_warranty, billable, photo_url, created_by, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
                 CASE WHEN $16::timestamptz IS NULL THEN 'requested' ELSE 'scheduled' END)
         RETURNING id`,
        [number, ctx.storeId, input.kind ?? 'corrective', input.priority ?? 'normal', input.title.trim(), input.fixedAssetId ?? null,
         input.customerId ?? null, input.equipmentLabel?.trim() || null, input.serialNo?.trim() || null, input.location?.trim() || null,
         input.planId ?? null, input.complaintId ?? null, input.projectId ?? null, input.reportedProblem?.trim() || null,
         input.assigneeId ?? null, input.scheduledAt ?? null, input.underWarranty ?? false, input.billable ?? false, input.photoUrl ?? null, ctx.userId],
      );
      const id = r.rows[0].id as string;
      await addEvent(client, id, { type: 'created', to: input.kind ?? 'corrective', userId: ctx.userId });
      await client.query('COMMIT');
      if (input.assigneeId) await notifyAssignee(id, input.assigneeId, ctx.userId);
      return this.findById(id);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async findById(id: string) {
    const r = await db.query(`${SELECT} WHERE i.id = $1`, [id]);
    const row = r.rows[0];
    if (!row) return null;
    const ev = await db.query(
      `SELECT ev.*, ${NAME('u')} AS by_name FROM maintenance_events ev LEFT JOIN users u ON u.id = ev.created_by WHERE ev.intervention_id = $1 ORDER BY ev.created_at`,
      [id],
    );
    return { ...row, events: ev.rows };
  },

  async list(p: {
    status?: InterventionStatus; kind?: InterventionKind; assigneeId?: string; fixedAssetId?: string; customerId?: string;
    overdueOnly?: boolean; search?: string; dateFrom?: string; dateTo?: string; storeId?: string; limit: number; offset: number;
  }) {
    const values: unknown[] = [];
    const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
    const base = [storeCond(p.storeId, 'i.store_id', add)];
    if (p.kind) base.push(`i.kind = ${add(p.kind)}`);
    if (p.assigneeId) base.push(`i.assignee_id = ${add(p.assigneeId)}::uuid`);
    if (p.fixedAssetId) base.push(`i.fixed_asset_id = ${add(p.fixedAssetId)}::uuid`);
    if (p.customerId) base.push(`i.customer_id = ${add(p.customerId)}::uuid`);
    if (p.dateFrom) base.push(`COALESCE(i.scheduled_at, i.created_at)::date >= ${add(p.dateFrom)}::date`);
    if (p.dateTo) base.push(`COALESCE(i.scheduled_at, i.created_at)::date <= ${add(p.dateTo)}::date`);
    if (p.search) {
      const s = add(`%${p.search}%`);
      base.push(`(i.number ILIKE ${s} OR i.title ILIKE ${s} OR COALESCE(i.equipment_label, '') ILIKE ${s} OR COALESCE(i.serial_no, '') ILIKE ${s}
                  OR EXISTS (SELECT 1 FROM fixed_assets f2 WHERE f2.id = i.fixed_asset_id AND f2.label ILIKE ${s})
                  OR EXISTS (SELECT 1 FROM customers c2 WHERE c2.id = i.customer_id AND (c2.company_name ILIKE ${s} OR (COALESCE(c2.first_name, '') || ' ' || COALESCE(c2.last_name, '')) ILIKE ${s})))`);
    }
    const nBase = values.length;
    const cond = [...base];
    if (p.status) cond.push(`i.status = ${add(p.status)}`);
    if (p.overdueOnly) cond.push(`i.status IN ('requested', 'scheduled') AND i.scheduled_at < now()`);
    const nCond = values.length;
    const lim = add(p.limit); const off = add(p.offset);
    const [rows, total, counts] = await Promise.all([
      db.query(`${SELECT} WHERE ${cond.join(' AND ')}
                ORDER BY (i.status IN ('requested', 'scheduled', 'in_progress')) DESC,
                         CASE i.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                         i.scheduled_at NULLS LAST, i.created_at DESC
                LIMIT ${lim} OFFSET ${off}`, values),
      db.query(`SELECT COUNT(*)::int AS n FROM maintenance_interventions i WHERE ${cond.join(' AND ')}`, values.slice(0, nCond)),
      db.query(`SELECT i.status, COUNT(*)::int AS count,
                       COUNT(*) FILTER (WHERE i.status IN ('requested', 'scheduled') AND i.scheduled_at < now())::int AS overdue
                  FROM maintenance_interventions i WHERE ${base.join(' AND ')} GROUP BY i.status`, values.slice(0, nBase)),
    ]);
    const byStatus: Record<string, { count: number; overdue: number }> = {};
    for (const r of counts.rows) byStatus[r.status] = { count: r.count, overdue: r.overdue };
    return { rows: rows.rows, total: total.rows[0].n as number, byStatus };
  },

  async update(id: string, patch: Partial<InterventionInput> & { workDone?: string | null; downtimeHours?: number | null; laborHours?: number | null; laborRate?: number | null; partsCost?: number; billedAmount?: number | null }, userId: string) {
    const cur = await db.query(`SELECT assignee_id FROM maintenance_interventions WHERE id = $1`, [id]);
    if (!cur.rows[0]) return null;
    const cols: Record<string, unknown> = {
      kind: patch.kind, priority: patch.priority, title: patch.title?.trim(), fixed_asset_id: patch.fixedAssetId, customer_id: patch.customerId,
      equipment_label: patch.equipmentLabel?.trim() ?? patch.equipmentLabel, serial_no: patch.serialNo?.trim() ?? patch.serialNo, location: patch.location?.trim() ?? patch.location,
      project_id: patch.projectId, reported_problem: patch.reportedProblem?.trim() ?? patch.reportedProblem, assignee_id: patch.assigneeId,
      scheduled_at: patch.scheduledAt, under_warranty: patch.underWarranty, billable: patch.billable, photo_url: patch.photoUrl,
      work_done: patch.workDone?.trim() ?? patch.workDone, downtime_hours: patch.downtimeHours, labor_hours: patch.laborHours,
      labor_rate: patch.laborRate, parts_cost: patch.partsCost, billed_amount: patch.billedAmount,
    };
    const sets: string[] = []; const values: unknown[] = [];
    for (const [k, v] of Object.entries(cols)) { if (v === undefined) continue; values.push(v); sets.push(`${k} = $${values.length}`); }
    if (sets.length) {
      values.push(id);
      await db.query(`UPDATE maintenance_interventions SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
      await addEvent(db, id, { type: patch.scheduledAt !== undefined ? 'scheduled' : 'edited', to: patch.scheduledAt ?? null, userId });
    }
    if (patch.assigneeId && patch.assigneeId !== cur.rows[0].assignee_id) {
      await addEvent(db, id, { type: 'assigned', from: cur.rows[0].assignee_id, to: patch.assigneeId, userId });
      await notifyAssignee(id, patch.assigneeId, userId);
    }
    return this.findById(id);
  },

  /**
   * Changement d'étape. Terminer exige le compte rendu ; les heures de main-d'œuvre
   * prennent par défaut le coût horaire de l'intervenant ; un plan d'entretien à
   * l'origine est reprogrammé à la fréquence suivante.
   */
  async setStatus(id: string, to: InterventionStatus, p: {
    note?: string | null; workDone?: string | null; laborHours?: number | null; laborRate?: number | null; partsCost?: number | null;
    downtimeHours?: number | null; scheduledAt?: string | null; userId: string;
  }) {
    const cur = await db.query(
      `SELECT i.status, i.plan_id, i.assignee_id, i.labor_rate, ${EMPLOYEE_COST_RATE} AS assignee_rate
         FROM maintenance_interventions i LEFT JOIN employees e ON e.id = i.assignee_id WHERE i.id = $1`, [id]);
    const row = cur.rows[0];
    if (!row) return { error: 'not_found' as const };
    const from = row.status as InterventionStatus;
    if (!TRANSITIONS[from].includes(to)) return { error: 'transition' as const, from };
    if (to === 'done' && !p.workDone?.trim()) return { error: 'work_done_required' as const };
    const sets = ['status = $2::text']; const values: unknown[] = [id, to];
    const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
    if (to === 'scheduled' && p.scheduledAt) sets.push(`scheduled_at = ${add(p.scheduledAt)}`);
    if (to === 'in_progress') sets.push('started_at = COALESCE(started_at, now())', 'completed_at = NULL');
    if (to === 'done') {
      sets.push('completed_at = now()', `work_done = ${add(p.workDone!.trim())}`);
      if (p.laborHours != null) sets.push(`labor_hours = ${add(p.laborHours)}`);
      sets.push(`labor_rate = ${add(p.laborRate ?? row.labor_rate ?? (Number(row.assignee_rate) || 0))}`);
      if (p.partsCost != null) sets.push(`parts_cost = ${add(p.partsCost)}`);
      if (p.downtimeHours != null) sets.push(`downtime_hours = ${add(p.downtimeHours)}`);
    }
    if (to === 'requested' || to === 'cancelled') sets.push('completed_at = NULL');
    await db.query(`UPDATE maintenance_interventions SET ${sets.join(', ')} WHERE id = $1`, values);
    await addEvent(db, id, { type: 'status', from, to, note: p.note ?? null, userId: p.userId });
    if (to === 'done' && row.plan_id) {
      await db.query(
        `UPDATE maintenance_plans SET last_done_on = CURRENT_DATE, next_due_on = CURRENT_DATE + frequency_days WHERE id = $1`,
        [row.plan_id],
      );
    }
    return { data: await this.findById(id) };
  },

  async comment(id: string, note: string, userId: string) {
    const cur = await db.query(`SELECT 1 FROM maintenance_interventions WHERE id = $1`, [id]);
    if (!cur.rows[0]) return null;
    await addEvent(db, id, { type: 'comment', note, userId });
    return this.findById(id);
  },

  /* ─── Plans d'entretien ──────────────────────────────────────────────── */
  async listPlans(p: { storeId?: string; activeOnly?: boolean }) {
    const values: unknown[] = [];
    const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
    const cond = [storeCond(p.storeId, 'pl.store_id', add)];
    if (p.activeOnly) cond.push('pl.is_active');
    const r = await db.query(`${PLAN_SELECT} WHERE ${cond.join(' AND ')} ORDER BY pl.is_active DESC, pl.next_due_on`, values);
    return r.rows;
  },

  async findPlan(id: string) {
    const r = await db.query(`${PLAN_SELECT} WHERE pl.id = $1`, [id]);
    return r.rows[0] ?? null;
  },

  async savePlan(input: PlanInput & { id?: string }, ctx: { userId: string; storeId: string | null }) {
    if (input.id) {
      await db.query(
        `UPDATE maintenance_plans SET label = $2, fixed_asset_id = $3, customer_id = $4, equipment_label = $5, serial_no = $6, frequency_days = $7,
                checklist = $8, assignee_id = $9, next_due_on = $10, is_active = $11 WHERE id = $1`,
        [input.id, input.label.trim(), input.fixedAssetId ?? null, input.customerId ?? null, input.equipmentLabel?.trim() || null,
         input.serialNo?.trim() || null, input.frequencyDays, input.checklist?.trim() || null, input.assigneeId ?? null, input.nextDueOn, input.isActive ?? true],
      );
      return this.findPlan(input.id);
    }
    const r = await db.query(
      `INSERT INTO maintenance_plans (store_id, label, fixed_asset_id, customer_id, equipment_label, serial_no, frequency_days, checklist, assignee_id, next_due_on, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [ctx.storeId, input.label.trim(), input.fixedAssetId ?? null, input.customerId ?? null, input.equipmentLabel?.trim() || null,
       input.serialNo?.trim() || null, input.frequencyDays, input.checklist?.trim() || null, input.assigneeId ?? null, input.nextDueOn, input.isActive ?? true, ctx.userId],
    );
    return this.findPlan(r.rows[0].id);
  },

  /** Crée l'intervention préventive d'un plan (une seule ouverte à la fois). */
  async createFromPlan(planId: string, ctx: { userId: string; storeId: string | null }) {
    const plan = await this.findPlan(planId);
    if (!plan) return null;
    if (plan.open_count > 0) {
      const r = await db.query(`SELECT id FROM maintenance_interventions WHERE plan_id = $1 AND status IN ('requested', 'scheduled', 'in_progress') ORDER BY created_at DESC LIMIT 1`, [planId]);
      return this.findById(r.rows[0].id);
    }
    return this.create({
      kind: 'preventive', title: plan.label, fixedAssetId: plan.fixed_asset_id, customerId: plan.customer_id, equipmentLabel: plan.equipment_label,
      serialNo: plan.serial_no, planId, reportedProblem: plan.checklist, assigneeId: plan.assignee_id,
      scheduledAt: `${plan.next_due_on instanceof Date ? plan.next_due_on.toISOString().slice(0, 10) : String(plan.next_due_on).slice(0, 10)}T09:00:00`,
    }, { userId: ctx.userId, storeId: plan.store_id ?? ctx.storeId });
  },

  /* ─── Tableau de bord et équipements ─────────────────────────────────── */
  async overview(p: { storeId?: string; dateFrom?: string; dateTo?: string }) {
    const storeVals: unknown[] = p.storeId ? [p.storeId] : [];
    const store = (col: string) => (p.storeId ? `(${col} IS NULL OR ${col} = $1::uuid)` : 'true');
    const periodVals = [...storeVals];
    const period = [
      p.dateFrom ? `i.completed_at::date >= $${periodVals.push(p.dateFrom)}::date` : 'true',
      p.dateTo ? `i.completed_at::date <= $${periodVals.push(p.dateTo)}::date` : 'true',
    ].join(' AND ');
    const [inter, done, plans] = await Promise.all([
      db.query(`SELECT COUNT(*) FILTER (WHERE status = 'requested')::int AS requested,
                       COUNT(*) FILTER (WHERE status = 'scheduled')::int AS scheduled,
                       COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
                       COUNT(*) FILTER (WHERE status IN ('requested', 'scheduled') AND scheduled_at < now())::int AS overdue,
                       COUNT(*) FILTER (WHERE status IN ('requested', 'scheduled', 'in_progress') AND priority = 'critical')::int AS critical
                  FROM maintenance_interventions i WHERE ${store('i.store_id')}`, storeVals),
      db.query(`SELECT COUNT(*)::int AS count,
                       COALESCE(SUM(COALESCE(i.labor_hours, 0) * COALESCE(i.labor_rate, 0) + i.parts_cost), 0) AS cost,
                       COALESCE(SUM(i.downtime_hours), 0) AS downtime,
                       COUNT(*) FILTER (WHERE i.kind = 'corrective')::int AS corrective,
                       COUNT(*) FILTER (WHERE i.kind = 'preventive')::int AS preventive
                  FROM maintenance_interventions i WHERE i.status = 'done' AND ${store('i.store_id')} AND ${period}`, periodVals),
      db.query(`SELECT COUNT(*) FILTER (WHERE next_due_on < CURRENT_DATE)::int AS overdue,
                       COUNT(*) FILTER (WHERE next_due_on BETWEEN CURRENT_DATE AND CURRENT_DATE + 7)::int AS due_soon,
                       COUNT(*)::int AS active
                  FROM maintenance_plans pl WHERE pl.is_active AND ${store('pl.store_id')}`, storeVals),
    ]);
    const duePlans = await db.query(`${PLAN_SELECT} WHERE pl.is_active AND pl.next_due_on <= CURRENT_DATE + 7 AND ${store('pl.store_id')} ORDER BY pl.next_due_on LIMIT 8`, storeVals);
    return { interventions: inter.rows[0], done: done.rows[0], plans: plans.rows[0], duePlans: duePlans.rows };
  },

  /** Historique et coût par équipement (immobilisation ou libellé). */
  async equipmentReport(p: { storeId?: string; dateFrom?: string; dateTo?: string }) {
    const values: unknown[] = [];
    const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
    const cond = [storeCond(p.storeId, 'i.store_id', add)];
    if (p.dateFrom) cond.push(`COALESCE(i.completed_at, i.created_at)::date >= ${add(p.dateFrom)}::date`);
    if (p.dateTo) cond.push(`COALESCE(i.completed_at, i.created_at)::date <= ${add(p.dateTo)}::date`);
    const r = await db.query(
      `SELECT i.fixed_asset_id, COALESCE(fa.label, i.equipment_label) AS equipment_name, ${CUSTOMER_LABEL('cu')} AS customer_label,
              COUNT(*)::int AS count,
              COUNT(*) FILTER (WHERE i.kind = 'corrective')::int AS corrective,
              COUNT(*) FILTER (WHERE i.status IN ('requested', 'scheduled', 'in_progress'))::int AS open,
              COALESCE(SUM(COALESCE(i.labor_hours, 0) * COALESCE(i.labor_rate, 0) + i.parts_cost) FILTER (WHERE i.status = 'done'), 0) AS cost,
              COALESCE(SUM(i.downtime_hours) FILTER (WHERE i.status = 'done'), 0) AS downtime,
              MAX(i.completed_at) AS last_done_at
         FROM maintenance_interventions i
         LEFT JOIN fixed_assets fa ON fa.id = i.fixed_asset_id
         LEFT JOIN customers cu ON cu.id = i.customer_id
        WHERE ${cond.join(' AND ')}
        GROUP BY i.fixed_asset_id, COALESCE(fa.label, i.equipment_label), ${CUSTOMER_LABEL('cu')}
        ORDER BY cost DESC, count DESC`, values);
    return r.rows;
  },

  async assets(storeId?: string) {
    const values: unknown[] = [];
    const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
    const r = await db.query(
      `SELECT id, label, status, acquisition_date FROM fixed_assets WHERE status = 'active' AND ${storeCond(storeId, 'store_id', add)} ORDER BY label`, values);
    return r.rows;
  },

  async people(storeId?: string) {
    const values: unknown[] = [];
    const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
    const r = await db.query(
      `SELECT e.id, ${NAME('e')} AS name, e.role, ROUND(${EMPLOYEE_COST_RATE}, 2) AS cost_rate
         FROM employees e WHERE e.is_active AND ${storeCond(storeId, 'e.store_id', add)} ORDER BY e.first_name, e.last_name`, values);
    return r.rows;
  },
};
