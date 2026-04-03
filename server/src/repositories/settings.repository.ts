import { db } from '../config/database.js';

export const settingsRepository = {
  async get() {
    const result = await db.query('SELECT * FROM company_settings WHERE id = 1');
    return result.rows[0];
  },

  async update(data: {
    companyName?: string; subtitle?: string;
    primaryColor?: string; secondaryColor?: string; logoUrl?: string | null;
  }) {
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (data.companyName !== undefined) { fields.push(`company_name = $${i++}`); values.push(data.companyName); }
    if (data.subtitle !== undefined) { fields.push(`subtitle = $${i++}`); values.push(data.subtitle); }
    if (data.primaryColor !== undefined) { fields.push(`primary_color = $${i++}`); values.push(data.primaryColor); }
    if (data.secondaryColor !== undefined) { fields.push(`secondary_color = $${i++}`); values.push(data.secondaryColor); }
    if (data.logoUrl !== undefined) { fields.push(`logo_url = $${i++}`); values.push(data.logoUrl); }
    if (fields.length === 0) return this.get();
    fields.push('updated_at = NOW()');
    const result = await db.query(`UPDATE company_settings SET ${fields.join(', ')} WHERE id = 1 RETURNING *`, values);
    return result.rows[0];
  },
};
