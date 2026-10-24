/**
 * Restauration d'une version de recette (mig 346).
 *
 * Re-applique la capture complete (`recipe_versions.snapshot`) : champs de la
 * recette, etapes, frais indirects, ingredients et sous-recettes legacy,
 * composants du miroir, formats et leur nomenclature, emballages.
 *
 * Regles :
 *  - une NOUVELLE version de l'etat courant est posee AVANT de toucher quoi que
 *    ce soit : restaurer n'efface jamais rien, on peut toujours revenir ;
 *  - le lien produit (product_id) et l'archivage ne sont pas restaures : ce
 *    sont des decisions de catalogue, pas de recette ;
 *  - les references disparues (ingredient, sous-recette, emballage supprimes
 *    depuis) sont ignorees et remontees en avertissement ;
 *  - un format de la capture encore present est mis a jour ; disparu, il est
 *    recree ; un format actuel absent de la capture est desactive (is_active =
 *    false, jamais supprime : des plan_items peuvent le referencer) ;
 *  - l'anti-cycle est reverifie : le graphe a pu changer depuis la capture.
 */
import { db } from '../config/database.js';
import { snapshotRecipeVersion } from './recipe-version.helper.js';
import { recipeComponentRepository } from './recipe-component.repository.js';

type Row = Record<string, any>;

export class RecipeRestoreError extends Error {
  code: 'VERSION_NOT_FOUND' | 'NO_SNAPSHOT' | 'RECIPE_CYCLE';
  constructor(code: RecipeRestoreError['code'], message: string) { super(message); this.code = code; }
}

