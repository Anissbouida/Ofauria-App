import { db } from '../config/database.js';
import { getUserTimezone } from '../utils/timezone.js';
import { FLAGS } from '../config/feature-flags.js';
import { regenerateShiftEntry, regenerateSaleEntry, reverseEntriesForSource } from '../services/journal-generator.service.js';

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
    const entry = result.rows[0];

    // Comptabilisation : (re)genere l'ecriture des ventes du jour. SAVEPOINT-like
    // isolation via try/catch propre — la saisie reste enregistree si la compta
    // echoue (regenerable via le backfill).
    //
    // C11 — Avant : simple console.error, saisie enregistree, ledger
    // desynchronise sans signal a l'operateur -> divergence CA du mois.
    // Desormais : on renseigne ledger_status/ledger_error sur la ligne pour
    // que l'UI puisse afficher l'echec, ET on remonte l'erreur dans le retour
    // pour que le controller reponde en 207 (multi-status) au lieu de 200.
    if (FLAGS.LEDGER_AUTOGEN && entry?.id) {
      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        await regenerateShiftEntry(client, entry.id, params.userId);
        await client.query('COMMIT');
        entry.ledger_status = 'ok';
      } catch (err) {
        await client.query('ROLLBACK');
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error('[ledger] generation echec saisie shift', entry.id, msg);
        entry.ledger_status = 'failed';
        entry.ledger_error = msg;
      } finally {
        client.release();
      }
    }
    return entry;
  },

  async delete(storeId: string, entryDate: string) {
    const existing = await db.query(
      `SELECT id FROM manual_shift_entries WHERE store_id = $1 AND entry_date = $2`,
      [storeId, entryDate]
    );
    const id = existing.rows[0]?.id;

    if (FLAGS.LEDGER_AUTOGEN && id) {
      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        await reverseEntriesForSource(client, { sourceId: id, sourceKinds: ['shift_entry', 'backfill'] });
        await client.query(`DELETE FROM manual_shift_entries WHERE id = $1`, [id]);
        // La saisie manuelle n'est plus autoritaire ce jour-la : re-comptabiliser
        // les ventes POS du jour (qui etaient supprimees au profit du manuel).
        // C7 — DATE en local (Africa/Casablanca) pour matcher entry_date
        // saisie en local ; sinon les ventes 00h-01h sont ratees et le
        // ledger reste desynchronise apres suppression de la saisie manuelle.
        const posSales = await client.query(
          `SELECT id FROM sales WHERE store_id = $1 AND payment_status = 'paid'
             AND DATE(COALESCE(paid_at, created_at) AT TIME ZONE 'Africa/Casablanca') = $2::date`,
          [storeId, entryDate]
        );
        for (const ps of posSales.rows) {
          await regenerateSaleEntry(client, ps.id, null);
        }
        await client.query('COMMIT');
        return;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

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
