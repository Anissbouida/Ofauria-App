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
  // Lots surgelables (semi-finis + produits) encore en stock, avec leur état
  // thermique et la DLC effective (dlc_effective si décongelé, sinon expires_at).
  async listFreezable(storeId?: string | null, etat?: string | null) {
    const params: unknown[] = [];
    let storeFilter = '';
    if (storeId) { params.push(storeId); storeFilter = ` AND store_id = $${params.length}`; }
    let etatFilter = '';
    if (etat && ['frais', 'surgele', 'decongele'].includes(etat)) {
      params.push(etat); etatFilter = ` WHERE etat_thermique = $${params.length}`;
    }
    const r = await db.query(
      `SELECT * FROM (
         SELECT 'semi'::text AS kind, sl.id, sl.lot_number, r.name AS item_name, 'Semi-fini' AS item_kind,
                sl.quantity_remaining::float AS quantity, sl.unit, sl.etat_thermique,
                sl.surgele_a, sl.decongele_a, sl.dlc_effective, sl.expires_at,
                COALESCE(sl.dlc_effective, sl.expires_at::timestamptz) AS dlc_affichee, sl.produced_at
           FROM semi_finished_lots sl
           JOIN recipes r ON r.id = sl.recipe_id
          WHERE sl.status = 'active' AND sl.quantity_remaining > 0${storeFilter}
         UNION ALL
         SELECT 'product'::text, pl.id, pl.lot_number, p.name, 'Produit',
                (pl.backroom_qty + pl.vitrine_qty)::float, 'pce', pl.etat_thermique,
                pl.surgele_a, pl.decongele_a, pl.dlc_effective, pl.expires_at,
                COALESCE(pl.dlc_effective, pl.expires_at::timestamptz), pl.produced_at
           FROM product_lots pl
           JOIN products p ON p.id = pl.product_id
          WHERE pl.status = 'active' AND (pl.backroom_qty + pl.vitrine_qty) > 0${storeFilter}
       ) t${etatFilter}
       ORDER BY produced_at DESC
       LIMIT 300`,
      params
    );
    return r.rows;
  },

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
