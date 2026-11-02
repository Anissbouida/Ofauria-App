import { db } from '../config/database.js';

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
};

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
    const r = await db.query(
      `INSERT INTO stock_locations
         (store_id, code, name, type, parent_id, equipement_id, temp_min, temp_max, capacite_unite, capacite_valeur)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [data.storeId ?? null, data.code, data.name, data.type, data.parentId ?? null,
       data.equipementId ?? null, data.tempMin ?? null, data.tempMax ?? null,
       data.capaciteUnite ?? null, data.capaciteValeur ?? null]
    );
    return r.rows[0];
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
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, data.code ?? null, data.name ?? null, data.type ?? null,
       data.parentId ?? null, data.equipementId ?? null, data.tempMin ?? null,
       data.tempMax ?? null, data.capaciteUnite ?? null, data.capaciteValeur ?? null]
    );
    return r.rows[0] ?? null;
  },

  // Désactivation douce : refusée s'il reste des lots actifs sur l'emplacement.
  async deactivate(id: string) {
    const used = await db.query(
      `SELECT COUNT(*)::int AS n FROM ingredient_lots WHERE location_id = $1 AND status = 'active'`,
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
};
