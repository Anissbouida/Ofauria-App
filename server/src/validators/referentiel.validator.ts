import { z } from 'zod';
import { emptyBody } from './common.validator.js';
import { body, txt, any } from './route-body.validator.js';

/**
 * G0-07 — Référentiels éditables (referentiel.routes). Le corps dépend de la table (adaptateurs
 * natifs ou ref_entries) : seuls les champs communs sont typés, les autres passent tels quels.
 */
export const refEntrySchema = body({
  code: txt(120), label: txt(300), description: txt(2000), color: txt(40), icon: txt(80),
  metadata: any, display: any,
});
export const refReorderSchema = body({ orderedIds: z.array(z.union([z.string().max(60), z.number()])).max(5000).optional() });
export const refReactivateSchema = emptyBody;
