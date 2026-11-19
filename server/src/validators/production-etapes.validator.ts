import { z } from 'zod';
import { weightUnitSchema } from '../utils/qty-unit.js';

export const updateEtapeStatusSchema = z.object({
  status: z.enum(['in_progress', 'completed', 'skipped']),
  checklist_resultats: z.array(z.object({
    label: z.string(),
    ok: z.boolean(),
    notes: z.string().optional(),
  })).optional(),
  notes: z.string().optional(),
  duree_reelle_min: z.number().int().min(0).optional(),
  /** M5-02 : quantités déclarées sur une opération de gamme. */
  good_qty: z.number().finite().min(0).max(1_000_000).optional(),
  scrap_qty: z.number().finite().min(0).max(1_000_000).optional(),
});

export const completeRepetitionSchema = z.object({
  notes: z.string().optional(),
});

// Relevé de procédé mesuré sur une étape (mig 422).
export const addReadingSchema = z.object({
  // Code du référentiel process_reading_params (mig 513), vérifié par le contrôleur.
  parametre: z.string().min(1).max(60),
  consigne: z.number().nullable().optional(),
  tolerance: z.number().min(0).nullable().optional(),
  mesure: z.number(),
  est_ccp: z.boolean().optional(),
  note: z.string().max(500).optional(),
});

// Rétro-planning (mig 432, épic labo L6) — heure de mise en vitrine « HH:MM ».
export const retroPlanningSchema = z.object({
  // Absente : le contrôleur applique la politique « Heure de mise en vitrine » (M1-03).
  heure_vitrine: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure de vitrine attendue au format HH:MM').optional(),
});

export const recordRendementSchema = z.object({
  quantite_brute: z.number().min(0),
  quantite_nette_reelle: z.number().min(0),
  vers_magasin: z.number().int().min(0),
  vers_frigo: z.number().int().min(0).default(0),
  pertes_detail: z.array(z.object({
    categorie: z.string(),
    quantite: z.number().min(0),
    notes: z.string().optional(),
  })).default([]),
  notes: z.string().optional(),
  // Bilan massique (épic labo L3, mig 427) — optionnels.
  masse_petrie_kg: z.number().min(0).nullable().optional(),
  patons_nombre: z.number().int().min(0).nullable().optional(),
  patons_poids_unitaire_g: z.number().min(0).nullable().optional(),
  masse_cuite_kg: z.number().min(0).nullable().optional(),
  // M3-04 : les mêmes pesées en quantité + unité saisie (g ou kg) ; prioritaires sur
  // les champs _kg / _g ci-dessus, gardés pour les appels anciens.
  masse_petrie_qty: z.number().min(0).nullable().optional(),
  masse_petrie_unit: weightUnitSchema.optional(),
  patons_poids_unitaire_qty: z.number().min(0).nullable().optional(),
  patons_poids_unitaire_unit: weightUnitSchema.optional(),
  masse_cuite_qty: z.number().min(0).nullable().optional(),
  masse_cuite_unit: weightUnitSchema.optional(),
  // M6-02 : emplacement de destination choisi ; absent = emplacement de code MAGASIN / FRIGO.
  vers_magasin_location_id: z.string().uuid('Emplacement invalide').nullable().optional(),
  vers_frigo_location_id: z.string().uuid('Emplacement invalide').nullable().optional(),
});