export async function restoreRecipeVersion(recipeId: string, versionNumber: number, userId: string | null) {
  const vRes = await db.query(
    `SELECT snapshot, version_number FROM recipe_versions WHERE recipe_id = $1 AND version_number = $2`,
    [recipeId, versionNumber]
  );
  if (!vRes.rows[0]) throw new RecipeRestoreError('VERSION_NOT_FOUND', `Version ${versionNumber} introuvable`);
  const snapshot = vRes.rows[0].snapshot as {
    recipe: Row; etapes: unknown[]; ingredients: Row[]; sub_recipes: Row[]; components: Row[]; formats: Row[]; packaging: Row[];
  } | null;
  if (!snapshot?.recipe) {
    throw new RecipeRestoreError('NO_SNAPSHOT', `La version ${versionNumber} date d'avant la capture complete (mig 346) : elle ne contient pas la nomenclature, elle ne peut pas etre restauree.`);
  }
  const warnings: string[] = [];

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT id FROM recipes WHERE id = $1 FOR UPDATE`, [recipeId]);

    // Anti-cycle sur les sous-recettes de la capture (miroir + formats).
    const childIds = Array.from(new Set<string>([
      ...snapshot.components.map(c => c.source_recipe_id).filter(Boolean),
      ...snapshot.sub_recipes.map(s => s.sub_recipe_id).filter(Boolean),
      ...snapshot.formats.flatMap(f => (f.components || []).map((c: Row) => c.source_recipe_id)).filter(Boolean),
    ]));
    if (childIds.length > 0) {
      const existing = await client.query(`SELECT id FROM recipes WHERE id = ANY($1::uuid[])`, [childIds]);
      const present = new Set(existing.rows.map((r: Row) => r.id));
      const cyclic = await recipeComponentRepository.detectComponentCycle(recipeId, childIds.filter(id => present.has(id)), client);
      if (cyclic.length > 0) {
        throw new RecipeRestoreError('RECIPE_CYCLE', `Restauration refusee : « ${cyclic.join(' », « ')} » contient desormais cette recette (cycle).`);
      }
    }

    // 1. Version de l'etat COURANT, avant toute modification.
    const newVersion = await snapshotRecipeVersion(client, recipeId, userId, `Avant restauration de la version ${versionNumber}`);

    // 2. Champs de la recette (ni product_id, ni archivage).
    const r = snapshot.recipe;
    await client.query(
      `UPDATE recipes SET
         name = $2, instructions = $3, is_base = COALESCE($4, is_base), category_id = $5, contenant_id = $6,
         yield_quantity = COALESCE($7, yield_quantity), yield_unit = COALESCE($8, yield_unit), piece_weight_kg = $9,
         pieces_par_fournee = $10, compo_par_piece = COALESCE($11, compo_par_piece),
         mode_cout = COALESCE($12, mode_cout), perte_standard_pct = COALESCE($13, perte_standard_pct),
         margin_multiplier = COALESCE($14, margin_multiplier),
         taux_main_oeuvre_dh_h = COALESCE($15, taux_main_oeuvre_dh_h), main_oeuvre_min = $16,
         cout_energie_fournee = COALESCE($17, cout_energie_fournee), taux_frais_structure_pct = COALESCE($18, taux_frais_structure_pct),
         temperature_pate_cible_c = $19, hydratation_pct = $20,
         etapes = $21, total_cost = 0, updated_at = NOW()
       WHERE id = $1`,
      [recipeId, r.name, r.instructions ?? null, r.is_base ?? null, r.category_id ?? null, r.contenant_id ?? null,
       r.yield_quantity ?? null, r.yield_unit ?? null, r.piece_weight_kg ?? null,
       r.pieces_par_fournee ?? null, r.compo_par_piece ?? null,
       r.mode_cout ?? null, r.perte_standard_pct ?? null, r.margin_multiplier ?? null,
       r.taux_main_oeuvre_dh_h ?? null, r.main_oeuvre_min ?? null,
       r.cout_energie_fournee ?? null, r.taux_frais_structure_pct ?? null,
       r.temperature_pate_cible_c ?? null, r.hydratation_pct ?? null,
       JSON.stringify(snapshot.etapes ?? [])]
    );

    // 3. Legacy : ingredients et sous-recettes.
    await client.query(`DELETE FROM recipe_ingredients WHERE recipe_id = $1`, [recipeId]);
    for (const ing of snapshot.ingredients) {
      const ok = await client.query(`SELECT 1 FROM ingredients WHERE id = $1`, [ing.ingredient_id]);
      if (!ok.rows[0]) { warnings.push(`Ingredient disparu ignore : ${ing.ingredient_name || ing.ingredient_id}`); continue; }
      await client.query(
        `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ($1, $2, $3, $4)`,
        [recipeId, ing.ingredient_id, ing.quantity, ing.unit ?? null]
      );
    }
    await client.query(`DELETE FROM recipe_sub_recipes WHERE recipe_id = $1`, [recipeId]);
    for (const sr of snapshot.sub_recipes) {
      const ok = await client.query(`SELECT 1 FROM recipes WHERE id = $1`, [sr.sub_recipe_id]);
      if (!ok.rows[0]) { warnings.push(`Sous-recette disparue ignoree : ${sr.sub_recipe_name || sr.sub_recipe_id}`); continue; }
      await client.query(
        `INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ($1, $2, $3)`,
        [recipeId, sr.sub_recipe_id, sr.quantity]
      );
    }

    // 4. Miroir compose.
    const insertComponents = async (table: 'recipe_components' | 'recipe_format_components', ownerCol: string, ownerId: string, comps: Row[]) => {
      for (const c of comps) {
        if (c.source_ingredient_id) {
          const ok = await client.query(`SELECT 1 FROM ingredients WHERE id = $1`, [c.source_ingredient_id]);
          if (!ok.rows[0]) { warnings.push(`Composant ingredient disparu ignore : ${c.source_ingredient_name || c.source_ingredient_id}`); continue; }
        }
        if (c.source_recipe_id) {
          const ok = await client.query(`SELECT 1 FROM recipes WHERE id = $1`, [c.source_recipe_id]);
          if (!ok.rows[0]) { warnings.push(`Composant recette disparu ignore : ${c.source_recipe_name || c.source_recipe_id}`); continue; }
        }
        await client.query(
          `INSERT INTO ${table} (${ownerCol}, role, source_recipe_id, source_ingredient_id, quantite, unite, ordre, perte_pct)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [ownerId, c.role ?? null, c.source_recipe_id ?? null, c.source_ingredient_id ?? null,
           c.quantite, c.unite ?? 'g', c.ordre ?? 0, c.perte_pct ?? 0]
        );
      }
    };
    await client.query(`DELETE FROM recipe_components WHERE recipe_id = $1`, [recipeId]);
    await insertComponents('recipe_components', 'recipe_id', recipeId, snapshot.components);

    // 5. Formats : mise a jour si present, creation sinon, desactivation des absents.
    const keepIds: string[] = [];
    for (const f of snapshot.formats) {
      const exists = f.id ? await client.query(`SELECT id FROM recipe_formats WHERE id = $1 AND recipe_id = $2`, [f.id, recipeId]) : { rows: [] };
      let formatId: string;
      if (exists.rows[0]) {
        formatId = f.id;
        await client.query(
          `UPDATE recipe_formats SET contenant_id = $2, quantite_par_format = $3, quantite_par_format_unite = COALESCE($4, quantite_par_format_unite),
             nb_par_defaut = COALESCE($5, nb_par_defaut), nb_parts = $6, poids_cru_g = $7, poids_cuit_g = $8, densite_kg_l = $9,
             cout_emballage_unitaire = COALESCE($10, cout_emballage_unitaire), is_default = COALESCE($11, is_default), is_active = COALESCE($12, true),
             product_id = $13, prix_vente_unitaire_override = $14, margin_multiplier_override = $15, updated_at = NOW()
           WHERE id = $1`,
          [formatId, f.contenant_id ?? null, f.quantite_par_format, f.quantite_par_format_unite ?? null, f.nb_par_defaut ?? null,
           f.nb_parts ?? null, f.poids_cru_g ?? null, f.poids_cuit_g ?? null, f.densite_kg_l ?? null, f.cout_emballage_unitaire ?? null,
           f.is_default ?? null, f.is_active ?? true, f.product_id ?? null, f.prix_vente_unitaire_override ?? null, f.margin_multiplier_override ?? null]
        );
      } else {
        const created = await client.query(
          `INSERT INTO recipe_formats (recipe_id, contenant_id, quantite_par_format, quantite_par_format_unite, nb_par_defaut, nb_parts,
             poids_cru_g, poids_cuit_g, densite_kg_l, cout_emballage_unitaire, is_default, is_active, product_id,
             prix_vente_unitaire_override, margin_multiplier_override)
           VALUES ($1, $2, $3, COALESCE($4, 'g'), COALESCE($5, 1), $6, $7, $8, $9, COALESCE($10, 0), COALESCE($11, false), true, $12, $13, $14)
           RETURNING id`,
          [recipeId, f.contenant_id ?? null, f.quantite_par_format, f.quantite_par_format_unite ?? null, f.nb_par_defaut ?? null,
           f.nb_parts ?? null, f.poids_cru_g ?? null, f.poids_cuit_g ?? null, f.densite_kg_l ?? null, f.cout_emballage_unitaire ?? null,
           f.is_default ?? null, f.product_id ?? null, f.prix_vente_unitaire_override ?? null, f.margin_multiplier_override ?? null]
        );
        formatId = created.rows[0].id;
        warnings.push(`Format recree (l'original avait ete supprime)`);
      }
      keepIds.push(formatId);
      await client.query(`DELETE FROM recipe_format_components WHERE format_id = $1`, [formatId]);
      await insertComponents('recipe_format_components', 'format_id', formatId, f.components || []);
    }
    const deactivated = await client.query(
      `UPDATE recipe_formats SET is_active = false, is_default = false, updated_at = NOW()
       WHERE recipe_id = $1 AND is_active = true AND NOT (id = ANY($2::uuid[])) RETURNING id`,
      [recipeId, keepIds]
    );
    if ((deactivated.rowCount ?? 0) > 0) warnings.push(`${deactivated.rowCount} format(s) absent(s) de la version desactive(s)`);

    // 6. Emballages.
    await client.query(`DELETE FROM recipe_packaging WHERE recipe_id = $1`, [recipeId]);
    for (const pk of snapshot.packaging ?? []) {
      const ok = await client.query(`SELECT 1 FROM packaging_items WHERE id = $1`, [pk.packaging_id]);
      if (!ok.rows[0]) { warnings.push(`Emballage disparu ignore : ${pk.packaging_name || pk.packaging_id}`); continue; }
      await client.query(
        `INSERT INTO recipe_packaging (recipe_id, packaging_id, quantity, unit) VALUES ($1, $2, $3, $4)`,
        [recipeId, pk.packaging_id, pk.quantity, pk.unit ?? null]
      );
    }

    await client.query('COMMIT');
    return { restoredFrom: versionNumber, newVersion, warnings };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
