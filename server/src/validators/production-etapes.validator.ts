import { z } from 'zod';

export const updateEtapeStatusSchema = z.object({
  status: z.enum(['in_progress', 'completed', 'skipped']),
  checklist_resultats: z.array(z.object({
    label: z.string(),
    ok: z.boolean(),
    notes: z.string().optional(),
  })).optional(),
  notes: z.string().optional(),
  duree_reelle_min: z.number().int().min(0).optional(),
});

export const completeRepetitionSchema = z.object({
  notes: z.string().optional(),
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
});
