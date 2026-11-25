import { Router } from 'express';
import { z } from 'zod';
import { productionConsumptionRepository } from '../repositories/production-consumption.repository.js';

const manualConsumptionSchema = z.object({
  ingredientId: z.string().guid(),
  quantity: z.number().finite().positive().max(1_000_000),
  note: z.string().trim().max(500).nullable().optional(),
  // Mig 663 : article de l'ordre servi par cette sortie (facultatif pour un ordre à un article).
  planItemId: z.string().guid().nullable().optional(),
});
import { productionController } from '../controllers/production.controller.js';
import { printTemplateController } from '../controllers/print-template.controller.js';
import { planSummaryRepository } from '../repositories/plan-summary.repository.js';
import { productionImpactRepository } from '../repositories/production-impact.repository.js';
import { subcontractingRepository, SubcontractError } from '../repositories/subcontracting.repository.js';
import { productSerialRepository } from '../repositories/product-serial.repository.js';
import { disassemblyRepository, DisassemblyError } from '../repositories/disassembly.repository.js';
import { productionScreensRepository, ScreenSettingError } from '../repositories/production-screens.repository.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { authorizeSettings } from '../middleware/settings-access.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate, validateQuery, validateUuidParams } from '../middleware/validate.middleware.js';
import {
  createPlanSchema, updateItemsSchema, itemIdsSchema, restoreItemsSchema, startItemsSchema, produceItemsSchema,
  completeSchema, cancelItemsSchema, relaunchSchema, addActivitySchema, requestStockVerificationSchema, listQuerySchema, setPolicySchema,
  createOrderTypeSchema, updateOrderTypeSchema, printTemplateSchema, subcontractSetupSchema, subcontractShipSchema, disassemblySchema, screenSettingSchema, updatePlanHeaderSchema, mrpPhasedValidateSchema, masterScheduleSchema, itemRecipeSchema,
} from '../validators/production.validator.js';
import { emptyBody } from '../validators/common.validator.js';
import { planProgress } from '../services/process-engine.js';
import { productionDocumentRepository } from '../repositories/production-document.repository.js';
import { materialReservationRepository } from '../repositories/material-reservation.repository.js';
import { idempotent } from '../middleware/idempotency.middleware.js';
import { productionSettingsSchema, saveWorkshopSchema, mrpGenerateSchema, receiveProductionTransferSchema } from '../validators/production-flow.validator.js';

const id = validateUuidParams('id');

const router = Router();

router.get('/', authenticate, validateQuery(listQuerySchema), asyncHandler(productionController.list));
// Ateliers (mig 511) : lecture pour tout utilisateur connecté (libellés des plans, caisse),
// création / modification par le paramétrage Production. Avant /:id.
router.get('/workshops', authenticate, asyncHandler(productionController.workshops));
router.put('/workshops/:code', authenticate, authorizeSettings('production', 'edit'), validate(saveWorkshopSchema), asyncHandler(productionController.saveWorkshop));
// Référentiels du procédé (types d'étape, d'équipement, paramètres de relevé — mig 513).
router.get('/process-referentials', authenticate, asyncHandler(productionController.processReferentials));
// Static routes BEFORE /:id to avoid capture
router.get('/transfers/pending', authenticate, asyncHandler(productionController.pendingProductionTransfers));

