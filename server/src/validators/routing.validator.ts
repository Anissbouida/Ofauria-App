import { z } from 'zod';

/** Gammes (mig 388, opérations complètes M5-01). */
const num = (max: number) => z.coerce.number().finite().min(0).max(max);
export const routingOperationSchema = z.object({
  operationName: z.string().trim().min(1).max(160),
  operationNameAr: z.string().trim().max(160).nullable().optional(),
  workCenterId: z.string().uuid().nullable().optional(),
  opType: z.enum(['reglage', 'execution', 'attente', 'controle']).default('execution'),
  durationMin: num(100_000).default(0),
  setupMin: num(100_000).default(0),
  machineMinPerUnit: num(100_000).default(0),
  laborMinPerUnit: num(100_000).default(0),
  baseQuantity: z.coerce.number().finite().positive().max(1_000_000).default(1),
  controlPoint: z.string().trim().max(500).nullable().optional(),
  isBlocking: z.boolean().default(false),
  temperatureC: z.coerce.number().finite().min(-100).max(500).nullable().optional(),
  instructions: z.string().trim().max(2000).nullable().optional(),
});
export const createRoutingSchema = z.object({
  name: z.string().trim().min(1, 'Nom requis').max(160),
  productId: z.string().uuid().nullable().optional(),
  recipeId: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  batchSize: z.union([z.coerce.number().positive().max(1_000_000), z.literal('')]).nullable().optional(),
});
export const updateRoutingSchema = createRoutingSchema.partial().extend({
  operations: z.array(routingOperationSchema).max(100).optional(),
});
export type RoutingOperationInput = z.infer<typeof routingOperationSchema>;

/** Calendrier des postes (M5-04). */
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure HH:MM');
export const calendarSchema = z.object({
  slots: z.array(z.object({
    isoWeekday: z.coerce.number().int().min(1).max(7),
    startTime: hhmm, endTime: hhmm,
    resources: z.coerce.number().int().min(1).max(100).default(1),
  }).refine(s => s.endTime > s.startTime, { message: 'La fin doit suivre le début' })).max(70),
});
export const closureSchema = z.object({
  closedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().max(160).nullable().optional(),
  allCenters: z.boolean().optional(),
});

/** Référentiel équipement (M5-05) : lien poste / immobilisation, validé à la main. */
export const equipmentLinkSchema = z.object({
  workCenterId: z.string().uuid().nullable().optional(),
  fixedAssetId: z.string().uuid().nullable().optional(),
}).refine(b => b.workCenterId !== undefined || b.fixedAssetId !== undefined, { message: 'Rien à rattacher' });
/** Action sans corps (ouverture d'une intervention depuis un arrêt). */
export const emptyBodySchema = z.object({}).passthrough();

/* ─── G0-07 : postes de charge (routing.controller) — types seulement, le contrôleur garde
 *     ses messages (nom requis, statut connu, début et motif d'arrêt requis). ─────────── */
const numOrText = z.union([z.number().finite(), z.string().max(40)]).nullish();
export const workCenterSchema = z.object({
  name: z.string().max(160).optional(),
  hourlyCost: numOrText,
  capacityMinutesPerDay: numOrText,
}).passthrough();
export const activeFlagSchema = z.preprocess(v => v ?? {}, z.object({ active: z.boolean().nullish() }).passthrough());
export const workCenterStatusSchema = z.object({ status: z.string().max(30).optional() }).passthrough();
export const downtimeSchema = z.object({
  fromTime: z.string().max(40).optional(),
  toTime: z.string().max(40).nullish(),
  reason: z.string().max(500).optional(),
  notes: z.string().max(2000).nullish(),
  createIntervention: z.boolean().optional(),
}).passthrough();
