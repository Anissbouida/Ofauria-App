import { db, withTransaction } from '../config/database.js';

// Référentiel d'emplacements de stock (épic labo L1, mig 424).
// La plage de température affichée hérite de l'équipement lié quand l'emplacement
// ne la surcharge pas (COALESCE loc → équipement).

export type StockLocationInput = {
  storeId?: string | null;
  code: string;
  name: string;
  type: string;
  parentId?: string | null;
  equipementId?: string | null;
  tempMin?: number | null;
  tempMax?: number | null;
  capaciteUnite?: string | null;
  capaciteValeur?: number | null;
  /** Étape 8 : rôle métier (déduit du type si absent) ; emplacement par défaut de ce rôle. */
  role?: string | null;
  roleDefault?: boolean;
};

/** Un seul emplacement par défaut par établissement et par rôle : le nouveau remplace l'ancien. */
async function claimRoleDefault(id: string) {
  await db.query(
    `UPDATE stock_locations o SET role_default = false
       FROM stock_locations n
      WHERE n.id = $1 AND o.id <> n.id AND o.store_id IS NOT DISTINCT FROM n.store_id AND o.role = n.role AND o.role_default`, [id]);
  await db.query(`UPDATE stock_locations SET role_default = true WHERE id = $1`, [id]);
}

export const stockLocationRepository = {
  async list(storeId?: string | null, includeInactive = false) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (storeId) { params.push(storeId); where.push(`(l.store_id = $${params.length} OR l.store_id IS NULL)`); }
    if (!includeInactive) where.push('l.is_active');
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const r = await db.query(
      `SELECT l.*,
              COALESCE(l.temp_min, e.temp_min) AS temp_min_effectif,
              COALESCE(l.temp_max, e.temp_max) AS temp_max_effectif,
              e.nom AS equipement_nom,
              p.code AS parent_code, p.name AS parent_name,
              (SELECT COUNT(*)::int FROM ingredient_lots il
                WHERE il.location_id = l.id AND il.status = 'active') AS lot_count
         FROM stock_locations l
         LEFT JOIN production_equipements e ON e.id = l.equipement_id
         LEFT JOIN stock_locations p ON p.id = l.parent_id
         ${clause}
        ORDER BY l.type, l.code`,
      params
    );
    return r.rows;
  },

  async findById(id: string) {
    const r = await db.query(`SELECT * FROM stock_locations WHERE id = $1`, [id]);
    return r.rows[0] ?? null;
  },

  async create(data: StockLocationInput) {
    return withTransaction(async () => {
      const r = await db.query(
        `INSERT INTO stock_locations
           (store_id, code, name, type, parent_id, equipement_id, temp_min, temp_max, capacite_unite, capacite_valeur, role)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [data.storeId ?? null, data.code, data.name, data.type, data.parentId ?? null,
         data.equipementId ?? null, data.tempMin ?? null, data.tempMax ?? null,
         data.capaciteUnite ?? null, data.capaciteValeur ?? null, data.role ?? null]
      );
      // Premier emplacement de son rôle dans l'établissement, ou demandé : il devient celui par défaut.
      const row = r.rows[0];
      const has = (await db.query(
        `SELECT 1 FROM stock_locations WHERE id <> $1 AND store_id IS NOT DISTINCT FROM $2 AND role = $3 AND role_default AND is_active`,
        [row.id, row.store_id, row.role])).rows.length > 0;
      if (data.roleDefault || !has) await claimRoleDefault(row.id);
      return (await db.query(`SELECT * FROM stock_locations WHERE id = $1`, [row.id])).rows[0];
    });
  },

  // Mise à jour partielle (COALESCE) : un champ absent reste inchangé ; les liens
  // (parent, équipement) et la plage se vident explicitement avec null via le flag.
  async update(id: string, data: Partial<StockLocationInput>) {
    const r = await db.query(
      `UPDATE stock_locations SET
         code = COALESCE($2, code),
         name = COALESCE($3, name),
         type = COALESCE($4, type),
         parent_id = $5,
         equipement_id = $6,
         temp_min = $7,
         temp_max = $8,
         capacite_unite = $9,
         capacite_valeur = $10,
         role = COALESCE($11, role),
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, data.code ?? null, data.name ?? null, data.type ?? null,
       data.parentId ?? null, data.equipementId ?? null, data.tempMin ?? null,
       data.tempMax ?? null, data.capaciteUnite ?? null, data.capaciteValeur ?? null, data.role ?? null]
    );
    if (r.rows[0] && data.roleDefault) await claimRoleDefault(id);
    return r.rows[0] ? (await db.query(`SELECT * FROM stock_locations WHERE id = $1`, [id])).rows[0] : null;
  },

  // Désactivation douce : refusée s'il reste des lots actifs sur l'emplacement.
  async deactivate(id: string) {
    const used = await db.query(
      // M6-02 (mig 605) : les lots produits finis rangés comptent aussi.
      `SELECT ((SELECT COUNT(*) FROM ingredient_lots WHERE location_id = $1 AND status = 'active')
             + (SELECT COUNT(*) FROM product_lot_locations WHERE location_id = $1 AND quantity > 0))::int AS n`,
      [id]
    );
    if (used.rows[0].n > 0) {
      throw Object.assign(new Error(`Emplacement occupé par ${used.rows[0].n} lot(s) actif(s) : videz-le d'abord.`), { statusCode: 409 });
    }
    const r = await db.query(
      `UPDATE stock_locations SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id`,
      [id]
    );
    return r.rows[0] ?? null;
  },

  /* ── Stock par lot et par emplacement (M6-02, mig 570) ── */
  /** Quantités par emplacement de l'établissement : total, nombre de lots. */
  async stockByLocation(storeId: string | null) {
    return (await db.query(
      `SELECT sl.id, sl.code, sl.name, sl.type, sl.role, sl.role_default, COALESCE(SUM(ll.quantity), 0)::float8 AS quantity,
              COUNT(ll.ingredient_lot_id) FILTER (WHERE ll.quantity > 0)::int AS lots
         FROM stock_locations sl
         LEFT JOIN ingredient_lot_locations ll ON ll.location_id = sl.id
        WHERE sl.is_active AND ($1::uuid IS NULL OR sl.store_id = $1)
        GROUP BY sl.id ORDER BY sl.name`, [storeId])).rows;
  },
  /** Répartition d'un lot entre emplacements. */
  async lotLocations(lotId: string) {
    return (await db.query(
      `SELECT ll.location_id, sl.code, sl.name, ll.quantity::float8 AS quantity
         FROM ingredient_lot_locations ll JOIN stock_locations sl ON sl.id = ll.location_id
        WHERE ll.ingredient_lot_id = $1 AND ll.quantity > 0 ORDER BY sl.name`, [lotId])).rows;
  },
  /** Contrôle M6-02 / M6-04 : lots dont Σ emplacements ≠ zones ou ≠ quantité restante. */
  async balanceMismatches() {
    return (await db.query(
      `SELECT ingredient_lot_id, quantity_remaining::float8, zones_total::float8, locations_total::float8 FROM v_lot_location_balance
        WHERE abs(locations_total - zones_total) > 0.0001 OR abs(zones_total - quantity_remaining) > 0.0001`)).rows;
  },
};
