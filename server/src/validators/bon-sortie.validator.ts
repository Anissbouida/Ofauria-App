import { z } from 'zod';

export const generateBonSchema = z.object({
  planId: z.string().uuid(),
  storeId: z.string().uuid(),
});

// Pesee d'une ligne : `actualQuantity` est une MESURE (poids net saisi ou lu sur la
// balance), plus une recopie de l'allocation. `reason` devient obligatoire cote
// repository des que la mesure sort de la bande de tolerance.
// Ouverture / substitution dans la meme action :
//   - lotId         : lot reellement utilise (« Autre lot »), pesage ou economat
//   - transferQty   : quantite ouverte depuis l'economat (defaut : contenants entiers
//                     ou le manque exact)
//   - containerCount: nombre de contenants ouverts (ingredient defini par contenant)
const weighingFields = {
  actualQuantity: z.number().min(0),
  tareQuantity: z.number().min(0).optional(),
  reason: z.string().trim().min(3, 'Le motif doit faire au moins 3 caracteres').optional(),
  source: z.enum(['manual', 'scale']).optional(),
  lotId: z.string().uuid().optional(),
  transferQty: z.number().positive().optional(),
  containerCount: z.number().int().positive().optional(),
  containerTypeId: z.string().uuid().optional(),
};

export const updateLigneSchema = z.object({
  ...weighingFields,
  notes: z.string().max(500).optional(),
});

// Enregistrement groupe des pesees d'un BSI, en une seule transaction (tout ou rien).
export const weighLignesSchema = z.object({
  lines: z.array(z.object({
    ligneId: z.string().uuid(),
    ...weighingFields,
  })).min(1, 'Aucune pesee a enregistrer'),
});

// Remise au chef : `withMissing` autorise la remise avec des ingredients en rupture
// (signales au chef), au lieu de bloquer le plan jusqu'au reapprovisionnement.
export const markReadySchema = z.object({
  withMissing: z.boolean().optional(),
});

export const chefRejectSchema = z.object({
  reason: z.string().trim().min(1, 'Un motif est obligatoire pour refuser la reception').max(500),
});

export const cancelBonSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const transferLineSchema = z.object({
  overrideLotId: z.string().uuid().optional(),
  overrideQty: z.number().positive().optional(),
  reason: z.string().trim().max(500).optional(),
  containerCount: z.number().int().positive().optional(),
  containerTypeId: z.string().uuid().optional(),
});
