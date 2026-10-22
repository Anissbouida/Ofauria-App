import { db } from '../config/database.js';
import { auditedQuery, setAuditUser } from '../utils/audit-context.js';

/** Champs d'un établissement (mig 331 : code, type, responsable, e-mail, patente, horaires, siège). */
export interface StoreInput {
  name?: string; city?: string | null; address?: string | null; phone?: string | null; isActive?: boolean;
  code?: string | null; kind?: string; managerUserId?: string | null; email?: string | null;
  patente?: string | null; openingHours?: Record<string, unknown> | null; isHeadquarters?: boolean;
}

const COLUMNS: Record<keyof StoreInput, string> = {
  name: 'name', city: 'city', address: 'address', phone: 'phone', isActive: 'is_active',
  code: 'code', kind: 'kind', managerUserId: 'manager_user_id', email: 'email',
  patente: 'patente', openingHours: 'opening_hours', isHeadquarters: 'is_headquarters',
};

export const storeRepository = {
  async findAll() {
    const result = await db.query(
      // Responsable lu via to_jsonb : la requete reste valide avant la mig 331 (colonne absente).
      `SELECT s.*,
              (SELECT COUNT(*) FROM users WHERE store_id = s.id AND is_active = true) as user_count,
              (SELECT concat_ws(' ', u.first_name, u.last_name) FROM users u WHERE u.id::text = to_jsonb(s) ->> 'manager_user_id') AS manager_name
       FROM stores s ORDER BY s.name`
    );
    return result.rows;
  },

  async findById(id: string) {
    const result = await db.query('SELECT * FROM stores WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async create(data: StoreInput & { name: string }, actorId?: string) {
    return this.save(null, data, actorId);
  },

  async update(id: string, data: StoreInput, actorId?: string) {
    return this.save(id, data, actorId);
  },

  /** Création ou modification ; un seul siège (l'ancien perd le statut dans la même transaction). */
  async save(id: string | null, data: StoreInput, actorId?: string) {
    const entries = (Object.keys(COLUMNS) as (keyof StoreInput)[])
      .filter(k => data[k] !== undefined)
      .map(k => [COLUMNS[k], k === 'openingHours' && data[k] !== null ? JSON.stringify(data[k]) : data[k]] as [string, unknown]);
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setAuditUser(client, actorId);
      if (data.isHeadquarters === true) {
        await client.query(`UPDATE stores SET is_headquarters = false, updated_at = NOW() WHERE is_headquarters AND id IS DISTINCT FROM $1`, [id]);
      }
      let row;
      if (id === null) {
        const cols = entries.map(e => e[0]);
        const r = await client.query(
          `INSERT INTO stores (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
          entries.map(e => e[1]));
        row = r.rows[0];
      } else if (entries.length) {
        const r = await client.query(
          `UPDATE stores SET ${entries.map((e, i) => `${e[0]} = $${i + 1}`).join(', ')}, updated_at = NOW()
            WHERE id = $${entries.length + 1} RETURNING *`,
          [...entries.map(e => e[1]), id]);
        row = r.rows[0];
      } else {
        row = (await client.query('SELECT * FROM stores WHERE id = $1', [id])).rows[0];
      }
      await client.query('COMMIT');
      return row ?? null;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },

  async remove(id: string, actorId?: string) {
    await auditedQuery(actorId, 'DELETE FROM stores WHERE id = $1', [id]);
  },
};
