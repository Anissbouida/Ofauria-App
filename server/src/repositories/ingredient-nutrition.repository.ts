import { db } from '../config/database.js';

/**
 * Valeurs nutritionnelles d'une matière, pour 100 g (étape 2 bis, mig 634). Servent au calcul
 * de la déclaration nutritionnelle de l'étiquette (product-label.repository). Une clé absente
 * ou nulle = valeur inconnue ; un objet vide = rien de connu.
 */
export const ingredientNutritionRepository = {
  /** Valeurs enregistrées d'une matière (écran de la fiche matière, étape 10c). */
  async get(ingredientId: string): Promise<Record<string, number> | null | undefined> {
    const r = (await db.query(`SELECT nutrition FROM ingredients WHERE id = $1`, [ingredientId])).rows[0];
    return r ? (r.nutrition ?? null) : undefined;
  },

  async save(ingredientId: string, nutrition: Record<string, number | null> | null): Promise<{ id: string; nutrition: unknown } | null> {
    const clean = nutrition
      ? Object.fromEntries(Object.entries(nutrition).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)))
      : null;
    const r = await db.query(
      `UPDATE ingredients SET nutrition = $2::jsonb WHERE id = $1 RETURNING id, nutrition`,
      [ingredientId, clean && Object.keys(clean).length ? JSON.stringify(clean) : null]);
    return r.rows[0] ?? null;
  },
};
