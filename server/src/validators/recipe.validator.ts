import { z } from 'zod';

/** Types d'etape de fabrication (mig 342). Meme liste que le CHECK de production_item_etapes.type_etape. */
export const ETAPE_TYPES = [
  'petrissage', 'pointage', 'faconnage', 'tourage', 'appret',
  'cuisson', 'refroidissement', 'montage', 'finition', 'autre',
] as const;

const etapeSchema = z.object({
  ordre: z.number().int().min(1),
  nom: z.string().min(1, 'Le nom de l\'étape est requis').max(200),
  // Parametres structures (mig 342) : type d'etape, T° (four/etuve/ambiante), hygrometrie.
  type: z.enum(ETAPE_TYPES).nullable().optional(),
  temperature_c: z.number().min(-40, 'Température trop basse').max(400, 'Température trop haute').nullable().optional(),
  humidite_pct: z.number().min(0).max(100, 'L\'humidité est un pourcentage (0-100)').nullable().optional(),
  duree_estimee_min: z.number().positive().nullable().optional(),
  est_bloquante: z.boolean().default(true),
  timer_auto: z.boolean().default(false),
  controle_qualite: z.boolean().default(false),
  checklist_items: z.array(z.string()).default([]),
  est_repetable: z.boolean().default(false),
  nb_repetitions: z.number().int().min(1).default(1),
  responsable_role: z.string().max(50).nullable().optional(),
  // Version arabe (darija) du libelle et des points de controle. zod DEPOUILLE
  // les cles inconnues : sans ces deux champs, toute sauvegarde depuis l'UI
  // effacerait silencieusement la colonne arabe des fiches bilingues.
  nom_ar: z.string().max(300).nullable().optional(),
  checklist_items_ar: z.array(z.string()).default([]),
});

// Enregistrement des seules étapes depuis la page de la fiche (PUT /:id/etapes).
// Identité d'une fiche (nom, catégorie) modifiée depuis la liste ou l'en-tête de
// la page, sans renvoyer composition ni étapes.
export const identitySchema = z.object({
  name: z.string().min(1, 'Le nom est requis').max(200),
  categoryId: z.string().uuid().nullable().optional(),
});

export const saveEtapesSchema = z.object({ etapes: z.array(etapeSchema.passthrough()) });

export const createRecipeSchema = z.object({
  name: z.string().min(1, 'Le nom est requis').max(200),
  productId: z.string().uuid().optional().nullable(),
  contenantId: z.string().uuid().optional().nullable(),
  // Classification operationnelle (recipe_categories.id). Distincte de la
  // categorie commerciale du produit lie.
  categoryId: z.string().uuid().optional().nullable(),
  instructions: z.string().optional().nullable(),
  yieldQuantity: z.number().positive('Le rendement doit être positif').default(1),
  yieldUnit: z.string().max(20).default('unit'),
  // Poids unitaire d'une piece, en kg. Requis quand yield_unit != products.sale_unit
  // (la validation finale est faite dans le repository via ensureYieldUnitCompatible).
  pieceWeightKg: z.number().positive('Le poids unitaire doit être positif').nullable().optional(),
  // Parametres de pate (mig 342) : T° de pate en fin de petrissage, hydratation en % boulanger.
  temperaturePateCibleC: z.number().min(-10).max(60, 'Température de pâte invalide').nullable().optional(),
  hydratationPct: z.number().min(0).max(200, 'Hydratation invalide (0-200 %)').nullable().optional(),
  marginMultiplier: z.number().positive('Le multiplicateur doit être positif').default(3),
  salePrice: z.number().nonnegative('Le prix de vente doit être positif').optional().nullable(),
  // Frais indirects au niveau recette (default 0 si absent — preserve le comportement existant)
  tauxMainOeuvreDhH: z.number().nonnegative().optional(),
  coutEnergieFournee: z.number().nonnegative().optional(),
  tauxFraisStructurePct: z.number().min(0).max(100).optional(),
  // Perte de transformation (cuisson, reduction) — saisie sur les preparations
  // de base. Borne a <100 : une perte totale rendrait le rendement net nul.
  perteStandardPct: z.number().min(0).max(99.99).optional(),
  isBase: z.boolean().default(false),
  etapes: z.array(etapeSchema).default([]),
  ingredients: z.array(z.object({
    ingredientId: z.string().uuid('ID ingrédient invalide'),
    quantity: z.number().positive('La quantité doit être positive'),
    unit: z.string().max(20).optional().nullable(),
  })).min(0),
  subRecipes: z.array(z.object({
    subRecipeId: z.string().uuid('ID sous-recette invalide'),
    quantity: z.number().positive('La quantité doit être positive'),
  })).default([]),
  packaging: z.array(z.object({
    packagingId: z.string().uuid('ID emballage invalide'),
    quantity: z.number().positive('La quantité doit être positive'),
    unit: z.string().max(20).optional().nullable(),
  })).default([]),
  // Formats de production (multi-formats par recette). Optionnel — si vide ou absent,
  // le calcul de cout/format se fait sur recipes.contenant_id (compat descendante).
  formats: z.array(z.object({
    contenantId: z.string().uuid('ID contenant invalide'),
    quantiteParFormatG: z.number().positive('La quantité par format doit être > 0'),
    quantiteParFormatUnite: z.enum(['g', 'kg', 'ml', 'l']).default('g'),
    nbParDefaut: z.number().int().positive('Le nombre par défaut doit être >= 1').default(1),
    coutEmballageUnitaire: z.number().nonnegative().default(0),
    ordre: z.number().int().nonnegative().default(0),
    // Overrides (mig 168) — null = utilise le calcul auto cout × marge_recette
    prixVenteUnitaireOverride: z.number().positive().nullable().optional(),
    marginMultiplierOverride: z.number().positive().nullable().optional(),
  })).default([]),
});

// En édition unifiée, le formulaire n'envoie que les métadonnées (la composition/les
// formats sont gérés par l'éditeur) → ingredients devient optionnel à la mise à jour.
export const updateRecipeSchema = createRecipeSchema.partial({ ingredients: true });

// Suppression en masse depuis la liste (sélection par onglet Produits/Bases).
export const bulkDeleteRecipesSchema = z.object({
  ids: z.array(z.string().uuid('ID recette invalide')).min(1, 'Aucune recette sélectionnée').max(500),
});
