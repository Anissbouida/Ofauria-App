import { Router } from 'express';
import { productionController } from '../controllers/production.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { authorizeSettings } from '../middleware/settings-access.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate, validateQuery, validateUuidParams } from '../middleware/validate.middleware.js';
import {
  createPlanSchema, updateItemsSchema, itemIdsSchema, startItemsSchema, produceItemsSchema,
  completeSchema, cancelItemsSchema, relaunchSchema, addActivitySchema, requestStockVerificationSchema, listQuerySchema, setPolicySchema,
  createOrderTypeSchema, updateOrderTypeSchema, updatePlanHeaderSchema, mrpPhasedValidateSchema, masterScheduleSchema,
} from '../validators/production.validator.js';

const id = validateUuidParams('id');

const router = Router();

router.get('/', authenticate, validateQuery(listQuerySchema), asyncHandler(productionController.list));
// Ateliers (mig 511) : lecture pour tout utilisateur connecté (libellés des plans, caisse),
// création / modification par le paramétrage Production. Avant /:id.
router.get('/workshops', authenticate, asyncHandler(productionController.workshops));
router.put('/workshops/:code', authenticate, authorizeSettings('production', 'edit'), asyncHandler(productionController.saveWorkshop));
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
router.post('/mrp/generate', authenticate, can('production.generate'), asyncHandler(productionController.mrpGenerate));
// MRP — besoins matière (achats) & génération des demandes d'achat — roadmap lot 8
router.get('/mrp/material-requirements', authenticate, can('production.view'), asyncHandler(productionController.mrpMaterialRequirements));
router.post('/mrp/generate-purchase-requests', authenticate, can('production.generate_purchase_requests'), asyncHandler(productionController.mrpGeneratePurchaseRequests));
// Réglages de production centralisés — roadmap lot 9. Avant /:id.
router.get('/settings', authenticate, can('production.view'), asyncHandler(productionController.getSettings));
// M1-04 — politiques de production (lecture : production ; écriture : droit Paramètres › Production).
router.get('/order-types', authenticate, can('production.view'), asyncHandler(productionController.listOrderTypes));
router.post('/order-types', authenticate, authorizeSettings('production', 'edit'), validate(createOrderTypeSchema), asyncHandler(productionController.createOrderType));
router.put('/order-types/:typeId', authenticate, validateUuidParams('typeId'), authorizeSettings('production', 'edit'), validate(updateOrderTypeSchema), asyncHandler(productionController.updateOrderType));
router.get('/policies', authenticate, can('production.view'), asyncHandler(productionController.listPolicies));
router.put('/policies/:key', authenticate, authorizeSettings('production', 'edit'), validate(setPolicySchema), asyncHandler(productionController.setPolicy));
router.put('/settings', authenticate, can('production.edit'), asyncHandler(productionController.updateSettings));
router.post('/transfers/:transferId/receive', authenticate, validateUuidParams('transferId'), can('production.receive'), asyncHandler(productionController.confirmProductionTransfer));

router.get('/:id/sub-recipe-analysis', authenticate, id, asyncHandler(productionController.analyzeSubRecipes));
router.get('/:id', authenticate, id, asyncHandler(productionController.getById));
router.post('/', authenticate, can('production.create'), validate(createPlanSchema), asyncHandler(productionController.create));
router.put('/:id/header', authenticate, id, can('production.header'), validate(updatePlanHeaderSchema), asyncHandler(productionController.updateHeader));
router.put('/:id/items', authenticate, id, can('production.items'), validate(updateItemsSchema), asyncHandler(productionController.updateItems));
router.post('/:id/confirm', authenticate, id, can('production.confirm'), asyncHandler(productionController.confirm));
router.post('/:id/revert-to-draft', authenticate, id, can('production.revert_to_draft'), asyncHandler(productionController.revertToDraft));
router.post('/:id/relaunch', authenticate, id, can('production.relaunch'), validate(relaunchSchema), asyncHandler(productionController.relaunch));
router.post('/:id/start', authenticate, id, can('production.start'), asyncHandler(productionController.start));
router.post('/:id/start-items', authenticate, id, can('production.start_items'), validate(startItemsSchema), asyncHandler(productionController.startItems));
router.post('/:id/produce-items', authenticate, id, can('production.produce_items'), validate(produceItemsSchema), asyncHandler(productionController.produceItems));
router.post('/:id/transfer-items', authenticate, id, can('production.transfer_items'), validate(itemIdsSchema), asyncHandler(productionController.transferItems));
router.post('/:id/restore-items', authenticate, id, can('production.restore_items'), validate(itemIdsSchema), asyncHandler(productionController.restoreItems));
router.post('/:id/needs/:ingredientId/request-verification', authenticate, validateUuidParams('id', 'ingredientId'), can('production.request_verification'), validate(requestStockVerificationSchema), asyncHandler(productionController.requestStockVerification));
router.post('/:id/cancel-items', authenticate, id, can('production.cancel_items'), validate(cancelItemsSchema), asyncHandler(productionController.cancelItems));
router.post('/:id/complete', authenticate, id, can('production.complete'), validate(completeSchema), asyncHandler(productionController.complete));
router.post('/:id/detect-semi-finished', authenticate, id, can('production.detect_semi_finished'), asyncHandler(productionController.detectSemiFinished));
router.get('/:id/dependencies', authenticate, id, asyncHandler(productionController.getPlanDependencies));
router.get('/:id/activities', authenticate, id, asyncHandler(productionController.getActivities));
// Journal des transitions (plan + bons) — mig 299
router.get('/:id/events', authenticate, id, asyncHandler(productionController.getEvents));
router.post('/:id/activities', authenticate, id, can('production.activities'), validate(addActivitySchema), asyncHandler(productionController.addActivity));
router.delete('/:id', authenticate, id, can('production.delete'), asyncHandler(productionController.remove));

export default router;
