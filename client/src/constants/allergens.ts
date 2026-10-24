/**
 * Referentiel ferme des 14 allergenes a declaration obligatoire (UE 1169/2011,
 * annexe II). Les CODES sont ceux stockes en base ; meme liste cote serveur
 * (server/src/validators/allergens.ts) et CHECK en base (mig 344).
 */
export const ALLERGENS: { code: string; label: string; short: string }[] = [
  { code: 'gluten',         label: 'Gluten (blé, seigle, orge, avoine, épeautre)', short: 'Gluten' },
  { code: 'crustaces',      label: 'Crustacés',                                     short: 'Crustacés' },
  { code: 'oeufs',          label: 'Œufs',                                          short: 'Œufs' },
  { code: 'poissons',       label: 'Poissons',                                      short: 'Poissons' },
  { code: 'arachides',      label: 'Arachides',                                     short: 'Arachides' },
  { code: 'soja',           label: 'Soja',                                          short: 'Soja' },
  { code: 'lait',           label: 'Lait (lactose inclus)',                         short: 'Lait' },
  { code: 'fruits_a_coque', label: 'Fruits à coque (amande, noisette, noix, pistache…)', short: 'Fruits à coque' },
  { code: 'celeri',         label: 'Céleri',                                        short: 'Céleri' },
  { code: 'moutarde',       label: 'Moutarde',                                      short: 'Moutarde' },
  { code: 'sesame',         label: 'Sésame',                                        short: 'Sésame' },
  { code: 'sulfites',       label: 'Sulfites (SO₂ > 10 mg/kg)',                     short: 'Sulfites' },
  { code: 'lupin',          label: 'Lupin',                                         short: 'Lupin' },
  { code: 'mollusques',     label: 'Mollusques',                                    short: 'Mollusques' },
];

export const ALLERGEN_SHORT: Record<string, string> = Object.fromEntries(ALLERGENS.map(a => [a.code, a.short]));

/** Libelle court d'un code ; une valeur hors referentiel (historique) est affichee telle quelle. */
export function allergenLabel(code: string): string {
  return ALLERGEN_SHORT[code] ?? code;
}
