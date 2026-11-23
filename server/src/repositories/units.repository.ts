import { db } from '../config/database.js';

/**
 * Référentiel des unités (M3-01, mig 554) : unités par dimension avec facteur et
 * décimales, nombre de fiches qui les emploient, lignes dont l'unité n'est pas au
 * référentiel. Lecture seule ; les unités s'ajoutent dans Paramètres › Référentiels.
 */
export const unitsRepository = {
  async overview() {
    const units = (await db.query(
      `SELECT u.id, u.code, u.label, u.dimension, u.factor::float8 AS factor, u.decimals, u.is_system, u.is_base, u.is_active,
              (SELECT COUNT(*)::int FROM ingredients i WHERE i.unit_id = u.id)
            + (SELECT COUNT(*)::int FROM packaging_items p WHERE p.unit_id = u.id) AS items,
              (SELECT COUNT(*)::int FROM recipe_components r WHERE r.unit_id = u.id)
            + (SELECT COUNT(*)::int FROM recipe_format_components r WHERE r.unit_id = u.id) AS composition_lines
         FROM v_units u
        ORDER BY CASE u.dimension WHEN 'masse' THEN 1 WHEN 'volume' THEN 2 WHEN 'piece' THEN 3 WHEN 'longueur' THEN 4
                                  WHEN 'surface' THEN 5 WHEN 'temps' THEN 6 ELSE 9 END, u.factor NULLS LAST, u.code`)).rows;
    const unmatched = (await db.query(
      `SELECT table_name, unit, COUNT(*)::int AS lines, MIN(label) AS example
         FROM v_unit_unmatched GROUP BY 1, 2 ORDER BY 3 DESC`)).rows;
    return { units, unmatched };
  },
};
