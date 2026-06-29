import { z } from 'zod';

// Un composant de nomenclature pointe vers UNE recette de base OU UN ingrédient (exclusif).
const componentSchema = z
  .object({
    role: z.string().max(60).nullable().optional(),
    sourceRecipeId: z.string().uuid().nullable().optional(),
    sourceIngredientId: z.string().uuid().nullable().optional(),
    quantite: z.number().positive('La quantité doit être > 0'),
    unite: z.enum(['g', 'kg', 'ml', 'l', 'cl', 'unit']).default('g'),
    ordre: z.number().int().nonnegative().default(0),
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
});

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
export const createFormatSchema = z.object({
  contenantId: z.string().uuid('Contenant invalide'),
  nbParDefaut: z.number().int().positive().default(1),
  coutEmballageUnitaire: z.number().nonnegative().default(0),
  nbParts: z.number().int().positive().nullable().optional(),
});

export const duplicateFormatSchema = z.object({
  contenantId: z.string().uuid('Contenant invalide'),
});

export const updateFormatSchema = z.object({
  contenantId: z.string().uuid().optional(),
  nbParDefaut: z.number().int().positive().optional(),
  coutEmballageUnitaire: z.number().nonnegative().optional(),
  nbParts: z.number().int().positive().nullable().optional(),
});
