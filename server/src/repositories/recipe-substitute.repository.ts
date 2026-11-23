import { db } from '../config/database.js';
import { withActor } from '../services/production-state.js';
import { BSI_SOURCE } from '../services/stock-roles.js';

/**
 * Substituts d'article (M4-05). Un composant de fiche (recipe_id) — ou de toutes les
 * fiches (recipe_id NULL) — peut être remplacé par un autre article avec un ratio et
 * une priorité. Au bon de sortie, une ligne non pesée bascule sur le substitut :
 * ingredient_id porte l'article réellement consommé (lots FEFO, coût, traçabilité),
 * original_ingredient_id garde l'article prévu.
 */
const usable = (a: string) =>
  `(${a}.status = 'active' AND NOT (${a}.status = 'expired' OR (${a}.expiration_date IS NOT NULL AND ${a}.expiration_date < CURRENT_DATE)))`;

/** Fiches de l'ordre d'un bon : nomenclature choisie sur la ligne (M4-04), sinon fiche par défaut. */
const PLAN_RECIPES_SQL = `
  SELECT COALESCE(ppi.alt_recipe_id, r.id) FROM production_plan_items ppi
    LEFT JOIN recipes r ON r.product_id = ppi.product_id
   WHERE ppi.plan_id = bs.plan_id`;

