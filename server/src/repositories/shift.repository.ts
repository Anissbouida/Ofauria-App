import { db } from '../config/database.js';

export const shiftRepository = {
  async list() {
    const result = await db.query(
      `SELECT code, label, start_time, end_time, is_night, display_order, is_active
         FROM shifts s
        WHERE is_active = true
          -- Audit des profils (R2, mig 732) : postes du métier de la société, ou déjà utilisés.
          AND (cardinality(s.sectors) = 0 OR s.sectors && fn_active_sector_lineage()
               OR EXISTS (SELECT 1 FROM employees e WHERE e.default_shift_code = s.code)
               OR EXISTS (SELECT 1 FROM schedules sc WHERE sc.shift_code = s.code))
        ORDER BY display_order, code`
    );
    return result.rows;
  },

  async findByCode(code: string) {
    const result = await db.query(`SELECT * FROM shifts WHERE code = $1`, [code]);
    return result.rows[0] || null;
  },
};
