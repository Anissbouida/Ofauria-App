import { db } from '../config/database.js';

/**
 * Postes de travail & gammes (mig 388). Calcul du coût de main-d'œuvre standard
 * d'une gamme : somme des opérations (durée × coût horaire du poste).
 */
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

type OperationInput = { operationName: string; workCenterId?: string | null; durationMin: number };

export const routingRepository = {
  /* ── Postes de travail ── */
  async listWorkCenters(storeId?: string | null) {
    const params: unknown[] = [];
    let where = '';
    if (storeId) { params.push(storeId); where = `WHERE (w.store_id IS NULL OR w.store_id = $1)`; }
    const r = await db.query(
      `SELECT w.*, (SELECT COUNT(*) FROM routing_operations o WHERE o.work_center_id = w.id)::int AS operations_count
         FROM work_centers w ${where} ORDER BY w.is_active DESC, w.name`, params);
    return r.rows.map((x: Record<string, unknown>) => ({ ...x, hourly_cost: Number(x.hourly_cost) }));
  },
  async createWorkCenter(input: { name: string; hourlyCost: number; capacityMinutesPerDay?: number | null; storeId?: string | null; userId: string | null }) {
    const cap = input.capacityMinutesPerDay != null && input.capacityMinutesPerDay > 0 ? input.capacityMinutesPerDay : null;
    const r = await db.query(
      `INSERT INTO work_centers (name, hourly_cost, capacity_minutes_per_day, store_id, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [input.name.trim().slice(0, 120), input.hourlyCost >= 0 ? round2(input.hourlyCost) : 0, cap, input.storeId ?? null, input.userId]);
    return { ...r.rows[0], hourly_cost: Number(r.rows[0].hourly_cost), operations_count: 0 };
  },
  async setWorkCenterActive(id: string, active: boolean) {
    const r = await db.query(`UPDATE work_centers SET is_active = $2 WHERE id = $1 RETURNING *`, [id, active]);
    return r.rows[0] ? { ...r.rows[0], hourly_cost: Number(r.rows[0].hourly_cost) } : null;
  },
  // Édition d'un poste : nom, coût horaire, capacité (mig 398).
  async updateWorkCenter(id: string, input: { name?: string; hourlyCost?: number; capacityMinutesPerDay?: number | null }) {
    const cur = (await db.query(`SELECT * FROM work_centers WHERE id = $1`, [id])).rows[0];
    if (!cur) return null;
    const cap = input.capacityMinutesPerDay === undefined
      ? cur.capacity_minutes_per_day
      : (input.capacityMinutesPerDay != null && input.capacityMinutesPerDay > 0 ? input.capacityMinutesPerDay : null);
    const r = await db.query(
      `UPDATE work_centers SET name = $2, hourly_cost = $3, capacity_minutes_per_day = $4 WHERE id = $1 RETURNING *`,
      [id, (input.name ?? cur.name).trim().slice(0, 120),
       input.hourlyCost !== undefined && input.hourlyCost >= 0 ? round2(input.hourlyCost) : Number(cur.hourly_cost),
       cap]);
    return { ...r.rows[0], hourly_cost: Number(r.rows[0].hourly_cost) };
  },

  /* ── Gammes ── */
  async listRoutings(storeId?: string | null) {
    const params: unknown[] = [];
    let where = '';
    if (storeId) { params.push(storeId); where = `WHERE (r.store_id IS NULL OR r.store_id = $1)`; }
    const rows = await db.query(
      `SELECT r.*, p.name AS product_name,
              COALESCE(SUM(ro.duration_min), 0)::int AS total_minutes,
              ROUND(COALESCE(SUM(ro.duration_min * wc.hourly_cost / 60.0), 0)::numeric, 2)::float8 AS labor_cost,
              COUNT(ro.id)::int AS operations_count
         FROM routings r
         LEFT JOIN products p ON p.id = r.product_id
         LEFT JOIN routing_operations ro ON ro.routing_id = r.id
         LEFT JOIN work_centers wc ON wc.id = ro.work_center_id
         ${where}
        GROUP BY r.id, p.name
        ORDER BY r.is_active DESC, r.name`, params);
    return rows.rows;
  },

  async getRouting(id: string) {
    const r = (await db.query(
      `SELECT r.*, p.name AS product_name FROM routings r LEFT JOIN products p ON p.id = r.product_id WHERE r.id = $1`, [id])).rows[0];
    if (!r) return null;
    const ops = (await db.query(
      `SELECT o.id, o.sequence, o.operation_name, o.work_center_id, o.duration_min, wc.name AS work_center_name,
              COALESCE(wc.hourly_cost, 0)::float8 AS hourly_cost,
              ROUND((o.duration_min * COALESCE(wc.hourly_cost, 0) / 60.0)::numeric, 2)::float8 AS operation_cost
         FROM routing_operations o LEFT JOIN work_centers wc ON wc.id = o.work_center_id
        WHERE o.routing_id = $1 ORDER BY o.sequence, o.operation_name`, [id])).rows;
    const laborCost = round2(ops.reduce((s: number, o: { operation_cost: number }) => s + Number(o.operation_cost), 0));
    const totalMinutes = ops.reduce((s: number, o: { duration_min: number }) => s + Number(o.duration_min), 0);
    return { ...r, operations: ops, labor_cost: laborCost, total_minutes: totalMinutes };
  },

  async createRouting(input: { name: string; productId?: string | null; notes?: string | null; batchSize?: number; storeId?: string | null; userId: string | null }) {
    const r = await db.query(
      `INSERT INTO routings (name, product_id, notes, batch_size, store_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [input.name.trim().slice(0, 160), input.productId || null, input.notes?.trim() || null,
       input.batchSize != null && input.batchSize > 0 ? input.batchSize : 1,
       input.storeId ?? null, input.userId]);
    return this.getRouting(r.rows[0].id);
  },

  async updateRouting(id: string, input: { name?: string; productId?: string | null; notes?: string | null; batchSize?: number; operations?: OperationInput[] }) {
    const cur = (await db.query(`SELECT * FROM routings WHERE id = $1`, [id])).rows[0];
    if (!cur) return null;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE routings SET name = $2, product_id = $3, notes = $4, batch_size = $5 WHERE id = $1`,
        [id, (input.name ?? cur.name).trim().slice(0, 160),
         input.productId !== undefined ? (input.productId || null) : cur.product_id,
         input.notes !== undefined ? (input.notes?.trim() || null) : cur.notes,
         input.batchSize != null && input.batchSize > 0 ? input.batchSize : cur.batch_size]);
      if (input.operations !== undefined) {
        await client.query(`DELETE FROM routing_operations WHERE routing_id = $1`, [id]);
        let seq = 0;
        for (const op of input.operations) {
          if (!op.operationName?.trim()) continue;
          seq += 1;
          await client.query(
            `INSERT INTO routing_operations (routing_id, sequence, operation_name, work_center_id, duration_min) VALUES ($1,$2,$3,$4,$5)`,
            [id, seq, op.operationName.trim().slice(0, 160), op.workCenterId || null, Math.max(0, Math.round(Number(op.durationMin) || 0))]);
        }
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    return this.getRouting(id);
  },

  async setRoutingActive(id: string, active: boolean) {
    const r = await db.query(`UPDATE routings SET is_active = $2 WHERE id = $1 RETURNING id`, [id, active]);
    return r.rows[0] ? this.getRouting(id) : null;
  },

  async deleteRouting(id: string) {
    await db.query(`DELETE FROM routings WHERE id = $1`, [id]);
  },

  /* ── Statut & arrêts machine / TRS (mig 402) — roadmap lot 7 ── */
  async setWorkCenterStatus(id: string, status: string) {
    const r = await db.query(`UPDATE work_centers SET status = $2 WHERE id = $1 RETURNING *`, [id, status]);
    return r.rows[0] ? { ...r.rows[0], hourly_cost: Number(r.rows[0].hourly_cost) } : null;
  },

  async recordDowntime(input: { workCenterId: string; fromTime: string; toTime?: string | null; reason: string; notes?: string | null }, userId: string | null) {
    const r = await db.query(
      `INSERT INTO work_center_downtime (work_center_id, from_time, to_time, reason, operator_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [input.workCenterId, input.fromTime, input.toTime || null, input.reason, userId, input.notes?.trim() || null]
    );
    return r.rows[0];
  },

  async listDowntime(workCenterId: string, from?: string, to?: string) {
    const params: unknown[] = [workCenterId];
    let f = '';
    if (from) { params.push(from); f += ` AND d.from_time >= $${params.length}`; }
    if (to) { params.push(to); f += ` AND d.from_time < $${params.length}`; }
    const r = await db.query(
      `SELECT d.id, d.from_time, d.to_time, d.reason, d.notes, u.first_name AS operator_name,
              ROUND(EXTRACT(EPOCH FROM (COALESCE(d.to_time, now()) - d.from_time)) / 60)::int AS minutes
       FROM work_center_downtime d
       LEFT JOIN users u ON u.id = d.operator_id
       WHERE d.work_center_id = $1${f}
       ORDER BY d.from_time DESC`, params);
    return r.rows;
  },

  // TRS ≈ disponibilité × performance (qualité non rattachable au poste, exclue).
  async getOee(workCenterId: string, from: string, to: string) {
    const r = await db.query(
      `WITH dt AS (
         SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(to_time, now()) - from_time)) / 60), 0) AS downtime
         FROM work_center_downtime WHERE work_center_id = $1 AND from_time >= $2 AND from_time < $3
       ),
       perf AS (
         SELECT COALESCE(SUM(pie.duree_estimee_min), 0) AS est,
                COALESCE(SUM(pie.duree_reelle_min), 0)  AS reel,
                COUNT(DISTINCT pp.plan_date)            AS active_days
         FROM production_item_etapes pie
         JOIN production_plan_items ppi ON ppi.id = pie.plan_item_id
         JOIN production_plans pp ON pp.id = ppi.plan_id
         WHERE pie.work_center_id = $1 AND pie.status = 'completed'
           AND pie.completed_at >= $2 AND pie.completed_at < $3 AND pie.duree_reelle_min IS NOT NULL
       ),
       cap AS (SELECT capacity_minutes_per_day AS cap FROM work_centers WHERE id = $1)
       SELECT ROUND(dt.downtime)::int AS downtime_min, perf.active_days::int AS active_days,
              cap.cap, (cap.cap * perf.active_days) AS planned_min,
              perf.est::int AS standard_min, perf.reel::int AS reel_min
       FROM dt, perf, cap`, [workCenterId, from, to]);
    const row = r.rows[0] || {};
    const planned = row.planned_min != null ? parseFloat(row.planned_min) : 0;
    const downtime = row.downtime_min != null ? parseInt(row.downtime_min) : 0;
    const standard = row.standard_min != null ? parseInt(row.standard_min) : 0;
    const reel = row.reel_min != null ? parseInt(row.reel_min) : 0;
    // Division en JS : duree_*_min sont des entiers (division entière en SQL).
    const availability = planned > 0 ? Math.max(0, Math.round((planned - downtime) / planned * 1000) / 10) : null;
    const performance = reel > 0 ? Math.round(standard / reel * 1000) / 10 : null;
    const trs = availability != null && performance != null ? Math.round(availability * performance / 100 * 10) / 10 : null;
    return {
      downtime_min: downtime, planned_min: planned, standard_min: standard, reel_min: reel,
      active_days: row.active_days != null ? parseInt(row.active_days) : 0,
      availability_pct: availability, performance_pct: performance, trs_pct: trs,
    };
  },
};