export const recipeSubstituteRepository = {
  async listForRecipe(recipeId: string) {
    const r = await db.query(
      `SELECT s.*, io.name AS ingredient_name, isub.name AS substitute_name, isub.unit AS substitute_unit,
              (s.recipe_id IS NULL) AS is_global
         FROM recipe_line_substitutes s
         JOIN ingredients io ON io.id = s.ingredient_id
         JOIN ingredients isub ON isub.id = s.substitute_ingredient_id
        WHERE s.recipe_id = $1
           OR (s.recipe_id IS NULL AND s.ingredient_id IN (SELECT ingredient_id FROM recipe_ingredients WHERE recipe_id = $1))
        ORDER BY io.name, s.priority, isub.name`, [recipeId]);
    return r.rows;
  },

  async create(data: { recipeId: string | null; ingredientId: string; substituteIngredientId: string; ratio: number; priority: number; validFrom?: string | null; validTo?: string | null; note?: string | null }, userId: string) {
    const r = await db.query(
      `INSERT INTO recipe_line_substitutes (recipe_id, ingredient_id, substitute_ingredient_id, ratio, priority, valid_from, valid_to, note, created_by)
       VALUES ($1, $2, $3, $4::numeric, $5::int, $6::date, $7::date, $8, $9) RETURNING *`,
      [data.recipeId, data.ingredientId, data.substituteIngredientId, data.ratio, data.priority, data.validFrom ?? null, data.validTo ?? null, data.note ?? null, userId]);
    return r.rows[0];
  },

  async remove(id: string) {
    return (await db.query(`DELETE FROM recipe_line_substitutes WHERE id = $1`, [id])).rowCount! > 0;
  },

  /** Substituts proposés pour une ligne de bon : valides à la date du jour, pour une fiche
   *  de l'ordre ou toutes les fiches, avec quantité nécessaire, stock utilisable et
   *  allergènes ajoutés par rapport à l'article d'origine. */
  async suggestionsForLine(lineId: string) {
    const r = await db.query(
      `SELECT s.id, s.substitute_ingredient_id, isub.name AS substitute_name, isub.unit AS substitute_unit,
              s.ratio, s.priority, s.note, (s.recipe_id IS NULL) AS is_global,
              fn_convert_qty(COALESCE(bsl.original_needed_quantity, bsl.needed_quantity) * s.ratio, bsl.unit, isub.unit, 'ingredient', isub.id) AS needed_quantity,
              COALESCE((SELECT SUM(il.pesage_quantity + il.economat_quantity) FROM ingredient_lots il
                         WHERE il.ingredient_id = isub.id AND il.store_id = bs.store_id AND ${usable('il')}), 0) AS available,
              ARRAY(SELECT unnest(COALESCE(isub.allergens, '{}')) EXCEPT SELECT unnest(COALESCE(io.allergens, '{}'))) AS allergens_added
         FROM production_bons_sortie_lignes bsl
         JOIN production_bons_sortie bs ON bs.id = bsl.bon_id
         JOIN ingredients io ON io.id = COALESCE(bsl.original_ingredient_id, bsl.ingredient_id)
         JOIN recipe_line_substitutes s ON s.ingredient_id = io.id
         JOIN ingredients isub ON isub.id = s.substitute_ingredient_id
        WHERE bsl.id = $1
          AND (s.recipe_id IS NULL OR s.recipe_id IN (${PLAN_RECIPES_SQL}))
          AND (s.valid_from IS NULL OR s.valid_from <= CURRENT_DATE)
          AND (s.valid_to IS NULL OR s.valid_to >= CURRENT_DATE)
          AND s.substitute_ingredient_id <> bsl.ingredient_id
        ORDER BY s.priority, isub.name`, [lineId]);
    return r.rows.map(x => ({ ...x, ratio: Number(x.ratio), needed_quantity: x.needed_quantity == null ? null : Number(x.needed_quantity), available: Number(x.available) }));
  },

  /** Bascule une ligne non pesée sur un substitut proposé. Allocation FEFO : un lot au
   *  pesage qui couvre la quantité, sinon un lot de l'économat à ouvrir, sinon refus. */
  async substituteLine(lineId: string, substitutionId: string, userId: string, reason: string) {
    return withActor(userId, async (client) => {
      const line = (await client.query(
        `SELECT bsl.*, bs.status AS bon_status, bs.store_id
           FROM production_bons_sortie_lignes bsl JOIN production_bons_sortie bs ON bs.id = bsl.bon_id
          WHERE bsl.id = $1 FOR UPDATE OF bsl`, [lineId])).rows[0];
      if (!line) throw new Error('Ligne de bon de sortie introuvable');
      if (!line.ingredient_id) throw new Error('Une ligne emballage ne se substitue pas');
      if (!['genere', 'preparation', 'preparation_partielle'].includes(line.bon_status)) throw new Error(`Bon au statut « ${line.bon_status} » : substitution impossible`);
      if (!['en_attente', 'rupture'].includes(line.status) || line.actual_quantity != null || line.weighed_at) throw new Error('Ligne déjà pesée : substitution impossible');
      const sugg = (await this.suggestionsForLine(lineId)).find(s => s.id === substitutionId);
      if (!sugg) throw new Error('Substitut non applicable à cette ligne (fiche, validité ou article)');
      if (sugg.needed_quantity == null) throw new Error(`Unité ${line.unit} non convertible vers ${sugg.substitute_unit} pour ${sugg.substitute_name}`);
      const qty = sugg.needed_quantity;
      const lot = (await client.query(
        `SELECT il.id, (il.pesage_quantity >= $3::numeric) AS at_pesage FROM ingredient_lots il
          WHERE il.ingredient_id = $1 AND il.store_id = $2 AND ${usable('il')}
            AND il.pesage_quantity + il.economat_quantity >= $3::numeric
          ORDER BY (il.pesage_quantity >= $3::numeric) DESC, il.expiration_date ASC NULLS LAST, il.received_at ASC
          LIMIT 1`, [sugg.substitute_ingredient_id, line.store_id, qty])).rows[0];
      if (!lot) throw new Error(`${sugg.substitute_name} : stock insuffisant (${qty} ${sugg.substitute_unit} nécessaires)`);
      const note = `Substitution : ${reason}`;
      const r = await client.query(
        `UPDATE production_bons_sortie_lignes SET
            original_ingredient_id = COALESCE(original_ingredient_id, ingredient_id),
            original_needed_quantity = COALESCE(original_needed_quantity, needed_quantity),
            ingredient_id = $2, unit = $3, needed_quantity = $4::numeric,
            source_location = CASE WHEN $6::boolean THEN '${BSI_SOURCE.opened}' ELSE '${BSI_SOURCE.toOpen}' END,
            ingredient_lot_id = CASE WHEN $6::boolean THEN $5::uuid ELSE NULL END,
            allocated_quantity = CASE WHEN $6::boolean THEN $4::numeric ELSE 0 END,
            suggested_economat_lot_id = CASE WHEN $6::boolean THEN NULL ELSE $5::uuid END,
            transfer_required_qty = CASE WHEN $6::boolean THEN NULL ELSE $4::numeric END,
            status = 'en_attente', substitution_id = $7, substituted_by = $8, substituted_at = NOW(),
            substitution_reason = $9,
            notes = concat_ws(' · ', NULLIF(notes, ''), $10::text), updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [lineId, sugg.substitute_ingredient_id, sugg.substitute_unit, qty, lot.id, lot.at_pesage, substitutionId, userId, reason, note]);
      return { line: r.rows[0], allergens_added: sugg.allergens_added as string[] };
    });
  },

  /** Allergènes réellement consommés par l'ordre (articles des lignes du bon, substituts
   *  compris), et ceux ajoutés par une substitution par rapport à la fiche. */
  async actualAllergensForPlan(planId: string) {
    const r = await db.query(
      `SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(i.allergens, '{}')) FROM production_bons_sortie_lignes bsl
                      JOIN production_bons_sortie bs ON bs.id = bsl.bon_id JOIN ingredients i ON i.id = bsl.ingredient_id
                     WHERE bs.plan_id = $1 AND bsl.status <> 'annule' ORDER BY 1) AS consumed,
              ARRAY(SELECT DISTINCT unnest(COALESCE(i.allergens, '{}')) FROM production_bons_sortie_lignes bsl
                      JOIN production_bons_sortie bs ON bs.id = bsl.bon_id JOIN ingredients i ON i.id = bsl.ingredient_id
                     WHERE bs.plan_id = $1 AND bsl.original_ingredient_id IS NOT NULL AND bsl.status <> 'annule'
                    EXCEPT
                    SELECT DISTINCT unnest(COALESCE(i.allergens, '{}')) FROM production_bons_sortie_lignes bsl
                      JOIN production_bons_sortie bs ON bs.id = bsl.bon_id JOIN ingredients i ON i.id = COALESCE(bsl.original_ingredient_id, bsl.ingredient_id)
                     WHERE bs.plan_id = $1 AND bsl.status <> 'annule') AS added_by_substitution`, [planId]);
    return r.rows[0];
  },
};
