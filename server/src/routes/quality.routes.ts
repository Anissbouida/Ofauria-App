import { Router } from 'express';
import { qualityController } from '../controllers/quality.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import { qualityControlPlanRepository } from '../repositories/quality-control-plan.repository.js';
import { qualityRepository } from '../repositories/quality.repository.js';
import { z } from 'zod';

const controlPlanLineSchema = z.object({
  productId: z.string().uuid().nullable().optional(),
  productCategoryId: z.coerce.number().int().positive().nullable().optional(),
  ingredientId: z.string().uuid().nullable().optional(),
  ingredientCategoryId: z.string().uuid().nullable().optional(),
  stage: z.enum(['reception', 'en_cours', 'final']),
  characteristic: z.string().trim().min(2).max(160),
  charType: z.enum(['mesure', 'oui_non', 'visuel']),
  minValue: z.coerce.number().finite().nullable().optional(),
  maxValue: z.coerce.number().finite().nullable().optional(),
  unit: z.string().trim().max(16).nullable().optional(),
  frequency: z.enum(['chaque_lot', 'un_sur_n', 'par_quantite']),
  frequencyN: z.coerce.number().int().positive().nullable().optional(),
  sampleSize: z.coerce.number().int().positive().max(10000).optional(),
  isBlocking: z.boolean().optional(),
});

// Contrôle qualité paramétrable (mig 384) : admin / gérant.
const router = Router();

router.get('/templates', authenticate, can('controle.quality.view'), qualityController.listTemplates);
router.post('/templates', authenticate, can('controle.quality.templates'), qualityController.createTemplate);
router.put('/templates/:id', authenticate, can('controle.quality.templates'), qualityController.updateTemplate);
router.post('/templates/:id/active', authenticate, can('controle.quality.active'), qualityController.setTemplateActive);
router.get('/inspections', authenticate, can('controle.quality.view'), asyncHandler(qualityController.listInspections));
router.post('/inspections', authenticate, can('controle.quality.inspections'), asyncHandler(qualityController.createInspection));
router.get('/inspections/:id', authenticate, can('controle.quality.view'), qualityController.getInspection);
router.get('/users', authenticate, can('controle.quality.view'), qualityController.users);
// Consultation unique d'un ordre : relevés de procédé et inspections (M7-03).
router.get('/records/plan/:planId', authenticate, validateUuidParams('planId'), can('controle.quality.view'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await qualityRepository.recordsForPlan(req.params.planId as string) });
}));
// Plan de contrôle par article (M7-02).
router.get('/control-plan', authenticate, can('controle.quality.view'), asyncHandler(async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  res.json({ success: true, data: await qualityControlPlanRepository.list({ productId: q.productId || null, ingredientId: q.ingredientId || null }) });
}));
router.post('/control-plan', authenticate, can('controle.quality.templates'), validate(controlPlanLineSchema), asyncHandler(async (req, res) => {
  try {
    res.status(201).json({ success: true, data: await qualityControlPlanRepository.create(req.body, (req as never as { user: { userId: string } }).user.userId) });
  } catch (err) { res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } }); }
}));
router.delete('/control-plan/:id', authenticate, validateUuidParams('id'), can('controle.quality.templates'), asyncHandler(async (req, res) => {
  const ok = await qualityControlPlanRepository.deactivate(req.params.id as string);
  res.status(ok ? 200 : 404).json({ success: ok });
}));
router.get('/nonconformities', authenticate, can('controle.quality.view'), qualityController.listNonConformities);
router.post('/nonconformities', authenticate, can('controle.quality.nonconformities'), qualityController.createNonConformity);
router.put('/nonconformities/:id', authenticate, can('controle.quality.nonconformities'), qualityController.updateNonConformity);

export default router;
