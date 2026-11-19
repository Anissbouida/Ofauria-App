import { z } from 'zod';

/**
 * Plan pilote — étape 2, lot paie (G0-07 ciblé). Aucun calcul n'est touché : les annulations de
 * paiement (/:id/unpay, mensuel, hebdo, quinzaine) ne lisent aucun corps → `emptyBody` du module
 * commun ; seul l'e-BDS a un corps.
 */

const blankToUndef = (v: unknown) => (v === '' || v === null ? undefined : v);

// payroll-compliance.controller.ebds : formulaire multipart (multer) — month et year arrivent en
// texte, convertis par parseInt ; le contrôleur répond lui-même « month et year requis » s'ils
// manquent, et la période est confrontée à celle du préétabli. Types seulement, sans borne.
export const ebdsSchema = z.preprocess(v => v ?? {}, z.object({
  month: z.preprocess(blankToUndef, z.coerce.number({ error: 'Mois invalide' }).int('Mois invalide').optional()),
  year: z.preprocess(blankToUndef, z.coerce.number({ error: 'Année invalide' }).int('Année invalide').optional()),
}).passthrough());
