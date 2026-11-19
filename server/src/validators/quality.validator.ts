import { z } from 'zod';
import { body, obj, txt, bool } from './route-body.validator.js';

/**
 * G0-07 — Qualité (quality.routes) : modèles de contrôle, inspections, non-conformités.
 * quality.controller garde ses messages (nom / titre requis, résultats requis) ; types seulement.
 */
const ref = z.string().max(60).nullish(); // identifiant facultatif, '' = aucun
const items = z.array(obj({})).max(500);

export const qualityTemplateSchema = body({ name: txt(200), appliesTo: txt(40), items: items.nullish() });
export const qualityActiveSchema = body({ active: bool });

export const qualityInspectionSchema = body({
  title: txt(300), templateId: ref, referenceNote: txt(500), inspectedOn: txt(40), notes: txt(5000),
  results: z.array(obj({})).max(1000).optional(),
  planId: ref, planItemId: ref, etapeId: ref, ingredientLotId: ref, productLotId: ref, receptionVoucherId: ref, pendingId: ref,
});

const ncFields = {
  title: txt(300), source: txt(40), referenceNote: txt(500), description: txt(5000), severity: txt(30),
  correctiveAction: txt(5000), responsibleId: ref, dueDate: txt(40), detectedOn: txt(40), status: txt(30),
};
export const nonConformitySchema = body(ncFields);
