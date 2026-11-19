import { z } from 'zod';
import { emptyBody } from './common.validator.js';
import { body, txt } from './route-body.validator.js';

/**
 * G0-07 — Développement de produits (product-pipeline.routes). product-pipeline.controller garde
 * ses messages (nom requis, étape requise, décision connue) ; les données d'étape varient selon
 * l'étape et passent telles quelles. Types seulement.
 */
export const createPipelineSchema = body({
  name: txt(300), description: txt(5000),
  categoryId: z.union([z.number(), z.string().max(20)]).nullish(),
  responsibleUserId: z.string().max(60).nullish(), targetDate: txt(40),
});
export const pipelineStageDataSchema = body({ stage: z.union([z.string().max(60), z.number()]).nullish() });
export const pipelineDecisionSchema = body({ decision: txt(40), comments: txt(5000) });
export const pipelineCancelSchema = body({ reason: txt(2000) });
/** Passage à l'étape suivante, intégration au catalogue : aucun champ lu. */
export const pipelineActionSchema = emptyBody;
