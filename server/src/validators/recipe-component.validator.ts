import { z } from 'zod';
import { weightUnitSchema } from '../utils/qty-unit.js';

// Un composant de nomenclature pointe vers UNE recette de base OU UN ingrédient (exclusif).
const componentSchema = z
  .object({
    role: z.string().max(60).nullable().optional(),
    sourceRecipeId: z.string().guid().nullable().optional(),
    sourceIngredientId: z.string().guid().nullable().optional(),
    quantite: z.number().positive('La quantité doit être > 0'),
    // Code du référentiel `units` (mig 515), vérifié par la route (requireUnits).
    unite: z.string().trim().min(1).max(20).default('g'),
    ordre: z.number().int().nonnegative().default(0),
    // Mig 265 (audit A5) : perte % par ligne, defaut 0. Majore la matiere brute
    // (qty_brute = qty / (1 - pertePct/100)) cote cout et cote besoins.
    pertePct: z.number().min(0).max(99.99).nullable().optional(),
  })
  .refine(
    (c) => Boolean(c.sourceRecipeId) !== Boolean(c.sourceIngredientId),
    { message: 'Un composant référence soit une recette de base, soit un ingrédient (exclusif).' }
  );

// PUT remplace l'intégralité de la nomenclature d'un format + champs format optionnels.
export const replaceComponentsSchema = z.object({
  components: z.array(componentSchema).default([]),
  nbParDefaut: z.number().int().positive().nullable().optional(),
  nbParts: z.number().int().positive().nullable().optional(),
  poidsCruG: z.number().nonnegative().nullable().optional(),
  poidsCuitG: z.number().nonnegative().nullable().optional(),
  // M3-04 : poids cru / cuit en quantité + unité saisie (g ou kg), prioritaires.
  poidsCruQty: z.number().nonnegative().nullable().optional(),
  poidsCruUnit: weightUnitSchema.optional(),
  poidsCuitQty: z.number().nonnegative().nullable().optional(),
  poidsCuitUnit: weightUnitSchema.optional(),
  // Mig 613 : rendement en pièces (nbParDefaut) OU en kilos (rendementKg, décimal).
  rendementUnite: z.enum(['unit', 'kg']).optional(),
  rendementKg: z.number().positive('Le rendement en kg doit être supérieur à 0').nullable().optional(),
  // Perte à la cuisson / de fabrication (recipes.perte_standard_pct) : donnée technique de
  // la fiche, enregistrée avec la composition (droit des chefs) et plus seulement avec les
  // paramètres financiers (réservés au gérant) — scénario 1, constat 38.
  perteStandardPct: z.number().min(0).max(99.99).nullable().optional(),
}).refine(
  (d) => d.rendementUnite !== 'kg' || (d.rendementKg != null && d.rendementKg > 0),
  { message: 'Saisis le rendement en kg de la fournée.', path: ['rendementKg'] }
);

// PATCH leviers financiers saisissables (frais indirects + multiplicateur de vente).
export const financeSchema = z.object({
  marginMultiplier: z.number().positive().nullable().optional(),
  tauxMainOeuvreDhH: z.number().nonnegative().nullable().optional(),
  mainOeuvreMin: z.number().int().nonnegative().nullable().optional(),
  coutEnergieFournee: z.number().nonnegative().nullable().optional(),
  tauxFraisStructurePct: z.number().min(0).max(100).nullable().optional(),
  perteStandardPct: z.number().min(0).max(99.99).nullable().optional(),
  compoParPiece: z.boolean().nullable().optional(),
});

// CRUD format
// Mig 267 (audit A9) : contenantId nullable — un format d'assemblage n'a pas
// de moule physique. Le placebo « Assemblage » a ete supprime.
export const createFormatSchema = z.object({
  contenantId: z.string().guid('Contenant invalide').nullable().optional(),
  nbParDefaut: z.number().int().positive().default(1),
  coutEmballageUnitaire: z.number().nonnegative().default(0),
  nbParts: z.number().int().positive().nullable().optional(),
});

export const duplicateFormatSchema = z.object({
  contenantId: z.string().guid('Contenant invalide').nullable().optional(),
});

export const updateFormatSchema = z.object({
  contenantId: z.string().guid().nullable().optional(),
  nbParDefaut: z.number().int().positive().optional(),
  coutEmballageUnitaire: z.number().nonnegative().optional(),
  nbParts: z.number().int().positive().nullable().optional(),
  // Mig 263 (audit A1) : produit vendu au POS. `null` explicite = defaire le lien.
  productId: z.string().guid().nullable().optional(),
  // Mig 266 (audit A4) : densite kg/l de la pate/appareil. `null` explicite = defaut 1.
  densiteKgL: z.number().positive().nullable().optional(),
});

/** G2-05 — poids cru et poids cuit d'un format, saisis en grille. `null` efface la valeur. */
export const formatWeightsSchema = z.object({
  poidsCruG: z.number().positive().max(1_000_000).nullable(),
  poidsCuitG: z.number().positive().max(1_000_000).nullable(),
  // M3-04 : unité de saisie de chaque poids (défaut : gramme, comportement d'avant).
  cruUnit: z.enum(['g', 'kg']).optional(),
  cuitUnit: z.enum(['g', 'kg']).optional(),
});
