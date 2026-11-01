import { db } from '../config/database.js';

/**
 * Saisies manuelles de caisse (mig 149) — béquille du temps où le POS n'était
 * pas en production. Retirées le 2026-11 (mig 415, table gelée) : les recettes
 * viennent des fermetures de caisse du POS. On ne garde que la lecture, pour
 * l'historique : les jours saisis restent autoritaires sur les ventes POS du
 * même jour (fromSale, registre de caisse, synthèse des ventes).
 */
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
};
