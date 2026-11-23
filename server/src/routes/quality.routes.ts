import { Router } from 'express';
import { qualityController } from '../controllers/quality.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import { qualityControlPlanRepository } from '../repositories/quality-control-plan.repository.js';
import { qualityRepository } from '../repositories/quality.repository.js';
import { lotReleaseRepository } from '../repositories/lot-release.repository.js';
import { nonconformityRepository } from '../repositories/nonconformity.repository.js';

const releaseSchema = z.object({ note: z.string().trim().min(3, 'Motif requis').max(500) });
const uuidN = z.string().guid().nullable().optional();
const ncDetailsSchema = z.object({ causeCode: z.string().max(40).nullable().optional(), supplierId: uuidN, productLotId: uuidN, ingredientLotId: uuidN, planId: uuidN, complaintId: uuidN });
const ncDecisionSchema = z.object({ decision: z.enum(['accepte', 'retouche', 'declasse', 'detruit', 'retour_fournisseur']), note: z.string().trim().max(500).nullable().optional() });
const ncActionSchema = z.object({ actionType: z.enum(['corrective', 'preventive']), description: z.string().trim().min(3).max(2000), responsibleId: uuidN, dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() });
const ncActionUpdateSchema = z.object({ status: z.enum(['a_faire', 'en_cours', 'faite']).optional(), effectivenessResult: z.enum(['efficace', 'inefficace']).nullable().optional(), effectivenessNote: z.string().trim().max(1000).nullable().optional() });
import { z } from 'zod';
import { ApprovalPendingError, gateLotRelease } from '../services/production-approvals.js';
import { nonConformitySchema, qualityActiveSchema, qualityInspectionSchema, qualityTemplateSchema } from '../validators/quality.validator.js';

const controlPlanLineSchema = z.object({
  productId: z.string().guid().nullable().optional(),
  productCategoryId: z.coerce.number().int().positive().nullable().optional(),
  ingredientId: z.string().guid().nullable().optional(),
  ingredientCategoryId: z.string().guid().nullable().optional(),
  stage: z.enum(['reception', 'en_cours', 'final', 'avant_transfert', 'avant_livraison']),
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
router.post('/templates', authenticate, can('controle.quality.templates'), validate(qualityTemplateSchema), qualityController.createTemplate);
router.put('/templates/:id', authenticate, can('controle.quality.templates'), validate(qualityTemplateSchema), qualityController.updateTemplate);
router.post('/templates/:id/active', authenticate, can('controle.quality.active'), validate(qualityActiveSchema), qualityController.setTemplateActive);
router.get('/inspections', authenticate, can('controle.quality.view'), asyncHandler(qualityController.listInspections));
router.post('/inspections', authenticate, can('controle.quality.inspections'), validate(qualityInspectionSchema), asyncHandler(qualityController.createInspection));
router.get('/inspections/:id', authenticate, can('controle.quality.view'), qualityController.getInspection);
router.get('/users', authenticate, can('controle.quality.view'), qualityController.users);
// Consultation unique d'un ordre : relevés de procédé et inspections (M7-03).
router.get('/records/plan/:planId', authenticate, validateUuidParams('planId'), can('controle.quality.view'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await qualityRepository.recordsForPlan(req.params.planId as string) });
}));
// Non-conformités structurées (M7-05).
const userOf = (req: unknown) => (req as { user: { userId: string; storeId?: string | null } }).user;
router.get('/nc-dashboard', authenticate, can('controle.quality.view'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await nonconformityRepository.dashboard(userOf(req).storeId ?? null) });
}));
router.get('/nonconformities/:id/detail', authenticate, validateUuidParams('id'), can('controle.quality.view'), asyncHandler(async (req, res) => {
  const d = await nonconformityRepository.get(req.params.id as string);
  res.status(d ? 200 : 404).json({ success: !!d, data: d });
}));
router.put('/nonconformities/:id/details', authenticate, validateUuidParams('id'), can('controle.quality.nonconformities'), validate(ncDetailsSchema), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await nonconformityRepository.setDetails(req.params.id as string, req.body) });
}));
router.post('/nonconformities/:id/decision', authenticate, validateUuidParams('id'), can('controle.quality.nonconformities'), validate(ncDecisionSchema), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await nonconformityRepository.decideLot(req.params.id as string, req.body.decision, userOf(req).userId, req.body.note ?? null) });
}));
router.post('/nonconformities/:id/actions', authenticate, validateUuidParams('id'), can('controle.quality.nonconformities'), validate(ncActionSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await nonconformityRepository.addAction(req.params.id as string, req.body, userOf(req).userId) });
}));
router.put('/nc-actions/:actionId', authenticate, validateUuidParams('actionId'), can('controle.quality.nonconformities'), validate(ncActionUpdateSchema), asyncHandler(async (req, res) => {
  const a = await nonconformityRepository.updateAction(req.params.actionId as string, req.body);
  res.status(a ? 200 : 404).json({ success: !!a, data: a });
}));
// Libération des lots (M7-04).
router.get('/lots/pending', authenticate, can('controle.quality.view'), asyncHandler(async (req, res) => {
  const user = (req as never as { user: { storeId?: string | null } }).user;
  res.json({ success: true, data: await lotReleaseRepository.listPending(user.storeId ?? null) });
}));
router.post('/lots/:lotId/release', authenticate, validateUuidParams('lotId'), can('controle.quality.inspections'), validate(releaseSchema), asyncHandler(async (req, res) => {
  const user = (req as never as { user: { userId: string; storeId?: string | null } }).user;
  // Étape 6 : la libération d'un lot peut être soumise à approbation (sans règle : inchangé).
  try {
    await gateLotRelease(req.params.lotId as string, user.userId, user.storeId ?? null);
  } catch (err) {
    if (err instanceof ApprovalPendingError) {
      res.status(409).json({ success: false, error: { code: err.code, message: err.message, approvalRequestId: err.requestId } });
      return;
    }
    throw err;
  }
  res.json({ success: true, data: await lotReleaseRepository.releaseProductLot(req.params.lotId as string, user.userId, req.body.note ?? null) });
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
router.post('/nonconformities', authenticate, can('controle.quality.nonconformities'), validate(nonConformitySchema), qualityController.createNonConformity);
router.put('/nonconformities/:id', authenticate, can('controle.quality.nonconformities'), validate(nonConformitySchema), qualityController.updateNonConformity);

export default router;
