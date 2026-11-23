import { db, withTransaction } from '../config/database.js';
import { ALLERGEN_CODES, allergenKey, normalizeAllergens, type AllergenCode } from '../validators/allergens.js';

/**
 * Allergènes des ingrédients, en grille (G2-06, mig 541).
 *
 * Quatre états par ingrédient et par allergène : contient, traces, absent (fiche vérifiée),
 * non renseigné (fiche jamais vérifiée). `grid()` rend les fiches avec une PROPOSITION
 * tirée de la catégorie et du nom (farines → gluten, produits laitiers → lait…), à valider
 * ligne par ligne : rien n'est écrit tant que la ligne n'est pas enregistrée.
 * `save()` enregistre « contient » et « traces » et marque la fiche vérifiée.
 */
export type AllergenGridRow = {
  id: string; name: string; category: string | null;
  contains: AllergenCode[]; traces: AllergenCode[];
  /** true : la fiche a été vérifiée, ou porte déjà des allergènes. */
  reviewed: boolean;
  reviewedAt: string | null; reviewedByName: string | null;
  /** Allergènes proposés pour une fiche non renseignée (jamais écrits sans validation). */
  proposal: AllergenCode[];
  usedInRecipes: number;
};

/** Catégorie → allergènes probables. Clés en minuscules sans accents, recherchées dans le nom de la catégorie. */
const CATEGORY_RULES: [string, AllergenCode[]][] = [
  ['farine', ['gluten']], ['pates & riz', ['gluten']], ['biscuit', ['gluten']],
  ['produits laitiers', ['lait']], ['lait &', ['lait']], ['cremes', ['lait']], ['beurre', ['lait']], ['fromage', ['lait']],
  ['oeuf', ['oeufs']],
  ['fruits secs', ['fruits_a_coque']],
  ['poissons', ['poissons']], ['thon', ['poissons']],
];
/** Mot du nom → allergène. Les noms trompeurs sont écartés avant (NAME_PITFALLS). */
const NAME_RULES: [string, AllergenCode][] = [
  ['farine', 'gluten'], ['ble', 'gluten'], ['semoule', 'gluten'], ['seigle', 'gluten'], ['orge', 'gluten'], ['avoine', 'gluten'], ['epeautre', 'gluten'], ['chapelure', 'gluten'],
  ['lait', 'lait'], ['beurre', 'lait'], ['creme', 'lait'], ['fromage', 'lait'], ['mascarpone', 'lait'], ['yaourt', 'lait'], ['lactose', 'lait'],
  ['oeuf', 'oeufs'], ['oeufs', 'oeufs'],
  ['amande', 'fruits_a_coque'], ['amandes', 'fruits_a_coque'], ['noisette', 'fruits_a_coque'], ['noisettes', 'fruits_a_coque'], ['noix', 'fruits_a_coque'],
  ['pistache', 'fruits_a_coque'], ['pistaches', 'fruits_a_coque'], ['praline', 'fruits_a_coque'], ['cajou', 'fruits_a_coque'], ['pecan', 'fruits_a_coque'],
  ['cacahuete', 'arachides'], ['cacahuetes', 'arachides'], ['arachide', 'arachides'],
  ['sesame', 'sesame'], ['soja', 'soja'], ['moutarde', 'moutarde'], ['celeri', 'celeri'],
  ['thon', 'poissons'], ['saumon', 'poissons'], ['anchois', 'poissons'], ['crevette', 'crustaces'], ['crevettes', 'crustaces'],
];
/** Noms où un mot ci-dessus ne désigne pas l'allergène. */
const NAME_PITFALLS = ['sucre semoule', 'beurre de cacao', 'lait de coco', 'creme de coco', 'noix de coco', 'noix de muscade', 'creme de tartre', 'beurre de cacahuete', 'fleur de sel'];

