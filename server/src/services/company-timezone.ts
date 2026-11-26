import { db } from '../config/database.js';
import { setCompanyTimezone } from '../utils/timezone.js';
import { logger } from '../utils/logger.js';

/**
 * Charge le fuseau de la société (company_settings.timezone, mig 674) dans le cache lu par
 * businessTz() (audit des profils). Appelé au démarrage, comme la devise, et après l'application
 * de la configuration. Base sans la colonne ou valeur hors liste blanche : fuseau par défaut.
 */
export async function loadCompanyTimezone(): Promise<void> {
  try {
    const has = (await db.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'company_settings' AND column_name = 'timezone') AS ok`)).rows[0]?.ok;
    if (!has) return;
    const tz = (await db.query(`SELECT timezone FROM company_settings WHERE id = 1`)).rows[0]?.timezone as string | undefined;
    setCompanyTimezone(tz ?? null);
  } catch (err) {
    logger.warn({ err: String(err) }, 'fuseau de la société non chargé : fuseau par défaut');
  }
}