// MRP — besoins nets du jour (plan directeur). Avant /:id pour ne pas être capturé comme id.
router.get('/mrp', authenticate, can('production.view'), asyncHandler(productionController.mrp));
router.get('/master-schedule', authenticate, can('production.view'), asyncHandler(productionController.masterSchedule));
router.put('/master-schedule', authenticate, can('production.master_schedule'), validate(masterScheduleSchema), asyncHandler(productionController.saveMasterSchedule));
router.get('/mrp/phased', authenticate, can('production.view'), asyncHandler(productionController.mrpPhased));
router.post('/mrp/phased/validate', authenticate, can('production.generate'), validate(mrpPhasedValidateSchema), asyncHandler(productionController.mrpPhasedValidate));
router.get('/mrp/horizon', authenticate, can('production.view'), asyncHandler(productionController.mrpHorizon));
router.get('/mrp/semi-finished', authenticate, can('production.view'), asyncHandler(productionController.mrpSemiFinished));
router.post('/mrp/generate', authenticate, can('production.generate'), validate(mrpGenerateSchema), asyncHandler(productionController.mrpGenerate));
// MRP — besoins matière (achats) & génération des demandes d'achat — roadmap lot 8
router.get('/mrp/material-requirements', authenticate, can('production.view'), asyncHandler(productionController.mrpMaterialRequirements));
router.post('/mrp/generate-purchase-requests', authenticate, can('production.generate_purchase_requests'), validate(mrpGenerateSchema), asyncHandler(productionController.mrpGeneratePurchaseRequests));
// Réglages de production centralisés — roadmap lot 9. Avant /:id.
router.get('/settings', authenticate, can('production.view'), asyncHandler(productionController.getSettings));
// M1-04 — politiques de production (lecture : production ; écriture : droit Paramètres › Production).
router.get('/order-types', authenticate, can('production.view'), asyncHandler(productionController.listOrderTypes));
router.post('/order-types', authenticate, authorizeSettings('production', 'edit'), validate(createOrderTypeSchema), asyncHandler(productionController.createOrderType));
router.put('/order-types/:typeId', authenticate, validateUuidParams('typeId'), authorizeSettings('production', 'edit'), validate(updateOrderTypeSchema), asyncHandler(productionController.updateOrderType));
// M8-04 — gabarits d'impression (lecture : production ; écriture : droit Paramètres › Production). Avant /:id.
router.get('/print-templates', authenticate, can('production.view'), asyncHandler(printTemplateController.resolved));
router.get('/print-templates/settings', authenticate, authorizeSettings('production'), asyncHandler(printTemplateController.settings));
router.put('/print-templates/:docType', authenticate, authorizeSettings('production', 'edit'), validate(printTemplateSchema), asyncHandler(printTemplateController.updateBase));
router.put('/print-templates/:docType/variants/:orderTypeId', authenticate, validateUuidParams('orderTypeId'), authorizeSettings('production', 'edit'), validate(printTemplateSchema), asyncHandler(printTemplateController.upsertVariant));
router.delete('/print-templates/:docType/variants/:orderTypeId', authenticate, validateUuidParams('orderTypeId'), authorizeSettings('production', 'edit'), asyncHandler(printTemplateController.deleteVariant));
router.get('/serials/lookup', authenticate, can('production.view'), asyncHandler(async (req, res) => {
  const sn = typeof req.query.serial === 'string' ? req.query.serial.slice(0, 80) : '';
  res.json({ success: true, data: sn.trim() ? await productSerialRepository.lookup(sn) : [] });
}));
// M9 — désassemblage : lots candidats, historique, désassembler (avant /:id).
// Écrans de fabrication (mig 591) : éléments masqués (lecture : production ; écriture : Paramètres › Production).
router.get('/screen-settings', authenticate, can('production.view'), asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await productionScreensRepository.list() });
}));
router.put('/screen-settings', authenticate, authorizeSettings('production', 'edit'), validate(screenSettingSchema), asyncHandler(async (req, res) => {
  try {
    res.json({ success: true, data: await productionScreensRepository.setHidden(req.body.orderTypeId, req.body.key, req.body.hidden, (req as AuthRequest).user!.userId) });
  } catch (e) {
    if (e instanceof ScreenSettingError) { res.status(400).json({ success: false, error: { message: e.message } }); return; }
    throw e;
  }
}));
router.get('/disassembly/candidates', authenticate, can('production.view'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await disassemblyRepository.candidates((req as AuthRequest).user?.storeId ?? null) });
}));
router.get('/disassembly', authenticate, can('production.view'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await disassemblyRepository.list((req as AuthRequest).user?.storeId ?? null) });
}));
router.post('/disassembly', authenticate, can('production.edit'), validate(disassemblySchema), asyncHandler(async (req, res) => {
  try {
    res.status(201).json({ success: true, data: await disassemblyRepository.disassemble(req.body, (req as AuthRequest).user!.userId) });
  } catch (e) {
    if (e instanceof DisassemblyError) { res.status(400).json({ success: false, error: { message: e.message } }); return; }
    throw e;
  }
}));
router.get('/subcontracting', authenticate, can('production.view'), asyncHandler(async (_req, res) => { res.json({ success: true, data: await subcontractingRepository.listOpen() }); }));
// C-09 — aperçu d'impact : ordres ouverts touchés par un changement de type d'ordre ou de politique.
router.get('/order-types/:typeId/impact', authenticate, validateUuidParams('typeId'), can('production.view'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productionImpactRepository.forOrderType(req.params.typeId as string) });
}));
router.get('/policies/impact', authenticate, can('production.view'), asyncHandler(async (req, res) => {
  const type = String(req.query.scopeType ?? 'company');
  const sid = String(req.query.scopeId ?? '');
  if (!['company', 'store', 'workshop', 'order_type', 'product'].includes(type)) { res.status(400).json({ success: false, error: { message: 'Niveau inconnu' } }); return; }
  if (['store', 'product'].includes(type) && !/^[0-9a-f-]{36}$/i.test(sid)) { res.status(400).json({ success: false, error: { message: 'Identifiant invalide' } }); return; }
  res.json({ success: true, data: await productionImpactRepository.forPolicyScope(type as never, sid.slice(0, 60)) });
}));
router.get('/policies', authenticate, can('production.view'), asyncHandler(productionController.listPolicies));
router.put('/policies/:key', authenticate, authorizeSettings('production', 'edit'), validate(setPolicySchema), asyncHandler(productionController.setPolicy));
router.put('/settings', authenticate, can('production.edit'), validate(productionSettingsSchema), asyncHandler(productionController.updateSettings));
router.post('/transfers/:transferId/receive', authenticate, idempotent(), validateUuidParams('transferId'), can('production.receive'), validate(receiveProductionTransferSchema), asyncHandler(productionController.confirmProductionTransfer));

