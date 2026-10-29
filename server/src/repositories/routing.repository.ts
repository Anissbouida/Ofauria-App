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
  async createWorkCenter(input: { name: string; hourlyCost: number; storeId?: string | null; userId: string | null }) {
    const r = await db.query(
      `INSERT INTO work_centers (name, hourly_cost, store_id, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [input.name.trim().slice(0, 120), input.hourlyCost >= 0 ? round2(input.hourlyCost) : 0, input.storeId ?? null, input.userId]);
    return { ...r.rows[0], hourly_cost: Number(r.rows[0].hourly_cost), operations_count: 0 };
  },
  async setWorkCenterActive(id: string, active: boolean) {
    const r = await db.query(`UPDATE work_centers SET is_active = $2 WHERE id = $1 RETURNING *`, [id, active]);
    return r.rows[0] ? { ...r.rows[0], hourly_cost: Number(r.rows[0].hourly_cost) } : null;
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

  async createRouting(input: { name: string; productId?: string | null; notes?: string | null; storeId?: string | null; userId: string | null }) {
    const r = await db.query(
      `INSERT INTO routings (name, product_id, notes, store_id, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [input.name.trim().slice(0, 160), input.productId || null, input.notes?.trim() || null, input.storeId ?? null, input.userId]);
    return this.getRouting(r.rows[0].id);
  },

  async updateRouting(id: string, input: { name?: string; productId?: string | null; notes?: string | null; operations?: OperationInput[] }) {
    const cur = (await db.query(`SELECT * FROM routings WHERE id = $1`, [id])).rows[0];
    if (!cur) return null;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE routings SET name = $2, product_id = $3, notes = $4 WHERE id = $1`,
        [id, (input.name ?? cur.name).trim().slice(0, 160),
         input.productId !== undefined ? (input.productId || null) : cur.product_id,
         input.notes !== undefined ? (input.notes?.trim() || null) : cur.notes]);
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
};
