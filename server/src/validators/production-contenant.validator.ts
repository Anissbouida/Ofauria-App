import { z } from 'zod';

const etapeSchema = z.object({
  ordre: z.number().int().min(1),
  nom: z.string().min(1).max(200),
  duree_estimee_min: z.number().int().min(1).nullable().optional(),
  est_bloquante: z.boolean().default(false),
  timer_auto: z.boolean().default(false),
  controle_qualite: z.boolean().default(false),
  checklist_items: z.array(z.string()).default([]),
  est_repetable: z.boolean().default(false),
  nb_repetitions: z.number().int().min(1).default(1),
  responsable_role: z.string().nullable().optional(),
});

export const createContenantSchema = z.object({
  nom: z.string().min(1, 'Le nom est requis').max(200),
  type_production: z.number().int().min(1).max(5),
  unite_lancement: z.string().min(1).max(30).default('unit'),
  quantite_theorique: z.number().positive('La quantite doit etre positive'),
  pertes_fixes: z.number().min(0).default(0),
  seuil_rendement_defaut: z.number().min(0).max(100).default(90),
  etapes_defaut: z.array(etapeSchema).default([]),
  categories_pertes: z.array(z.string()).default([]),
});

export const updateContenantSchema = createContenantSchema.partial();

export const upsertProfileSchema = z.object({
  contenant_id: z.string().uuid('ID contenant invalide'),
  surcharge_quantite_theorique: z.number().positive().nullable().optional(),
  surcharge_pertes_fixes: z.number().min(0).nullable().optional(),
  surcharge_seuil_rendement: z.number().min(0).max(100).nullable().optional(),
  etapes_surcharges: z.array(etapeSchema).default([]),
  notes: z.string().nullable().optional(),
});