// M9 — sous-traitance : suivi, sous-traitant et façon, bon d'envoi des composants.
const subcontractError = (res: import('express').Response, e: unknown) => {
  if (e instanceof SubcontractError) { res.status(e.status).json({ success: false, error: { message: e.message } }); return; }
  throw e;
};
router.get('/:id/serials', authenticate, id, can('production.view'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productSerialRepository.listForPlan(req.params.id as string) });
}));
router.get('/:id/subcontract', authenticate, id, can('production.view'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await subcontractingRepository.get(req.params.id as string) });
}));
router.put('/:id/subcontract', authenticate, id, can('production.edit'), validate(subcontractSetupSchema), asyncHandler(async (req, res) => {
  try { res.json({ success: true, data: await subcontractingRepository.setup(req.params.id as string, req.body) }); } catch (e) { subcontractError(res, e); }
}));
router.post('/:id/subcontract/ship', authenticate, id, can('production.edit'), validate(subcontractShipSchema), asyncHandler(async (req, res) => {
  try {
    const r = await subcontractingRepository.ship(req.params.id as string, (req as AuthRequest).user!.userId, req.body?.notes);
    res.status(201).json({ success: true, data: r });
  } catch (e) { subcontractError(res, e); }
}));
router.get('/:id/sub-recipe-analysis', authenticate, id, asyncHandler(productionController.analyzeSubRecipes));
// M8-05 — synthèse chiffrée de l'ordre (quantités, rendement, pertes, coût par pièce), calculée au serveur.
router.get('/:id/summary', authenticate, id, can('production.view'), asyncHandler(async (req, res) => {
  const data = await planSummaryRepository.get(req.params.id as string);
  if (!data) { res.status(404).json({ success: false, error: { message: 'Ordre introuvable' } }); return; }
  res.json({ success: true, data });
}));
// Étape 6 multi-industries — registre des documents de production (lecture : écrans d'impression).
router.get('/documents', authenticate, can('production.view'), asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await productionDocumentRepository.list() });
}));
// Étape 8 multi-industries — réservations de matière de l'ordre.
router.get('/:id/reservations', authenticate, id, can('production.view'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await materialReservationRepository.forPlan(req.params.id as string) });
}));
// Étape 5 multi-industries — avancement de l'ordre sur son parcours publié.
router.get('/:id/progress', authenticate, id, can('production.view'), asyncHandler(async (req, res) => {
  const data = await planProgress(req.params.id as string);
  if (!data) { res.status(404).json({ success: false, error: { message: 'Ordre introuvable' } }); return; }
  res.json({ success: true, data });
}));
router.get('/:id', authenticate, id, asyncHandler(productionController.getById));
router.post('/', authenticate, can('production.create'), validate(createPlanSchema), asyncHandler(productionController.create));
router.put('/:id/header', authenticate, id, can('production.header'), validate(updatePlanHeaderSchema), asyncHandler(productionController.updateHeader));
router.put('/:id/items/:itemId/recipe', authenticate, validateUuidParams('id', 'itemId'), can('production.items'), validate(itemRecipeSchema), asyncHandler(productionController.setItemRecipe));
// M6-01 : sorties manuelles (type d'ordre en consommation « manuel ») et écart théorique / réel.
router.post('/:id/manual-consumption', authenticate, validateUuidParams('id'), can('production.items'), validate(manualConsumptionSchema), asyncHandler(async (req, res) => {
  try {
    res.status(201).json({ success: true, data: await productionConsumptionRepository.manualIssue(req.params.id as string, req.body, (req as never as { user: { userId: string } }).user.userId) });
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode ?? 400;
    res.status(status).json({ success: false, error: { message: err instanceof Error ? err.message : 'Sortie impossible' } });
  }
}));
router.get('/:id/consumption-variance', authenticate, validateUuidParams('id'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productionConsumptionRepository.variance(req.params.id as string) });
}));
router.put('/:id/items', authenticate, id, can('production.items'), validate(updateItemsSchema), asyncHandler(productionController.updateItems));
router.post('/:id/confirm', authenticate, idempotent(), id, can('production.confirm'), validate(emptyBody), asyncHandler(productionController.confirm));
router.post('/:id/revert-to-draft', authenticate, id, can('production.revert_to_draft'), validate(emptyBody), asyncHandler(productionController.revertToDraft));
router.post('/:id/relaunch', authenticate, id, can('production.relaunch'), validate(relaunchSchema), asyncHandler(productionController.relaunch));
router.post('/:id/start', authenticate, idempotent(), id, can('production.start'), validate(emptyBody), asyncHandler(productionController.start));
router.post('/:id/start-items', authenticate, idempotent(), id, can('production.start_items'), validate(startItemsSchema), asyncHandler(productionController.startItems));
router.post('/:id/produce-items', authenticate, idempotent(), id, can('production.produce_items'), validate(produceItemsSchema), asyncHandler(productionController.produceItems));
router.post('/:id/transfer-items', authenticate, idempotent(), id, can('production.transfer_items'), validate(itemIdsSchema), asyncHandler(productionController.transferItems));
router.post('/:id/restore-items', authenticate, id, can('production.restore_items'), validate(restoreItemsSchema), asyncHandler(productionController.restoreItems));
router.post('/:id/needs/:ingredientId/request-verification', authenticate, validateUuidParams('id', 'ingredientId'), can('production.request_verification'), validate(requestStockVerificationSchema), asyncHandler(productionController.requestStockVerification));
router.post('/:id/cancel-items', authenticate, id, can('production.cancel_items'), validate(cancelItemsSchema), asyncHandler(productionController.cancelItems));
router.post('/:id/complete', authenticate, idempotent(), id, can('production.complete'), validate(completeSchema), asyncHandler(productionController.complete));
router.post('/:id/detect-semi-finished', authenticate, id, can('production.detect_semi_finished'), validate(emptyBody), asyncHandler(productionController.detectSemiFinished));
router.get('/:id/dependencies', authenticate, id, asyncHandler(productionController.getPlanDependencies));
router.get('/:id/activities', authenticate, id, asyncHandler(productionController.getActivities));
// Journal des transitions (plan + bons) — mig 299
router.get('/:id/events', authenticate, id, asyncHandler(productionController.getEvents));
router.post('/:id/activities', authenticate, id, can('production.activities'), validate(addActivitySchema), asyncHandler(productionController.addActivity));
router.delete('/:id', authenticate, id, can('production.delete'), asyncHandler(productionController.remove));

export default router;
