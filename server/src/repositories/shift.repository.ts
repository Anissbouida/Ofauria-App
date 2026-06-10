import { db } from '../config/database.js';

export const shiftRepository = {
  async list() {
    const result = await db.query(
      `SELECT code, label, start_time, end_time, is_night, display_order, is_active
         FROM shifts
        WHERE is_active = true
        ORDER BY display_order, code`
    );
    return result.rows;
  },

  async findByCode(code: string) {
    const result = await db.query(`SELECT * FROM shifts WHERE code = $1`, [code]);
    return result.rows[0] || null;
  },
};
