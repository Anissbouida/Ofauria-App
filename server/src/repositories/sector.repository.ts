import { db } from '../config/database.js';

/**
 * Secteur d'activité (packs secteur, mig 468). Le secteur de la société est dans
 * company_settings.sector_pack ; chaque pack active une liste de modules. Le reste
 * du code lit `modules` (capacités), jamais le code du secteur : ajouter un secteur
 * = une ligne dans sector_packs, sans toucher au code.
 */
export type SectorPack = { code: string; label: string; modules: string[]; is_default: boolean };

export const sectorRepository = {
  /** Tous les secteurs disponibles. */
  async list(): Promise<SectorPack[]> {
    const { rows } = await db.query(
      `SELECT code, label, enabled_modules AS modules, is_default FROM sector_packs ORDER BY is_default DESC, label`);
    return rows.map(r => ({ code: r.code, label: r.label, modules: r.modules ?? [], is_default: r.is_default }));
  },

  /** Secteur courant de la société + ses modules activés. Repli sur le pack par
   *  défaut si company_settings.sector_pack est vide ou pointe un code inconnu. */
  async current(): Promise<SectorPack> {
    const { rows } = await db.query(
      `SELECT sp.code, sp.label, sp.enabled_modules AS modules, sp.is_default
         FROM company_settings cs
         JOIN sector_packs sp ON sp.code = cs.sector_pack
        WHERE cs.id = 1`);
    if (rows[0]) return { code: rows[0].code, label: rows[0].label, modules: rows[0].modules ?? [], is_default: rows[0].is_default };
    const { rows: def } = await db.query(
      `SELECT code, label, enabled_modules AS modules, is_default FROM sector_packs ORDER BY is_default DESC LIMIT 1`);
    return def[0] ? { code: def[0].code, label: def[0].label, modules: def[0].modules ?? [], is_default: def[0].is_default } : { code: 'boulangerie', label: 'Boulangerie / Pâtisserie', modules: [], is_default: true };
  },

  /** Libellés d'un secteur (phase 9.1) : clé neutre → valeur affichée. */
  async labels(code: string): Promise<Record<string, string>> {
    const { rows } = await db.query(`SELECT label_key, label_value FROM sector_labels WHERE sector_pack = $1`, [code]);
    const map: Record<string, string> = {};
    for (const r of rows) map[r.label_key] = r.label_value;
    return map;
  },

  /** Change le secteur de la société. Renvoie null si le code n'existe pas. */
  async setSector(code: string): Promise<SectorPack | null> {
    const exists = (await db.query(`SELECT 1 FROM sector_packs WHERE code = $1`, [code])).rows[0];
    if (!exists) return null;
    await db.query(`UPDATE company_settings SET sector_pack = $1, updated_at = now() WHERE id = 1`, [code]);
    return this.current();
  },
};
