import { Router } from 'express';
import { reconciliationController } from '../controllers/reconciliation.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ROLE_GROUPS } from '@ofauria/shared';

// Module Rapprochement journalier (ISOLE, TEMPORAIRE) — admin / gerant.
const router = Router();

router.use(authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER));

// Journees
router.get('/days', asyncHandler(reconciliationController.listDays));
router.get('/days/:id', asyncHandler(reconciliationController.getDay));
router.post('/days', asyncHandler(reconciliationController.openDay));
router.post('/days/:id/close', asyncHandler(reconciliationController.close));
router.post('/days/:id/reopen', asyncHandler(reconciliationController.reopen));

// Lignes
router.post('/days/:id/lines', asyncHandler(reconciliationController.upsertLine));
router.post('/days/:id/bulk-appro', asyncHandler(reconciliationController.bulkAppro));
router.put('/lines/:lineId', asyncHandler(reconciliationController.updateLine));
router.delete('/lines/:lineId', asyncHandler(reconciliationController.deleteLine));

// Import Loyverse (ventes)
router.post('/days/:id/import-sales', asyncHandler(reconciliationController.importSales));

// Créneaux d'approvisionnement
router.get('/slots', asyncHandler(reconciliationController.listSlots));
router.post('/slots', asyncHandler(reconciliationController.upsertSlot));
router.delete('/slots/:id', asyncHandler(reconciliationController.deleteSlot));

// Catalogue produits
router.get('/products', asyncHandler(reconciliationController.listProducts));
router.post('/products', asyncHandler(reconciliationController.upsertProduct));
router.post('/products/bulk', asyncHandler(reconciliationController.bulkProducts));
router.delete('/products/:id', asyncHandler(reconciliationController.deleteProduct));

// Traductions darija (nom produit → écriture arabe)
router.get('/darija', asyncHandler(reconciliationController.listDarija));
router.post('/darija', asyncHandler(reconciliationController.upsertDarija));

// Suggestion fiche de besoin (J-7 / J-14)
router.get('/suggest', asyncHandler(reconciliationController.suggest));

// Rapport de periode
router.get('/report', asyncHandler(reconciliationController.report));

export default router;
