import { z } from 'zod';

/**
 * Referentiel ferme des 14 allergenes a declaration obligatoire (reglement UE
 * 1169/2011 annexe II, repris par la reglementation marocaine d'etiquetage).
 * Les CODES sont stockes en base (ingredients.allergens, CHECK mig 344) ; les
 * libelles servent a l'affichage. Meme liste cote client
 * (client/src/constants/allergens.ts).
 */
export const ALLERGEN_CODES = [
  'gluten', 'crustaces', 'oeufs', 'poissons', 'arachides', 'soja', 'lait',
  'fruits_a_coque', 'celeri', 'moutarde', 'sesame', 'sulfites', 'lupin', 'mollusques',
] as const;
export type AllergenCode = typeof ALLERGEN_CODES[number];

export const ALLERGEN_LABELS: Record<AllergenCode, string> = {
  gluten: 'Gluten (blé, seigle, orge, avoine, épeautre)',
  crustaces: 'Crustacés',
  oeufs: 'Œufs',
  poissons: 'Poissons',
  arachides: 'Arachides',
  soja: 'Soja',
  lait: 'Lait (lactose inclus)',
  fruits_a_coque: 'Fruits à coque (amande, noisette, noix, pistache…)',
  celeri: 'Céleri',
  moutarde: 'Moutarde',
  sesame: 'Sésame',
  sulfites: 'Sulfites (SO₂ > 10 mg/kg)',
  lupin: 'Lupin',
  mollusques: 'Mollusques',
};

/** Variantes libres rencontrees en saisie / import, deja en minuscules sans accents. */
const SYNONYMS: Record<string, AllergenCode> = {
  gluten: 'gluten', ble: 'gluten', 'ble tendre': 'gluten', farine: 'gluten', seigle: 'gluten', orge: 'gluten', avoine: 'gluten', epeautre: 'gluten', cereales: 'gluten', 'cereales contenant du gluten': 'gluten',
  crustaces: 'crustaces', crustace: 'crustaces', crevette: 'crustaces', crevettes: 'crustaces', crabe: 'crustaces',
  oeufs: 'oeufs', oeuf: 'oeufs', egg: 'oeufs', eggs: 'oeufs',
  poissons: 'poissons', poisson: 'poissons', thon: 'poissons', saumon: 'poissons',
  arachides: 'arachides', arachide: 'arachides', cacahuete: 'arachides', cacahuetes: 'arachides', peanut: 'arachides',
  soja: 'soja', soya: 'soja', soy: 'soja',
  lait: 'lait', lactose: 'lait', laitier: 'lait', 'produits laitiers': 'lait', beurre: 'lait', creme: 'lait', fromage: 'lait', milk: 'lait',
  'fruits a coque': 'fruits_a_coque', fruits_a_coque: 'fruits_a_coque', 'fruit a coque': 'fruits_a_coque', 'fruits a coques': 'fruits_a_coque', amande: 'fruits_a_coque', amandes: 'fruits_a_coque', noisette: 'fruits_a_coque', noisettes: 'fruits_a_coque', noix: 'fruits_a_coque', pistache: 'fruits_a_coque', pistaches: 'fruits_a_coque', 'noix de cajou': 'fruits_a_coque', 'noix de pecan': 'fruits_a_coque', 'nuts': 'fruits_a_coque',
  celeri: 'celeri', 'celeri-rave': 'celeri',
  moutarde: 'moutarde',
  sesame: 'sesame', 'graines de sesame': 'sesame',
  sulfites: 'sulfites', sulfite: 'sulfites', 'anhydride sulfureux': 'sulfites', so2: 'sulfites',
  lupin: 'lupin',
  mollusques: 'mollusques', mollusque: 'mollusques', calamar: 'mollusques', moule: 'mollusques', moules: 'mollusques', escargot: 'mollusques',
};

/** Minuscules, sans accents ni espaces superflus : la cle de SYNONYMS. */
export function allergenKey(raw: string): string {
  return raw
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/[_\s]+/g, ' ')
    .trim();
}

/**
 * Normalise une liste libre vers les codes du referentiel.
 * - codes : codes reconnus, dedoublonnes, dans l'ordre du referentiel ;
 * - unknown : valeurs non reconnues (a refuser cote API, a signaler cote import).
 */
export function normalizeAllergens(values: unknown): { codes: AllergenCode[]; unknown: string[] } {
  const list = Array.isArray(values) ? values : (typeof values === 'string' ? values.split(',') : []);
  const found = new Set<AllergenCode>();
  const unknown: string[] = [];
  for (const v of list) {
    const raw = String(v ?? '').trim();
    if (!raw) continue;
    const key = allergenKey(raw);
    const code = (ALLERGEN_CODES as readonly string[]).includes(key.replace(/ /g, '_'))
      ? (key.replace(/ /g, '_') as AllergenCode)
      : SYNONYMS[key];
    if (code) found.add(code); else unknown.push(raw);
  }
  const codes = ALLERGEN_CODES.filter(c => found.has(c));
  return { codes, unknown };
}

/** Schema zod : tableau de codes du referentiel (ou chaine CSV), normalise a la validation. */
export const allergensSchema = z.union([z.array(z.string()), z.string()]).optional().nullable()
  .transform((val, ctx) => {
    if (val == null) return undefined;
    const { codes, unknown } = normalizeAllergens(val);
    if (unknown.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Allergène(s) hors référentiel : ${unknown.join(', ')}. Valeurs admises : ${ALLERGEN_CODES.join(', ')}.`,
      });
      return z.NEVER;
    }
    return codes;
  });
