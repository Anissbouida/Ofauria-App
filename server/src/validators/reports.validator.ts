import { z } from 'zod';
import { body, obj, txt, numish } from './route-body.validator.js';

/**
 * G0-07 — Rapports personnalisés (reports.routes). Le moteur (report-builder.repository) ne
 * retient que les sources, axes et indicateurs de son registre figé ; les gestionnaires gardent
 * leurs messages (nom et source requis). Types seulement.
 */
const keys = z.array(z.string().max(120)).max(100);
export const reportRunSchema = body({
  sourceKey: txt(120), dimensions: keys.optional(), measures: keys.optional(),
  filters: z.record(z.unknown()).nullish(), dateFrom: txt(40), dateTo: txt(40),
  sort: obj({ key: z.string().max(120).optional(), dir: z.string().max(10).optional() }).nullish(),
  limit: numish,
});
export const reportDefinitionSchema = body({ name: txt(300), sourceKey: txt(120), config: z.record(z.unknown()).nullish() });
export const reportDashboardSchema = body({ name: txt(300), tiles: z.array(z.unknown()).max(200).nullish() });
