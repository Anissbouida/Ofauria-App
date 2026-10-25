import { db } from '../config/database.js';

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/**
 * Cout MATIERES unitaire d'un produit fini, pour valoriser une perte
 * (F-020 pertes de production, F-062 pertes DLC/perime).
 *
 * Source : v_product_unit_cost (mig 317) =
 *   1. cout matieres unitaire du format par defaut (cout_matiere_unitaire),
 *   2. sinon cout matieres de la recette = v_recipe_total_cost / rendement
 *      (ingredients + emballages + sous-recettes), SANS main-d'oeuvre ni frais
 *      indirects (ce n'est PAS le cout complet),
 *   3. sinon cost_price manuel quand il ressemble a un vrai cout.
 *
 * On ajoute products.cost_price en dernier filet pour ne JAMAIS valoriser moins
 * qu'avant ce correctif, et 0 seulement quand aucun cout n'est connu (le
 * registre des pertes le signale alors comme « cout manquant »).
 *
 * On n'utilise JAMAIS le prix de vente comme proxy de cout : une perte
 * valorisee au prix catalogue serait surevaluee de la marge.
 *
 * Le fragment SQL equivalent, pour les sites ensemblistes / avec JOIN :
 *   LEFT JOIN v_product_unit_cost vpuc ON vpuc.product_id = <pid>
 *   COALESCE(vpuc.unit_cost, <table>.cost_price, 0)
 */
export async function productMaterialsUnitCost(client: Queryable, productId: string): Promise<number> {
  const r = await client.query(
    `SELECT COALESCE(
              (SELECT unit_cost FROM v_product_unit_cost WHERE product_id = $1),
              (SELECT cost_price FROM products WHERE id = $1),
              0)::numeric AS cost`,
    [productId]
  );
  return parseFloat(String(r.rows[0]?.cost ?? 0)) || 0;
}

/** Variante hors transaction (pool partage). */
export function productMaterialsUnitCostDb(productId: string): Promise<number> {
  return productMaterialsUnitCost(db, productId);
}
