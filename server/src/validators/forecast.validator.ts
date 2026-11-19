import { z } from 'zod';
import { body, txt, bool } from './route-body.validator.js';

/**
 * G0-07 — Prévision de la demande (forecast.routes). Le gestionnaire garde son schéma détaillé
 * d'événement (dates, nature, majoration -100..500 %) ; celui-ci, posé devant, vérifie les types.
 */
export const forecastEventSchema = body({
  date_start: txt(40), date_end: txt(40), kind: txt(30), label: txt(300),
  uplift_pct: z.number().nullish(), category_id: z.number().nullish(), all_stores: bool,
});