export function proposeAllergens(name: string, category: string | null): AllergenCode[] {
  const found = new Set<AllergenCode>();
  const cat = allergenKey(category ?? '');
  for (const [key, codes] of CATEGORY_RULES) if (cat.includes(key)) codes.forEach(c => found.add(c));
  let n = ` ${allergenKey(name).replace(/[^a-z0-9 ]+/g, ' ')} `;
  // « beurre de cacahuète » reste une arachide : seul le mot « beurre » est neutralisé.
  if (n.includes(' beurre de cacahuete ')) found.add('arachides');
  for (const pitfall of NAME_PITFALLS) n = n.replace(` ${pitfall} `, ' ');
  for (const [word, code] of NAME_RULES) if (n.includes(` ${word} `)) found.add(code);
  return ALLERGEN_CODES.filter(c => found.has(c));
}

const toCodes = (v: unknown): AllergenCode[] => normalizeAllergens(Array.isArray(v) ? v : []).codes;

export const ingredientAllergensRepository = {
  /** Fiches de la grille. `onlyMissing` : seulement les non renseignées. */
  async grid(opts: { onlyMissing?: boolean } = {}): Promise<AllergenGridRow[]> {
    const rows = (await db.query(
      `SELECT i.id, i.name, COALESCE(ec.name, i.category) AS category, i.allergens, i.allergen_traces,
              i.allergens_reviewed_at, NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), '') AS reviewed_by_name,
              (SELECT COUNT(DISTINCT f.recipe_id) FROM recipe_format_components c JOIN recipe_formats f ON f.id = c.format_id AND f.is_active WHERE c.source_ingredient_id = i.id)::int AS used_in_recipes
         FROM ingredients i
         LEFT JOIN expense_categories ec ON ec.id = i.category_id
         LEFT JOIN users u ON u.id = i.allergens_reviewed_by
        WHERE NOT $1::boolean OR (i.allergens_reviewed_at IS NULL AND COALESCE(cardinality(i.allergens), 0) = 0)
        ORDER BY (i.allergens_reviewed_at IS NOT NULL OR COALESCE(cardinality(i.allergens), 0) > 0),
                 used_in_recipes DESC, COALESCE(ec.name, i.category), i.name`, [opts.onlyMissing === true])).rows;
    return rows.map(r => {
      const contains = toCodes(r.allergens);
      const reviewed = r.allergens_reviewed_at !== null || contains.length > 0;
      return {
        id: r.id, name: r.name, category: r.category, contains, traces: toCodes(r.allergen_traces), reviewed,
        reviewedAt: r.allergens_reviewed_at ? new Date(r.allergens_reviewed_at).toISOString() : null,
        reviewedByName: r.reviewed_by_name,
        proposal: reviewed ? [] : proposeAllergens(r.name, r.category),
        usedInRecipes: r.used_in_recipes,
      };
    });
  },

  /** Enregistre les allergènes d'une fiche et la marque vérifiée (listes vides = « aucun allergène »). */
  async save(ingredientId: string, data: { contains: unknown; traces: unknown }, userId: string): Promise<{ error: string } | AllergenGridRow> {
    const c = normalizeAllergens(data.contains), t = normalizeAllergens(data.traces);
    const unknown = [...c.unknown, ...t.unknown];
    if (unknown.length) return { error: `Allergène(s) hors référentiel : ${unknown.join(', ')}` };
    const both = c.codes.filter(x => t.codes.includes(x));
    if (both.length) return { error: `Un allergène est « contient » ou « traces », pas les deux : ${both.join(', ')}` };
    const ok = await withTransaction(async () => {
      await db.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      const r = await db.query(
        `UPDATE ingredients SET allergens = $2::text[], allergen_traces = $3::text[], allergens_reviewed_at = now(), allergens_reviewed_by = $4
          WHERE id = $1 RETURNING id`, [ingredientId, c.codes, t.codes, userId]);
      return r.rows.length > 0;
    });
    if (!ok) return { error: 'Ingrédient introuvable' };
    return (await this.grid()).find(x => x.id === ingredientId)!;
  },
};
