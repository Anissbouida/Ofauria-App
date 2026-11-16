import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { inventoryController, ingredientController } from '../controllers/inventory.controller.js';
import { ingredientImportController } from '../controllers/ingredient-import.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';
import { requireUnits, requireStockUnitChange } from '../services/unit-referential.js';
import { validate } from '../middleware/validate.middleware.js';
import { restockSchema, adjustStockSchema, stockThresholdSchema, resolveStockAnomalySchema } from '../validators/stock.validator.js';

const router = Router();

router.get('/', authenticate, inventoryController.list);
router.get('/alerts', authenticate, inventoryController.alerts);
// G0-07 : mouvements de stock validés par schéma.
router.post('/restock', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validate(restockSchema), inventoryController.restock);
router.post('/adjust', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validate(adjustStockSchema), inventoryController.adjust);
router.put('/threshold', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validate(stockThresholdSchema), inventoryController.updateThreshold);
router.get('/transactions', authenticate, inventoryController.transactions);
// Consommation matieres par periode (admin/gerant, utilise par Comptabilite)
router.get('/consumption', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), inventoryController.consumption);
// Achats / approvisionnement matieres par periode (entrees de stock, BC + achat direct)
router.get('/purchases', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), inventoryController.purchases);
// Age du stock matiere : lots actifs par anciennete (admin/gerant)
router.get('/aging', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), inventoryController.aging);
// G0-18 : sorties supérieures au stock, tracées puis régularisées (admin/gérant).
router.get('/stock-anomalies', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), inventoryController.anomalies);
router.post('/stock-anomalies/:id/resolve', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validate(resolveStockAnomalySchema), inventoryController.resolveAnomaly);
// G0-26 : lignes de fiche technique dont l'unité ne se convertit pas vers l'unité de stock.
router.get('/unit-conversion-issues', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), inventoryController.unitConversionIssues);
router.get('/price-health', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), inventoryController.priceHealth);

// Cloture de stock par periode (mig 381) : instantane valorise (admin/gerant)
router.get('/closings/preview', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), inventoryController.closingPreview);
router.get('/closings', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), inventoryController.closingList);
router.post('/closings', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), inventoryController.closingCreate);
router.get('/closings/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), inventoryController.closingGet);
router.delete('/closings/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), inventoryController.closingDelete);

export default router;

// Upload xlsx ingredients (in-memory, 5MB max, .xlsx/.xls)
const ingredientImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ext === '.xlsx' || ext === '.xls');
  },
});

export const ingredientsRouter = Router();

// Routes specifiques (import/export/template) — declarees AVANT /:id pour eviter
// que Express ne capture "import" comme un id.
ingredientsRouter.get('/export', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), ingredientImportController.export);
ingredientsRouter.get('/import/template', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), ingredientImportController.template);
ingredientsRouter.post(
  '/import/preview',
  authenticate,
  authorize(...ROLE_GROUPS.ADMIN_MANAGER),
  ingredientImportUpload.single('file'),
  ingredientImportController.preview
);
ingredientsRouter.post(
  '/import/commit',
  authenticate,
  authorize(...ROLE_GROUPS.ADMIN_MANAGER),
  ingredientImportUpload.single('file'),
  ingredientImportController.commit
);

ingredientsRouter.get('/', authenticate, ingredientController.list);
ingredientsRouter.get('/:id', authenticate, ingredientController.getById);
// Unité de stock : code du référentiel `units` (mig 515).
const stockUnitOf = requireUnits((body: { unit?: string | null }) => [{ unit: body.unit }]);
ingredientsRouter.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), stockUnitOf, ingredientController.create);
ingredientsRouter.put('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), stockUnitOf, requireStockUnitChange(), ingredientController.update);
// Convertit un ingredient mal range en consommable (packaging_items)
ingredientsRouter.post('/:id/convert-to-consumable', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), ingredientController.convertToConsumable);
// Suppression : admin + gerant (cf demande utilisateur — flexibilite mise en place)
ingredientsRouter.delete('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), ingredientController.remove);
