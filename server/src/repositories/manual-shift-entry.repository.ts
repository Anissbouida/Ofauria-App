import { db } from '../config/database.js';
import { getUserTimezone } from '../utils/timezone.js';

export type ShiftAmounts = {
  matin_cash_reel: number | null;
  matin_cash_systeme: number | null;
  matin_carte_reel: number | null;
  matin_carte_systeme: number | null;
  soir_cash_reel: number | null;
  soir_cash_systeme: number | null;
  soir_carte_reel: number | null;
  soir_carte_systeme: number | null;
  notes: string | null;
};

const NUMERIC_COLUMNS = [
  'matin_cash_reel', 'matin_cash_systeme', 'matin_carte_reel', 'matin_carte_systeme',
  'soir_cash_reel', 'soir_cash_systeme', 'soir_carte_reel', 'soir_carte_systeme',
] as const;

function toNullableNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

export const manualShiftEntryRepository = {
  async findByDateRange(params: { storeId: string; dateFrom?: string; dateTo?: string }) {
    const conditions: string[] = ['store_id = $1'];
    const values: unknown[] = [params.storeId];
    let i = 2;
    if (params.dateFrom) { conditions.push(`entry_date >= $${i++}`); values.push(params.dateFrom); }
    if (params.dateTo) { conditions.push(`entry_date <= $${i++}`); values.push(params.dateTo); }

    const result = await db.query(
      `SELECT * FROM manual_shift_entries
       WHERE ${conditions.join(' AND ')}
       ORDER BY entry_date DESC`,
      values
    );
    return result.rows;
  },

  async findByDate(storeId: string, entryDate: string) {
    const result = await db.query(
      `SELECT * FROM manual_shift_entries WHERE store_id = $1 AND entry_date = $2`,
      [storeId, entryDate]
    );
    return result.rows[0] || null;
  },

  async upsert(params: { storeId: string; entryDate: string; userId: string; data: Partial<ShiftAmounts> }) {
    const cols: string[] = ['store_id', 'entry_date', 'created_by', 'updated_by'];
    const placeholders: string[] = ['$1', '$2', '$3', '$3'];
    const values: unknown[] = [params.storeId, params.entryDate, params.userId];
    let i = 4;

    for (const col of NUMERIC_COLUMNS) {
      if (params.data[col] !== undefined) {
        cols.push(col);
        placeholders.push(`$${i++}`);
        values.push(toNullableNumber(params.data[col]));
      }
    }
    if (params.data.notes !== undefined) {
      cols.push('notes');
      placeholders.push(`$${i++}`);
      values.push(params.data.notes || null);
    }

    const updateAssignments: string[] = ['updated_by = EXCLUDED.updated_by', 'updated_at = NOW()'];
    for (const col of NUMERIC_COLUMNS) {
      if (params.data[col] !== undefined) updateAssignments.push(`${col} = EXCLUDED.${col}`);
    }
    if (params.data.notes !== undefined) updateAssignments.push('notes = EXCLUDED.notes');

    const result = await db.query(
      `INSERT INTO manual_shift_entries (${cols.join(', ')})
       VALUES (${placeholders.join(', ')})
       ON CONFLICT (store_id, entry_date) DO UPDATE SET
         ${updateAssignments.join(', ')}
       RETURNING *`,
      values
    );
    return result.rows[0];
  },

  async delete(storeId: string, entryDate: string) {
    await db.query(
      `DELETE FROM manual_shift_entries WHERE store_id = $1 AND entry_date = $2`,
      [storeId, entryDate]
    );
  },

  // Helper d'usage futur : aujourd'hui dans le fuseau utilisateur
  todayInUserTz(): string {
    const tz = getUserTimezone();
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    return fmt.format(new Date());
  },
};
