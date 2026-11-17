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
