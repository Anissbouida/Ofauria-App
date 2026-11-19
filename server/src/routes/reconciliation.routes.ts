import { Router, json as expressJson } from 'express';
import { reconciliationController } from '../controllers/reconciliation.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import { emptyBody } from '../validators/common.validator.js';
import * as PF from '../validators/payments-flow.validator.js';

// Module Contrôle des ventes (ISOLE, TEMPORAIRE) — admin / gerant.
// Parser local elargi : la limite globale (10kb, OWASP A04) est trop serree pour
// les imports batch (catalogue Loyverse ~350 produits, ventes du jour, appro en
// masse). 512 Ko donne de la marge (~150 o/produit x 350 ≈ 50 Ko) en restant
// inexploitable pour un abus DoS ; routes reservees admin/gerant.
const router = Router();

router.use(expressJson({ limit: '512kb' }));
router.use(authenticate);

// Journees
router.get('/days', can('reconciliation.view'), asyncHandler(reconciliationController.listDays));
router.get('/days/:id', can('reconciliation.view'), asyncHandler(reconciliationController.getDay));
router.get('/days/:id/export.xlsx', can('reconciliation.view'), asyncHandler(reconciliationController.exportDay));
router.post('/days', can('reconciliation.days'), validate(PF.reconOpenDaySchema), asyncHandler(reconciliationController.openDay));
router.post('/days/:id/close', can('reconciliation.close'), validateUuidParams('id'), validate(PF.reconCloseSchema), asyncHandler(reconciliationController.close));
router.post('/days/:id/reopen', can('reconciliation.reopen'), validateUuidParams('id'), validate(emptyBody), asyncHandler(reconciliationController.reopen));

// Shifts (mig 262) : cloture a la passation, saisie par shift
router.post('/shifts/:id/close', can('reconciliation.close'), validateUuidParams('id'), validate(PF.reconCloseSchema), asyncHandler(reconciliationController.closeShift));
router.post('/shifts/:id/reopen', can('reconciliation.reopen'), validateUuidParams('id'), validate(emptyBody), asyncHandler(reconciliationController.reopenShift));

// Lignes (rattachees a un shift)
router.post('/shifts/:id/lines', can('reconciliation.lines'), validateUuidParams('id'), validate(PF.reconUpsertLineSchema), asyncHandler(reconciliationController.upsertLine));
router.post('/shifts/:id/bulk-appro', can('reconciliation.bulk_appro'), validateUuidParams('id'), validate(PF.reconBulkApproSchema), asyncHandler(reconciliationController.bulkAppro));
router.put('/lines/:lineId', can('reconciliation.lines'), validateUuidParams('lineId'), validate(PF.reconUpdateLineSchema), asyncHandler(reconciliationController.updateLine));
router.delete('/lines/:lineId', can('reconciliation.delete'), asyncHandler(reconciliationController.deleteLine));

// Import Loyverse (ventes d'un shift : export filtre sur sa plage horaire)
router.post('/shifts/:id/import-sales', can('reconciliation.import_sales'), validateUuidParams('id'), validate(PF.reconImportSalesSchema), asyncHandler(reconciliationController.importSales));
router.post('/shifts/:id/reset-sales', can('reconciliation.reset_sales'), validateUuidParams('id'), validate(emptyBody), asyncHandler(reconciliationController.resetSales));
router.post('/shifts/:id/prefill-reste', can('reconciliation.prefill_reste'), validateUuidParams('id'), validate(emptyBody), asyncHandler(reconciliationController.prefillReste));

// Créneaux d'approvisionnement
router.get('/slots', can('reconciliation.view'), asyncHandler(reconciliationController.listSlots));
router.post('/slots', can('reconciliation.slots'), validate(PF.reconSlotSchema), asyncHandler(reconciliationController.upsertSlot));
router.delete('/slots/:id', can('reconciliation.delete'), asyncHandler(reconciliationController.deleteSlot));

// Report du reste de la veille (catégories concernées)
router.get('/carryover', can('reconciliation.view'), asyncHandler(reconciliationController.listCarryOver));
router.put('/carryover', can('reconciliation.edit'), validate(PF.reconCarryOverSchema), asyncHandler(reconciliationController.setCarryOver));

// Catalogue produits
router.get('/products', can('reconciliation.view'), asyncHandler(reconciliationController.listProducts));
router.post('/products', can('reconciliation.products'), validate(PF.reconProductSchema), asyncHandler(reconciliationController.upsertProduct));
router.post('/products/bulk', can('reconciliation.bulk'), validate(PF.reconBulkProductsSchema), asyncHandler(reconciliationController.bulkProducts));
router.delete('/products', can('reconciliation.delete'), asyncHandler(reconciliationController.clearProducts));
router.delete('/products/:id', can('reconciliation.delete'), asyncHandler(reconciliationController.deleteProduct));

// Traductions darija (nom produit → écriture arabe)
router.get('/darija', can('reconciliation.view'), asyncHandler(reconciliationController.listDarija));
router.post('/darija', can('reconciliation.darija'), validate(PF.reconDarijaSchema), asyncHandler(reconciliationController.upsertDarija));

// Suggestion fiche de besoin (J-7 / J-14)
router.get('/suggest', can('reconciliation.view'), asyncHandler(reconciliationController.suggest));

// Fiche de besoin partagée (enregistrée en base, visible par tous)
router.get('/fiche', can('reconciliation.view'), asyncHandler(reconciliationController.getFiche));
router.put('/fiche', can('reconciliation.edit'), validate(PF.reconFicheSchema), asyncHandler(reconciliationController.saveFiche));

// Rapport de periode
router.get('/report', can('reconciliation.view'), asyncHandler(reconciliationController.report));

export default router;
