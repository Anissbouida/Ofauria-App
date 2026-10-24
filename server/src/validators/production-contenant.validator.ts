import { z } from 'zod';
import { ETAPE_TYPES } from './recipe.validator.js';

const etapeSchema = z.object({
  ordre: z.number().int().min(1),
  nom: z.string().min(1).max(200),
  // Parametres structures (mig 342), memes regles que recipe.validator.
  type: z.enum(ETAPE_TYPES).nullable().optional(),
  temperature_c: z.number().min(-40).max(400).nullable().optional(),
  humidite_pct: z.number().min(0).max(100).nullable().optional(),
  duree_estimee_min: z.number().int().min(1).nullable().optional(),
  est_bloquante: z.boolean().default(false),
  timer_auto: z.boolean().default(false),
  controle_qualite: z.boolean().default(false),
  checklist_items: z.array(z.string()).default([]),
  est_repetable: z.boolean().default(false),
  nb_repetitions: z.number().int().min(1).default(1),
  responsable_role: z.string().nullable().optional(),
  // Version arabe (darija) du libelle et des points de controle. zod DEPOUILLE
  // les cles inconnues : sans ces deux champs, toute sauvegarde depuis l'UI
  // effacerait silencieusement la colonne arabe des fiches bilingues.
  nom_ar: z.string().max(300).nullable().optional(),
  checklist_items_ar: z.array(z.string()).default([]),
});

export const createContenantSchema = z.object({
  nom: z.string().min(1, 'Le nom est requis').max(200),
  type_production: z.number().int().min(1).max(5),
  unite_lancement: z.string().min(1).max(30).default('unit'),
  quantite_theorique: z.number().positive('La quantite doit etre positive'),
  pertes_fixes: z.number().min(0).default(0),
  poids_kg: z.number().positive().nullable().optional(),
  seuil_rendement_defaut: z.number().min(0).max(100).default(90),
  etapes_defaut: z.array(etapeSchema).default([]),
  categories_pertes: z.array(z.string()).default([]),
  // Dimensions physiques (mig 167) — toutes nullables, saisie progressive
  longueur_cm: z.number().positive().nullable().optional(),
  largeur_cm: z.number().positive().nullable().optional(),
  profondeur_cm: z.number().positive().nullable().optional(),
  diametre_cm: z.number().positive().nullable().optional(),
  type_decoupe: z.string().max(30).nullable().optional(),
  nb_pieces_decoupe: z.number().int().positive().nullable().optional(),
});

export const updateContenantSchema = createContenantSchema.partial();

/** Actions en masse depuis la liste des formats (selection multiple). */
export const bulkIdsSchema = z.object({
  ids: z.array(z.string().uuid('ID format invalide'))
    .min(1, 'Aucun format selectionne')
    .max(200, 'Trop de formats selectionnes'),
});

export const upsertProfileSchema = z.object({
  contenant_id: z.string().uuid('ID contenant invalide'),
  surcharge_quantite_theorique: z.number().positive().nullable().optional(),
  surcharge_pertes_fixes: z.number().min(0).nullable().optional(),
  surcharge_seuil_rendement: z.number().min(0).max(100).nullable().optional(),
  etapes_surcharges: z.array(etapeSchema).default([]),
  notes: z.string().nullable().optional(),
});
