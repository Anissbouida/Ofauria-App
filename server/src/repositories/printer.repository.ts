import { db } from '../config/database.js';
import type { PrinterConfigRow } from '../services/printer.service.js';

export const printerRepository = {
  async findAll(storeId: string) {
    const result = await db.query(
      `SELECT * FROM printer_configs WHERE store_id = $1 ORDER BY type, name`,
      [storeId]
    );
    return result.rows;
  },

  async findById(id: string) {
    const result = await db.query(
      `SELECT * FROM printer_configs WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  },

  async create(data: {
    storeId: string;
    name: string;
    type: 'receipt' | 'kitchen' | 'label';
    interface: 'tcp' | 'usb' | 'serial';
    connectionString: string;
    printerModel?: string;
    characterSet?: string;
    paperWidth?: number;
    isDefault?: boolean;
    openDrawerOnCash?: boolean;
    notes?: string;
  }) {
    // Si on cree comme default, on devalide les autres defaults du meme type/store
    if (data.isDefault) {
      await db.query(
        `UPDATE printer_configs SET is_default = false
          WHERE store_id = $1 AND type = $2 AND is_default = true`,
        [data.storeId, data.type]
      );
    }

    const result = await db.query(
      `INSERT INTO printer_configs
        (store_id, name, type, interface, connection_string, printer_model,
         character_set, paper_width, is_default, open_drawer_on_cash, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        data.storeId, data.name, data.type, data.interface, data.connectionString,
        data.printerModel || 'EPSON', data.characterSet || 'PC437_USA',
        data.paperWidth || 48, !!data.isDefault,
        data.openDrawerOnCash !== false, data.notes || null,
      ]
    );
    return result.rows[0];
  },

  async update(id: string, data: Record<string, unknown>) {
    const mapping: Record<string, string> = {
      name: 'name', type: 'type', interface: 'interface',
      connectionString: 'connection_string', printerModel: 'printer_model',
      characterSet: 'character_set', paperWidth: 'paper_width',
      isActive: 'is_active', openDrawerOnCash: 'open_drawer_on_cash',
      notes: 'notes',
    };

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, col] of Object.entries(mapping)) {
      if (data[key] !== undefined) { fields.push(`${col} = $${i++}`); values.push(data[key]); }
    }

    // is_default a part : si on passe a true, retirer les autres defaults du
    // meme (store, type) en transaction.
    if (data.isDefault === true) {
      const existing = await this.findById(id);
      if (existing) {
        await db.query(
          `UPDATE printer_configs SET is_default = false
            WHERE store_id = $1 AND type = $2 AND is_default = true AND id <> $3`,
          [existing.store_id, existing.type, id]
        );
      }
      fields.push(`is_default = $${i++}`);
      values.push(true);
    } else if (data.isDefault === false) {
      fields.push(`is_default = $${i++}`);
      values.push(false);
    }

    fields.push(`updated_at = NOW()`);

    if (fields.length === 1) return this.findById(id);  // que updated_at
    values.push(id);
    const result = await db.query(
      `UPDATE printer_configs SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    return result.rows[0];
  },

  async delete(id: string) {
    await db.query(`DELETE FROM printer_configs WHERE id = $1`, [id]);
  },
};
