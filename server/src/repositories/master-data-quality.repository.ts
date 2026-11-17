import { db } from '../config/database.js';

/**
 * Qualité des données maîtres (G2-02) : les compteurs de l'écran Paramètres › Qualité des
 * données, et la liste à corriger de chacun. LECTURE SEULE.
 *
 * Mêmes définitions que server/scripts/diagnose-master-data.sql (G2-01, à lancer en
 * production) — garder les deux alignés :
 *   fiche active        : recette non archivée
 *   format actif        : recipe_formats.is_active d'une fiche active
 *   allergènes à saisir : fiche jamais vérifiée (allergens_reviewed_at NULL, mig 541) et
 *                         sans allergène
 *   homonymes           : même nom sans tenir compte de la casse ni des espaces
 *   prix aberrant       : plus de 5 fois la médiane des ingrédients de même catégorie et
 *                         de même unité, ou moins du cinquième (au moins 5 ingrédients)
 *   jamais produite     : aucune ligne de plan pour la fiche ou son produit
 */
export type QualityKey =
  | 'formats_sans_poids_cuit' | 'ingredients_sans_allergenes' | 'fiches_sans_etapes'
  | 'ingredients_homonymes' | 'ingredients_sans_prix' | 'prix_aberrants' | 'fiches_jamais_produites';

export type QualityItem = { id: string; kind: 'recipe' | 'ingredient'; label: string; detail: string };
export type QualityIndicator = {
  key: QualityKey; label: string; help: string; task: string;
  toFix: number; total: number;
  /** Colonne « détail » de la liste. */
  detailLabel: string;
};

const ACTIVE_RECIPES = `recipes r WHERE r.archived_at IS NULL`;
const NO_STEPS = `(r.etapes IS NULL OR jsonb_typeof(r.etapes) <> 'array' OR jsonb_array_length(r.etapes) = 0)`;
const PLAN_LINES = `(SELECT COUNT(*) FROM production_plan_items ppi
                      WHERE ppi.base_recipe_id = r.id OR (r.product_id IS NOT NULL AND ppi.product_id = r.product_id))`;
/** Ingrédients valorisés avec la médiane de leur catégorie et de leur unité. */
const PRICED_CTE = `
  med AS (
    SELECT category_id, unit, percentile_cont(0.5) WITHIN GROUP (ORDER BY unit_cost) AS median, COUNT(*) AS n
      FROM ingredients WHERE unit_cost > 0 AND category_id IS NOT NULL GROUP BY category_id, unit
  ),
  priced AS (
    SELECT i.id, i.name, i.category_id, i.unit, i.unit_cost, m.median, m.n
      FROM ingredients i JOIN med m ON m.category_id = i.category_id AND m.unit = i.unit
     WHERE i.unit_cost > 0
  )`;
const ABERRANT = `p.n >= 5 AND p.median > 0 AND (p.unit_cost > p.median * 5 OR p.unit_cost < p.median / 5)`;

const DEFS: Omit<QualityIndicator, 'toFix' | 'total'>[] = [
  { key: 'formats_sans_poids_cuit', task: 'G2-05', label: 'Formats sans poids cuit', detailLabel: 'Format',
    help: 'Sans poids cuit, ni la perte à la cuisson ni le poids net de l\'étiquette ne peuvent être calculés.' },
  { key: 'ingredients_sans_allergenes', task: 'G2-06', label: 'Ingrédients sans allergènes renseignés', detailLabel: 'Catégorie',
    help: 'Les allergènes d\'un produit sont la somme de ceux de ses ingrédients : sans eux, pas d\'étiquette réglementaire.' },
  { key: 'fiches_sans_etapes', task: 'G2-07', label: 'Fiches actives sans étapes', detailLabel: 'Lignes de plan',
    help: 'Sans étapes, pas de mode opératoire, de rétro-planning ni de temps de main-d\'œuvre. Les plus produites d\'abord.' },
  { key: 'ingredients_homonymes', task: 'G2-03', label: 'Ingrédients en double', detailLabel: 'Prix',
    help: 'Plusieurs fiches portent le même nom : le stock et le coût sont répartis entre elles. À fusionner.' },
  { key: 'ingredients_sans_prix', task: 'G2-04', label: 'Ingrédients sans prix', detailLabel: 'Unité',
    help: 'Un ingrédient à 0 fausse le coût de toutes les fiches qui l\'utilisent.' },
  { key: 'prix_aberrants', task: 'G2-04', label: 'Prix unitaires aberrants', detailLabel: 'Prix et médiane de la catégorie',
    help: 'Prix plus de cinq fois au-dessus ou au-dessous de la médiane des ingrédients de même catégorie et de même unité.' },
  { key: 'fiches_jamais_produites', task: 'G2-08', label: 'Fiches actives jamais produites', detailLabel: 'Créée le',
    help: 'Fiches sans aucune ligne de plan de production : à archiver après revue, ou à laisser si elles sont nouvelles.' },
];

