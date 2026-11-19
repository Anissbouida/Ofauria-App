import { z } from 'zod';

export const createEquipementSchema = z.object({
  nom: z.string().min(1).max(200),
  // Code du référentiel production_equipment_types (mig 513), vérifié par le contrôleur.
  type: z.string().min(1).max(60),
  cout_horaire: z.number().min(0).default(0),
  puissance_kw: z.number().min(0).optional(),
  // Absent : le dépôt applique la politique « Prix du kWh » (M1-03), plus 1,50 en dur.
  cout_kwh: z.number().min(0).optional(),
  notes: z.string().optional(),
  store_id: z.string().guid().optional(),
});

export const updateEquipementSchema = createEquipementSchema.partial();

export const recordTempsTravailSchema = z.object({
  plan_item_id: z.string().guid().optional(),
  employee_id: z.string().guid(),
  debut: z.string().datetime(),
  fin: z.string().datetime().optional(),
  duree_minutes: z.number().int().min(0).optional(),
  notes: z.string().optional(),
});

export const recordEquipementUsageSchema = z.object({
  equipement_id: z.string().guid(),
  debut: z.string().datetime(),
  fin: z.string().datetime().optional(),
  duree_minutes: z.number().int().min(0).optional(),
  notes: z.string().optional(),
});
