import { db } from '../config/database.js';

/**
 * Piste d'audit générique (G6-07) : historique d'une fiche (modifications champ par champ,
 * suppression), auteur et origine. Seules les tables suivies (déclencheur trg_audit_trail)
 * sont consultables : le nom de table n'entre jamais tel quel dans une requête.
 */
export const auditTrailRepository = {
  async isTracked(table: string): Promise<boolean> {
    return !!(await db.query(
      `SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE t.tgname = 'trg_audit_trail' AND c.relname = $1`, [table])).rows[0];
  },

  async history(table: string, recordId: string, limit = 200) {
    return (await db.query(
      `SELECT a.id::text, a.action, a.changed, a.at, a.origin,
              NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '') AS actor_name
         FROM audit_trail a LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.table_name = $1 AND a.record_id = $2
        ORDER BY a.at DESC, a.id DESC LIMIT $3`, [table, recordId, limit])).rows;
  },
};
