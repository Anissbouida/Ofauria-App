import type { RoutingOperationInput } from '../validators/routing.validator.js';
import { db, withTransaction } from '../config/database.js';

/**
 * Postes de travail & gammes (mig 388). Calcul du coût de main-d'œuvre standard
 * d'une gamme : somme des opérations (durée × coût horaire du poste).
 */
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

type OperationInput = Partial<RoutingOperationInput> & { operationName: string; durationMin: number; workCenterId?: string | null };

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
              COALESCE(SUM(m.labor_min), 0)::float8 AS total_minutes,
              ROUND(COALESCE(SUM(m.labor_min * wc.hourly_cost / 60.0), 0)::numeric, 2)::float8 AS labor_cost,
              COUNT(ro.id)::int AS operations_count
         FROM routings r
         LEFT JOIN products p ON p.id = r.product_id
         LEFT JOIN routing_operations ro ON ro.routing_id = r.id
         LEFT JOIN LATERAL fn_routing_op_minutes(ro.id, r.batch_size) m ON ro.id IS NOT NULL
         LEFT JOIN work_centers wc ON wc.id = ro.work_center_id
         ${where}
        GROUP BY r.id, p.name
        ORDER BY r.is_active DESC, r.name`, params);
    return rows.rows;
  },

  async getRouting(id: string) {
    const r = (await db.query(
      `SELECT r.*, p.name AS product_name, rc.name AS recipe_name FROM routings r
         LEFT JOIN products p ON p.id = r.product_id LEFT JOIN recipes rc ON rc.id = r.recipe_id WHERE r.id = $1`, [id])).rows[0];
    if (!r) return null;
    const ops = (await db.query(
      `SELECT o.id, o.sequence, o.operation_name, o.operation_name_ar, o.work_center_id, o.duration_min, wc.name AS work_center_name,
              o.op_type, o.setup_min::float8, o.machine_min_per_unit::float8, o.labor_min_per_unit::float8, o.base_quantity::float8,
              o.control_point, o.is_blocking, o.temperature_c::float8, o.instructions,
              m.labor_min::float8 AS planned_labor_min, m.machine_min::float8 AS planned_machine_min,
              COALESCE(wc.hourly_cost, 0)::float8 AS hourly_cost,
              ROUND((m.labor_min * COALESCE(wc.hourly_cost, 0) / 60.0)::numeric, 2)::float8 AS operation_cost
         FROM routing_operations o
         JOIN routings r ON r.id = o.routing_id
         LEFT JOIN LATERAL fn_routing_op_minutes(o.id, r.batch_size) m ON true
         LEFT JOIN work_centers wc ON wc.id = o.work_center_id
        WHERE o.routing_id = $1 ORDER BY o.sequence, o.operation_name`, [id])).rows;
    const laborCost = round2(ops.reduce((s: number, o: { operation_cost: number }) => s + Number(o.operation_cost), 0));
    const totalMinutes = ops.reduce((s: number, o: { planned_labor_min: number }) => s + Number(o.planned_labor_min), 0);
    return { ...r, operations: ops, labor_cost: laborCost, total_minutes: totalMinutes };
  },

  async createRouting(input: { name: string; productId?: string | null; recipeId?: string | null; notes?: string | null; batchSize?: number; storeId?: string | null; userId: string | null }) {
    const r = await db.query(
      `INSERT INTO routings (name, product_id, recipe_id, notes, batch_size, store_id, created_by) VALUES ($1,$2,$7,$3,$4,$5,$6) RETURNING id`,
      [input.name.trim().slice(0, 160), input.productId || null, input.notes?.trim() || null,
       input.batchSize != null && input.batchSize > 0 ? input.batchSize : 1,
       input.storeId ?? null, input.userId, input.recipeId || null]);
    return this.getRouting(r.rows[0].id);
  },

  /** Gamme active de la fiche technique (M5-01), sinon celle du produit de la fiche. */
  async getRoutingForRecipe(recipeId: string) {
    const r = (await db.query(
      `SELECT ro.id FROM routings ro
         LEFT JOIN recipes rc ON rc.id = $1
        WHERE ro.is_active AND (ro.recipe_id = $1 OR (ro.recipe_id IS NULL AND rc.product_id IS NOT NULL AND ro.product_id = rc.product_id))
        ORDER BY (ro.recipe_id = $1) DESC NULLS LAST, ro.created_at DESC LIMIT 1`, [recipeId])).rows[0];
    return r ? this.getRouting(r.id) : null;
  },

  async updateRouting(id: string, input: { name?: string; productId?: string | null; recipeId?: string | null; notes?: string | null; batchSize?: number; operations?: OperationInput[] }) {
    const cur = (await db.query(`SELECT * FROM routings WHERE id = $1`, [id])).rows[0];
    if (!cur) return null;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE routings SET name = $2, product_id = $3, notes = $4, batch_size = $5, recipe_id = $6 WHERE id = $1`,
        [id, (input.name ?? cur.name).trim().slice(0, 160),
         input.productId !== undefined ? (input.productId || null) : cur.product_id,
         input.notes !== undefined ? (input.notes?.trim() || null) : cur.notes,
         input.batchSize != null && input.batchSize > 0 ? input.batchSize : cur.batch_size,
         input.recipeId !== undefined ? (input.recipeId || null) : cur.recipe_id]);
      if (input.operations !== undefined) {
        await client.query(`DELETE FROM routing_operations WHERE routing_id = $1`, [id]);
        let seq = 0;
        for (const op of input.operations) {
          if (!op.operationName?.trim()) continue;
          seq += 1;
          await client.query(
            `INSERT INTO routing_operations (routing_id, sequence, operation_name, work_center_id, duration_min,
                op_type, setup_min, machine_min_per_unit, labor_min_per_unit, base_quantity, control_point, is_blocking,
                temperature_c, operation_name_ar, instructions)
             VALUES ($1,$2,$3,$4,$5,$6,$7::numeric,$8::numeric,$9::numeric,$10::numeric,$11,$12,$13::numeric,$14,$15)`,
            [id, seq, op.operationName.trim().slice(0, 160), op.workCenterId || null, Math.max(0, Math.round(Number(op.durationMin) || 0)),
             op.opType ?? 'execution', op.setupMin ?? 0, op.machineMinPerUnit ?? 0, op.laborMinPerUnit ?? 0, op.baseQuantity ?? 1,
             op.controlPoint || null, op.isBlocking ?? false, op.temperatureC ?? null, op.operationNameAr || null, op.instructions || null]);
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

  async recordDowntime(input: { workCenterId: string; fromTime: string; toTime?: string | null; reason: string; notes?: string | null; createIntervention?: boolean }, userId: string | null, storeId: string | null = null) {
    const r = await db.query(
      `INSERT INTO work_center_downtime (work_center_id, from_time, to_time, reason, operator_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [input.workCenterId, input.fromTime, input.toTime || null, input.reason, userId, input.notes?.trim() || null]
    );
    // M5-05 : un arrêt peut ouvrir une demande d'intervention de maintenance.
    if (input.createIntervention && userId) {
      const { equipmentLinkRepository } = await import('./equipment-link.repository.js');
      const i = await equipmentLinkRepository.interventionFromDowntime(r.rows[0].id, { userId, storeId });
      r.rows[0].intervention_id = i.id;
    }
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
      `WITH stops AS (
         -- G0-28 : un arrêt compte pour sa part qui CHEVAUCHE la période (un arrêt commencé
         -- avant la période, ou encore ouvert, était ignoré ou compté en entier).
         SELECT GREATEST(from_time, $2::timestamptz) AS a, LEAST(COALESCE(to_time, now()), $3::timestamptz) AS b
           FROM work_center_downtime
          WHERE work_center_id = $1 AND from_time < $3::timestamptz AND COALESCE(to_time, now()) > $2::timestamptz
       ),
       dt AS (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (b - a)) / 60), 0) AS downtime FROM stops WHERE b > a),
       perf AS (
         SELECT COALESCE(SUM(pie.duree_estimee_min), 0) AS est,
                COALESCE(SUM(pie.duree_reelle_min), 0)  AS reel,
                -- M5-05 : qualité = pièces bonnes / pièces produites (quantités déclarées par opération).
                SUM(pie.good_qty) AS good, SUM(pie.scrap_qty) AS scrap
         FROM production_item_etapes pie
         JOIN production_plan_items ppi ON ppi.id = pie.plan_item_id
         JOIN production_plans pp ON pp.id = ppi.plan_id
         WHERE pie.work_center_id = $1 AND pie.status = 'completed'
           AND pie.completed_at >= $2 AND pie.completed_at < $3 AND pie.duree_reelle_min IS NOT NULL
       ),
       -- G0-28 : jours planifiés = jours où le poste a travaillé OU a été à l'arrêt. Un jour
       -- d'arrêt total (aucune étape terminée) sortait du temps planifié et gonflait la
       -- disponibilité. Faute de calendrier par poste, ce sont les jours d'activité connus.
       days AS (
         SELECT (pie.completed_at AT TIME ZONE 'Africa/Casablanca')::date AS d
           FROM production_item_etapes pie
          WHERE pie.work_center_id = $1 AND pie.status = 'completed'
            AND pie.completed_at >= $2 AND pie.completed_at < $3 AND pie.duree_reelle_min IS NOT NULL
         UNION
         SELECT g::date FROM stops,
                generate_series((a AT TIME ZONE 'Africa/Casablanca')::date,
                                ((b - interval '1 second') AT TIME ZONE 'Africa/Casablanca')::date, interval '1 day') g
          WHERE b > a
       ),
       act AS (SELECT COUNT(*) AS active_days FROM days),
       cap AS (SELECT capacity_minutes_per_day AS cap FROM work_centers WHERE id = $1),
       -- M5-04 : avec un calendrier, le temps planifié = temps d'ouverture de la période
       -- (plages × ressources, jours fermés exclus), et non plus les seuls jours d'activité.
       cal AS (SELECT EXISTS (SELECT 1 FROM work_center_calendar WHERE work_center_id = $1) AS has),
       opening AS (
         SELECT COALESCE(SUM(fn_work_center_capacity($1, g::date)), 0) AS open_min
           FROM generate_series(($2::timestamptz AT TIME ZONE 'Africa/Casablanca')::date,
                                (($3::timestamptz - interval '1 second') AT TIME ZONE 'Africa/Casablanca')::date, interval '1 day') g
       )
       SELECT ROUND(dt.downtime)::int AS downtime_min, act.active_days::int AS active_days,
              cap.cap, CASE WHEN cal.has THEN opening.open_min ELSE cap.cap * act.active_days END AS planned_min,
              cal.has AS from_calendar,
              perf.est::int AS standard_min, perf.reel::int AS reel_min, perf.good, perf.scrap
       FROM dt, perf, cap, act, cal, opening`, [workCenterId, from, to]);
    const row = r.rows[0] || {};
    const planned = row.planned_min != null ? parseFloat(row.planned_min) : 0;
    const downtime = row.downtime_min != null ? parseInt(row.downtime_min) : 0;
    const standard = row.standard_min != null ? parseInt(row.standard_min) : 0;
    const reel = row.reel_min != null ? parseInt(row.reel_min) : 0;
    // Division en JS : duree_*_min sont des entiers (division entière en SQL).
    const availability = planned > 0 ? Math.max(0, Math.round((planned - downtime) / planned * 1000) / 10) : null;
    const performance = reel > 0 ? Math.round(standard / reel * 1000) / 10 : null;
    // M5-05 : qualité, quand des quantités ont été déclarées sur les opérations du poste.
    const good = row.good != null ? Number(row.good) : null;
    const scrap = row.scrap != null ? Number(row.scrap) : 0;
    const quality = good != null && good + scrap > 0 ? Math.round(good / (good + scrap) * 1000) / 10 : null;
    const trs = availability != null && performance != null
      ? Math.round(availability * performance * (quality ?? 100) / 10000 * 10) / 10 : null;
    return {
      downtime_min: downtime, planned_min: planned, standard_min: standard, reel_min: reel,
      active_days: row.active_days != null ? parseInt(row.active_days) : 0,
      from_calendar: !!row.from_calendar,
      availability_pct: availability, performance_pct: performance, quality_pct: quality, trs_pct: trs,
    };
  },

  /* ── Calendrier des postes (M5-04) ── */
  async getCalendar(workCenterId: string) {
    const slots = (await db.query(
      `SELECT id, iso_weekday, to_char(start_time, 'HH24:MI') AS start_time, to_char(end_time, 'HH24:MI') AS end_time, resources
         FROM work_center_calendar WHERE work_center_id = $1 ORDER BY iso_weekday, start_time`, [workCenterId])).rows;
    const closures = (await db.query(
      `SELECT id, work_center_id, closed_on::text AS closed_on, reason FROM work_center_closures
        WHERE (work_center_id = $1 OR work_center_id IS NULL) AND closed_on >= CURRENT_DATE - 30 ORDER BY closed_on`, [workCenterId])).rows;
    return { slots, closures };
  },
  /** Remplace les plages d'un poste (tout ou rien) ; liste vide = retour à la capacité journalière. */
  async setCalendar(workCenterId: string, slots: { isoWeekday: number; startTime: string; endTime: string; resources: number }[]) {
    return withTransaction(async () => {
      await db.query(`DELETE FROM work_center_calendar WHERE work_center_id = $1`, [workCenterId]);
      for (const s of slots) {
        await db.query(
          `INSERT INTO work_center_calendar (work_center_id, iso_weekday, start_time, end_time, resources) VALUES ($1, $2, $3::time, $4::time, $5)`,
          [workCenterId, s.isoWeekday, s.startTime, s.endTime, s.resources]);
      }
      return this.getCalendar(workCenterId);
    });
  },
  async addClosure(workCenterId: string | null, closedOn: string, reason: string | null) {
    return (await db.query(
      `INSERT INTO work_center_closures (work_center_id, closed_on, reason) VALUES ($1, $2::date, $3) RETURNING id, closed_on::text AS closed_on, reason`,
      [workCenterId, closedOn, reason])).rows[0];
  },
  async removeClosure(id: string) {
    return (await db.query(`DELETE FROM work_center_closures WHERE id = $1`, [id])).rowCount! > 0;
  },
  async capacityOn(workCenterId: string, day: string): Promise<number | null> {
    const v = (await db.query(`SELECT fn_work_center_capacity($1, $2::date) AS c`, [workCenterId, day])).rows[0]?.c;
    return v == null ? null : Number(v);
  },
};
