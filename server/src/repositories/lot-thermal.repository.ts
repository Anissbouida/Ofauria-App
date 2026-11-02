import { db } from '../config/database.js';

// Transitions d'état thermique des lots (épic labo L4, mig 426).
// Règles : frais → surgelé ; surgelé → décongelé (une seule fois, recalcule la
// DLC) ; décongelé → surgelé INTERDIT (pas de recongélation). La table est
// choisie par une liste blanche — jamais d'interpolation de saisie utilisateur.

const TABLES: Record<string, string> = {
  semi: 'semi_finished_lots',
  product: 'product_lots',
};
const DEFAULT_THAW_LIFE_HOURS = 48;

function resolveTable(kind: string): string {
  const t = TABLES[kind];
  if (!t) throw Object.assign(new Error('Type de lot inconnu.'), { statusCode: 400 });
  return t;
}

export const lotThermalRepository = {
  async freeze(kind: string, lotId: string) {
    const table = resolveTable(kind);
    const cur = await db.query(`SELECT etat_thermique FROM ${table} WHERE id = $1`, [lotId]);
    if (!cur.rows[0]) return null;
    const etat = cur.rows[0].etat_thermique as string;
    if (etat === 'surgele') throw Object.assign(new Error('Ce lot est déjà surgelé.'), { statusCode: 400 });
    if (etat === 'decongele') throw Object.assign(new Error('Recongélation interdite : ce lot a déjà été décongelé.'), { statusCode: 409 });
    const r = await db.query(
      `UPDATE ${table}
          SET etat_thermique = 'surgele', surgele_a = NOW()
        WHERE id = $1 RETURNING id, etat_thermique, surgele_a`,
      [lotId]
    );
    return r.rows[0];
  },

  async thaw(kind: string, lotId: string, dureeVieHeures?: number | null) {
    const table = resolveTable(kind);
    const cur = await db.query(`SELECT etat_thermique FROM ${table} WHERE id = $1`, [lotId]);
    if (!cur.rows[0]) return null;
    const etat = cur.rows[0].etat_thermique as string;
    if (etat !== 'surgele') {
      throw Object.assign(new Error('Seul un lot surgelé peut être décongelé.'), { statusCode: 400 });
    }
    const hours = dureeVieHeures && dureeVieHeures > 0 ? dureeVieHeures : DEFAULT_THAW_LIFE_HOURS;
    const r = await db.query(
      `UPDATE ${table}
          SET etat_thermique = 'decongele',
              decongele_a = NOW(),
              dlc_effective = NOW() + ($2 || ' hours')::interval
        WHERE id = $1 RETURNING id, etat_thermique, decongele_a, dlc_effective`,
      [lotId, String(hours)]
    );
    return r.rows[0];
  },
};
