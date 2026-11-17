import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { inventoryController, ingredientController } from '../controllers/inventory.controller.js';
import { ingredientImportController } from '../controllers/ingredient-import.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { requireUnits, requireStockUnitChange } from '../services/unit-referential.js';
import { validate } from '../middleware/validate.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { restockSchema, adjustStockSchema, stockThresholdSchema, resolveStockAnomalySchema, mergeIngredientsSchema, correctIngredientCostSchema, ingredientAllergensSchema } from '../validators/stock.validator.js';

const router = Router();

router.get('/', authenticate, inventoryController.list);
router.get('/alerts', authenticate, inventoryController.alerts);
// G0-07 : mouvements de stock validés par schéma.
router.post('/restock', authenticate, can('stock.inventory.restock'), validate(restockSchema), inventoryController.restock);
router.post('/adjust', authenticate, can('stock.inventory.adjust'), validate(adjustStockSchema), inventoryController.adjust);
router.put('/threshold', authenticate, can('stock.inventory.edit'), validate(stockThresholdSchema), inventoryController.updateThreshold);
router.get('/transactions', authenticate, inventoryController.transactions);
// Consommation matieres par periode (admin/gerant, utilise par Comptabilite)
router.get('/consumption', authenticate, can('stock.inventory.view'), inventoryController.consumption);
// Achats / approvisionnement matieres par periode (entrees de stock, BC + achat direct)
router.get('/purchases', authenticate, can('stock.inventory.view'), inventoryController.purchases);
// Age du stock matiere : lots actifs par anciennete (admin/gerant)
router.get('/aging', authenticate, can('stock.inventory.view'), inventoryController.aging);
// G0-18 : sorties supérieures au stock, tracées puis régularisées (admin/gérant).
router.get('/stock-anomalies', authenticate, can('stock.inventory.view'), inventoryController.anomalies);
router.post('/stock-anomalies/:id/resolve', authenticate, can('stock.inventory.resolve'), validate(resolveStockAnomalySchema), inventoryController.resolveAnomaly);
// G0-26 : lignes de fiche technique dont l'unité ne se convertit pas vers l'unité de stock.
router.get('/unit-conversion-issues', authenticate, can('stock.inventory.view'), inventoryController.unitConversionIssues);
// G2-04 — prix aberrants : liste à revoir, correction tracée, journal.
router.get('/cost-corrections/suspects', authenticate, can('stock.inventory.view'), asyncHandler(inventoryController.costSuspects));
router.get('/cost-corrections', authenticate, can('stock.inventory.view'), asyncHandler(inventoryController.costCorrections));
router.post('/cost-corrections', authenticate, can('stock.inventory.cost_corrections'), validate(correctIngredientCostSchema), asyncHandler(inventoryController.correctCost));
// G2-03 — fusion des ingrédients en double (aperçu, fusion, journal).
router.get('/ingredient-merges', authenticate, can('stock.inventory.view'), asyncHandler(inventoryController.mergeHistory));
router.post('/ingredient-merges/preview', authenticate, can('stock.inventory.preview'), validate(mergeIngredientsSchema), asyncHandler(inventoryController.mergePreview));
router.post('/ingredient-merges', authenticate, can('stock.inventory.ingredient_merges'), validate(mergeIngredientsSchema), asyncHandler(inventoryController.mergeIngredients));
router.get('/price-health', authenticate, can('stock.inventory.view'), inventoryController.priceHealth);

// Cloture de stock par periode (mig 381) : instantane valorise (admin/gerant)
router.get('/closings/preview', authenticate, can('stock.inventory.view'), inventoryController.closingPreview);
router.get('/closings', authenticate, can('stock.inventory.view'), inventoryController.closingList);
router.post('/closings', authenticate, can('stock.inventory.closings'), inventoryController.closingCreate);
router.get('/closings/:id', authenticate, can('stock.inventory.view'), inventoryController.closingGet);
router.delete('/closings/:id', authenticate, can('stock.inventory.delete'), inventoryController.closingDelete);

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
ingredientsRouter.get('/export', authenticate, can('stock.ingredients.view'), ingredientImportController.export);
ingredientsRouter.get('/import/template', authenticate, can('stock.ingredients.view'), ingredientImportController.template);
ingredientsRouter.post(
  '/import/preview',
  authenticate,
  can('stock.ingredients.preview'),
  ingredientImportUpload.single('file'),
  ingredientImportController.preview
);
ingredientsRouter.post(
  '/import/commit',
  authenticate,
  can('stock.ingredients.commit'),
  ingredientImportUpload.single('file'),
  ingredientImportController.commit
);

ingredientsRouter.get('/', authenticate, ingredientController.list);
// G2-06 — grille des allergènes (déclarée avant /:id).
ingredientsRouter.get('/allergen-grid', authenticate, can('stock.ingredients.view'), asyncHandler(ingredientController.allergenGrid));
ingredientsRouter.put('/:id/allergens', authenticate, can('stock.ingredients.allergens'), validate(ingredientAllergensSchema), asyncHandler(ingredientController.saveAllergens));
ingredientsRouter.get('/:id', authenticate, ingredientController.getById);
// Unité de stock : code du référentiel `units` (mig 515).
const stockUnitOf = requireUnits((body: { unit?: string | null }) => [{ unit: body.unit }]);
ingredientsRouter.post('/', authenticate, can('stock.ingredients.create'), stockUnitOf, ingredientController.create);
ingredientsRouter.put('/:id', authenticate, can('stock.ingredients.edit'), stockUnitOf, requireStockUnitChange(), ingredientController.update);
// Convertit un ingredient mal range en consommable (packaging_items)
ingredientsRouter.post('/:id/convert-to-consumable', authenticate, can('stock.ingredients.convert_to_consumable'), ingredientController.convertToConsumable);
// Suppression : admin + gerant (cf demande utilisateur — flexibilite mise en place)
ingredientsRouter.delete('/:id', authenticate, can('stock.ingredients.delete'), ingredientController.remove);