export const masterDataQualityRepository = {
  /** Les sept compteurs : à corriger / total. */
  async summary(): Promise<QualityIndicator[]> {
    const r = (await db.query(
      `WITH ${PRICED_CTE}
       SELECT
         (SELECT COUNT(*) FROM recipe_formats rf JOIN recipes r ON r.id = rf.recipe_id AND r.archived_at IS NULL
           WHERE rf.is_active AND rf.poids_cuit_g IS NULL)::int AS formats_sans_poids_cuit,
         (SELECT COUNT(*) FROM recipe_formats rf JOIN recipes r ON r.id = rf.recipe_id AND r.archived_at IS NULL
           WHERE rf.is_active)::int AS formats_total,
         (SELECT COUNT(*) FROM ingredients WHERE allergens_reviewed_at IS NULL AND COALESCE(cardinality(allergens), 0) = 0)::int AS ingredients_sans_allergenes,
         (SELECT COUNT(*) FROM ingredients)::int AS ingredients_total,
         (SELECT COUNT(*) FROM ${ACTIVE_RECIPES} AND ${NO_STEPS})::int AS fiches_sans_etapes,
         (SELECT COUNT(*) FROM ${ACTIVE_RECIPES})::int AS fiches_total,
         (SELECT COALESCE(SUM(c - 1), 0) FROM (SELECT COUNT(*) AS c FROM ingredients GROUP BY lower(btrim(name)) HAVING COUNT(*) > 1) d)::int AS ingredients_homonymes,
         (SELECT COUNT(*) FROM ingredients WHERE COALESCE(unit_cost, 0) = 0)::int AS ingredients_sans_prix,
         (SELECT COUNT(*) FROM priced p WHERE ${ABERRANT})::int AS prix_aberrants,
         (SELECT COUNT(*) FROM priced p WHERE p.n >= 5)::int AS prix_comparables,
         (SELECT COUNT(*) FROM ${ACTIVE_RECIPES} AND ${PLAN_LINES} = 0)::int AS fiches_jamais_produites`)).rows[0];
    const totals: Record<QualityKey, number> = {
      formats_sans_poids_cuit: r.formats_total, ingredients_sans_allergenes: r.ingredients_total,
      fiches_sans_etapes: r.fiches_total, ingredients_homonymes: r.ingredients_total,
      ingredients_sans_prix: r.ingredients_total, prix_aberrants: r.prix_comparables,
      fiches_jamais_produites: r.fiches_total,
    };
    return DEFS.map(d => ({ ...d, toFix: r[d.key] as number, total: totals[d.key] }));
  },

  /** Liste à corriger d'un compteur (200 lignes au plus). */
  async items(key: QualityKey): Promise<QualityItem[] | null> {
    const LIMIT = 200;
    const run = async (sql: string) => (await db.query(`${sql} LIMIT ${LIMIT}`)).rows as QualityItem[];
    switch (key) {
      case 'formats_sans_poids_cuit':
        return run(
          `SELECT r.id, 'recipe' AS kind, r.name AS label,
                  COALESCE(pc.nom, 'Sans contenant') || CASE WHEN rf.poids_cru_g IS NOT NULL THEN ' — cru ' || trim_scale(rf.poids_cru_g)::text || ' g' ELSE '' END AS detail
             FROM recipe_formats rf
             JOIN recipes r ON r.id = rf.recipe_id AND r.archived_at IS NULL
             LEFT JOIN production_contenants pc ON pc.id = rf.contenant_id
            WHERE rf.is_active AND rf.poids_cuit_g IS NULL
            ORDER BY r.name, rf.ordre`);
      case 'ingredients_sans_allergenes':
        return run(
          `SELECT i.id, 'ingredient' AS kind, i.name AS label, COALESCE(ec.name, i.category, 'Sans catégorie') AS detail
             FROM ingredients i LEFT JOIN expense_categories ec ON ec.id = i.category_id
            WHERE i.allergens_reviewed_at IS NULL AND COALESCE(cardinality(i.allergens), 0) = 0
            ORDER BY detail, i.name`);
      case 'fiches_sans_etapes':
        return run(
          `SELECT r.id, 'recipe' AS kind, r.name AS label, ${PLAN_LINES}::text AS detail
             FROM ${ACTIVE_RECIPES} AND ${NO_STEPS}
            ORDER BY ${PLAN_LINES} DESC, r.name`);
      case 'ingredients_homonymes':
        return run(
          `SELECT i.id, 'ingredient' AS kind, i.name AS label, trim_scale(i.unit_cost)::text || ' / ' || i.unit AS detail
             FROM ingredients i
            WHERE lower(btrim(i.name)) IN (SELECT lower(btrim(name)) FROM ingredients GROUP BY 1 HAVING COUNT(*) > 1)
            ORDER BY lower(btrim(i.name)), i.created_at`);
      case 'ingredients_sans_prix':
        return run(
          `SELECT i.id, 'ingredient' AS kind, i.name AS label, i.unit AS detail
             FROM ingredients i WHERE COALESCE(i.unit_cost, 0) = 0 ORDER BY i.name`);
      case 'prix_aberrants':
        return run(
          `WITH ${PRICED_CTE}
           SELECT p.id, 'ingredient' AS kind, p.name AS label,
                  trim_scale(p.unit_cost)::text || ' / ' || p.unit || ' — médiane ' || trim_scale(ROUND(p.median::numeric, 2))::text AS detail
             FROM priced p
            WHERE ${ABERRANT}
            ORDER BY GREATEST(p.unit_cost / p.median, p.median / p.unit_cost) DESC`);
      case 'fiches_jamais_produites':
        return run(
          `SELECT r.id, 'recipe' AS kind, r.name AS label, to_char(r.created_at, 'DD/MM/YYYY') AS detail
             FROM ${ACTIVE_RECIPES} AND ${PLAN_LINES} = 0
            ORDER BY r.created_at`);
      default:
        return null;
    }
  },
};
