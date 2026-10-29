import { db } from '../config/database.js';

/**
 * Tournées de livraison (mig 387) : regroupe des bons de livraison en une tournée
 * datée, avec ordre de passage et suivi livré par arrêt.
 */
const CUST = `COALESCE(c.company_name, NULLIF(TRIM(COALESCE(c.first_name,'')||' '||COALESCE(c.last_name,'')), ''), 'Client')`;

export const deliveryRouteRepository = {
  async list(p: { storeId?: string | null; status?: string; limit: number }) {
    const params: unknown[] = [];
    const cond: string[] = ['true'];
    if (p.storeId) { params.push(p.storeId); cond.push(`(r.store_id IS NULL OR r.store_id = $${params.length})`); }
    if (p.status) { params.push(p.status); cond.push(`r.status = $${params.length}`); }
    params.push(p.limit);
    const r = await db.query(
      `SELECT r.*, u.first_name || ' ' || u.last_name AS created_by_name,
              (SELECT COUNT(*) FROM delivery_route_stops s WHERE s.route_id = r.id)::int AS stops,
              (SELECT COUNT(*) FROM delivery_route_stops s WHERE s.route_id = r.id AND s.delivered_at IS NOT NULL)::int AS delivered
         FROM delivery_routes r LEFT JOIN users u ON u.id = r.created_by
        WHERE ${cond.join(' AND ')}
        ORDER BY r.route_date DESC, r.created_at DESC LIMIT $${params.length}`, params);
    return r.rows;
  },

  async getById(id: string) {
    const r = (await db.query(
      `SELECT r.*, u.first_name || ' ' || u.last_name AS created_by_name FROM delivery_routes r LEFT JOIN users u ON u.id = r.created_by WHERE r.id = $1`, [id])).rows[0];
    if (!r) return null;
    const stops = (await db.query(
      `SELECT s.id, s.sequence, s.delivered_at, s.note, dn.id AS delivery_note_id, dn.number AS delivery_number,
              dn.delivery_date, ${CUST} AS customer_name, c.phone AS customer_phone, c.address AS customer_address, c.city AS customer_city
         FROM delivery_route_stops s
         JOIN delivery_notes dn ON dn.id = s.delivery_note_id
         JOIN customers c ON c.id = dn.customer_id
        WHERE s.route_id = $1 ORDER BY s.sequence, dn.number`, [id])).rows;
    return { ...r, stops };
  },

  async create(input: { label: string; routeDate?: string | null; driverName?: string | null; notes?: string | null; storeId?: string | null; userId: string | null }) {
    const r = await db.query(
      `INSERT INTO delivery_routes (label, route_date, driver_name, notes, store_id, created_by)
       VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6) RETURNING id`,
      [input.label.trim().slice(0, 120), input.routeDate || null, input.driverName?.trim()?.slice(0, 120) || null, input.notes?.trim() || null, input.storeId ?? null, input.userId]);
    return this.getById(r.rows[0].id);
  },

  async setStatus(id: string, status: 'planned' | 'in_progress' | 'done') {
    const r = await db.query(`UPDATE delivery_routes SET status = $2 WHERE id = $1 RETURNING id`, [id, status]);
    return r.rows[0] ? this.getById(id) : null;
  },

  async addStops(routeId: string, deliveryNoteIds: string[]) {
    const exists = (await db.query(`SELECT 1 FROM delivery_routes WHERE id = $1`, [routeId])).rows[0];
    if (!exists) return null;
    const maxSeq = Number((await db.query(`SELECT COALESCE(MAX(sequence), 0) AS m FROM delivery_route_stops WHERE route_id = $1`, [routeId])).rows[0].m);
    let seq = maxSeq;
    for (const dnId of deliveryNoteIds) {
      seq += 1;
      await db.query(
        `INSERT INTO delivery_route_stops (route_id, delivery_note_id, sequence) VALUES ($1, $2, $3)
         ON CONFLICT (route_id, delivery_note_id) DO NOTHING`, [routeId, dnId, seq]);
    }
    return this.getById(routeId);
  },

  async removeStop(stopId: string) {
    const r = (await db.query(`DELETE FROM delivery_route_stops WHERE id = $1 RETURNING route_id`, [stopId])).rows[0];
    return r ? this.getById(r.route_id) : null;
  },

  async reorder(routeId: string, orderedStopIds: string[]) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < orderedStopIds.length; i++) {
        await client.query(`UPDATE delivery_route_stops SET sequence = $2 WHERE id = $1 AND route_id = $3`, [orderedStopIds[i], i + 1, routeId]);
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    return this.getById(routeId);
  },

  async markStop(stopId: string, delivered: boolean) {
    const r = (await db.query(
      `UPDATE delivery_route_stops SET delivered_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1 RETURNING route_id`, [stopId, delivered])).rows[0];
    return r ? this.getById(r.route_id) : null;
  },

  /** Bons de livraison non encore rattachés à une tournée. */
  async availableDeliveryNotes(p: { storeId?: string | null; limit: number }) {
    const params: unknown[] = [];
    const cond = [`dn.status <> 'cancelled'`, `NOT EXISTS (SELECT 1 FROM delivery_route_stops s WHERE s.delivery_note_id = dn.id)`];
    if (p.storeId) { params.push(p.storeId); cond.push(`(dn.store_id IS NULL OR dn.store_id = $${params.length})`); }
    params.push(p.limit);
    const r = await db.query(
      `SELECT dn.id, dn.number, dn.delivery_date, ${CUST} AS customer_name, c.city AS customer_city
         FROM delivery_notes dn JOIN customers c ON c.id = dn.customer_id
        WHERE ${cond.join(' AND ')}
        ORDER BY dn.delivery_date DESC, dn.number DESC LIMIT $${params.length}`, params);
    return r.rows;
  },
};
