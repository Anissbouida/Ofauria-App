import { Router, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import { inventoryController, ingredientController } from '../controllers/inventory.controller.js';
import { ingredientImportController } from '../controllers/ingredient-import.controller.js';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { inventoryRepository } from '../repositories/inventory.repository.js';
import { can } from '../middleware/permission.middleware.js';
import { requireUnits, requireStockUnitChange } from '../services/unit-referential.js';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { conversionHandlers, createConversionSchema, updateConversionSchema } from '../controllers/item-conversions.controller.js';

const ingredientConversions = conversionHandlers('ingredient');
import { restockSchema, adjustStockSchema, stockThresholdSchema, resolveStockAnomalySchema, mergeIngredientsSchema, correctIngredientCostSchema, ingredientAllergensSchema, ingredientNutritionSchema, reorderApplySchema, reorderUpdateSchema, reorderRecalculateSchema } from '../validators/stock.validator.js';
import { emptyBody } from '../validators/common.validator.js';
import { stockClosingSchema, createIngredientSchema, updateIngredientSchema, convertToConsumableSchema } from '../validators/stock-flow.validator.js';

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
// Refonte Stock (mig 724) : liste unique des mouvements, par pièce.
router.get('/movements', authenticate, can('stock.inventory.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const q = req.query as Record<string, string | undefined>;
  res.json({ success: true, data: await inventoryRepository.movements({
    type: q.type && /^[a-z_]{2,40}$/.test(q.type) ? q.type : undefined, days: q.days ? Number(q.days) : undefined,
    storeId: req.user!.role === 'admin' ? undefined : req.user!.storeId ?? undefined,
  }) });
}));
// Mig 722 : vue unique des réservations (commandes et ordres de fabrication) avec le disponible.
router.get('/reservations', authenticate, can('stock.inventory.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await inventoryRepository.reservations(req.user!.role === 'admin' ? undefined : req.user!.storeId ?? undefined) });
}));
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
router.get('/reorder-points', authenticate, can('stock.inventory.view'), inventoryController.reorderPoints);
router.post('/reorder-points/recalculate', authenticate, can('stock.inventory.reorder_points'), validate(reorderRecalculateSchema), inventoryController.reorderRecalculate);
router.post('/reorder-points/apply', authenticate, can('stock.inventory.reorder_points'), validate(reorderApplySchema), inventoryController.reorderApply);
router.put('/reorder-points/:id', authenticate, validateUuidParams('id'), can('stock.inventory.reorder_points'), validate(reorderUpdateSchema), inventoryController.reorderUpdate);
router.get('/stock-at', authenticate, can('stock.inventory.view'), inventoryController.stockAt);
router.get('/stock-journal-gaps', authenticate, can('stock.inventory.view'), inventoryController.journalGaps);
router.get('/closings/preview', authenticate, can('stock.inventory.view'), inventoryController.closingPreview);
router.get('/closings', authenticate, can('stock.inventory.view'), inventoryController.closingList);
router.post('/closings', authenticate, can('stock.inventory.closings'), validate(stockClosingSchema), inventoryController.closingCreate);
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
  validate(emptyBody),
  ingredientImportController.preview
);
ingredientsRouter.post(
  '/import/commit',
  authenticate,
  can('stock.ingredients.commit'),
  ingredientImportUpload.single('file'),
  validate(emptyBody),
  ingredientImportController.commit
);

ingredientsRouter.get('/', authenticate, ingredientController.list);
// G2-06 — grille des allergènes (déclarée avant /:id).
ingredientsRouter.get('/allergen-grid', authenticate, can('stock.ingredients.view'), asyncHandler(ingredientController.allergenGrid));
ingredientsRouter.put('/:id/allergens', authenticate, can('stock.ingredients.allergens'), validate(ingredientAllergensSchema), asyncHandler(ingredientController.saveAllergens));
// Mig 634 : valeurs nutritionnelles pour 100 g (étiquette des articles préemballés).
ingredientsRouter.get('/:id/nutrition', authenticate, validateUuidParams('id'), can('stock.ingredients.view'), asyncHandler(async (req, res) => {
  const { ingredientNutritionRepository } = await import('../repositories/ingredient-nutrition.repository.js');
  const n = await ingredientNutritionRepository.get(String(req.params.id));
  if (n === undefined) { res.status(404).json({ success: false, error: { message: 'Matière introuvable' } }); return; }
  res.json({ success: true, data: n });
}));
ingredientsRouter.put('/:id/nutrition', authenticate, can('stock.ingredients.allergens'), validate(ingredientNutritionSchema), asyncHandler(async (req, res) => {
  const { ingredientNutritionRepository } = await import('../repositories/ingredient-nutrition.repository.js');
  const row = await ingredientNutritionRepository.save(String(req.params.id), (req.body as { nutrition: Record<string, number | null> | null }).nutrition);
  if (!row) { res.status(404).json({ success: false, error: { message: 'Matière introuvable' } }); return; }
  res.json({ success: true, data: row });
}));
// Conversions propres à l'ingrédient (M3-02).
ingredientsRouter.get('/:id/conversions', authenticate, validateUuidParams('id'), asyncHandler(ingredientConversions.list));
ingredientsRouter.post('/:id/conversions', authenticate, validateUuidParams('id'), can('stock.ingredients.edit'), validate(createConversionSchema), asyncHandler(ingredientConversions.create));
ingredientsRouter.put('/:id/conversions/:convId', authenticate, validateUuidParams('id', 'convId'), can('stock.ingredients.edit'), validate(updateConversionSchema), asyncHandler(ingredientConversions.update));
ingredientsRouter.delete('/:id/conversions/:convId', authenticate, validateUuidParams('id', 'convId'), can('stock.ingredients.edit'), asyncHandler(ingredientConversions.remove));
ingredientsRouter.get('/:id', authenticate, ingredientController.getById);
// Unité de stock : code du référentiel `units` (mig 515).
const stockUnitOf = requireUnits((body: { unit?: string | null }) => [{ unit: body.unit }]);
ingredientsRouter.post('/', authenticate, can('stock.ingredients.create'), validate(createIngredientSchema), stockUnitOf, ingredientController.create);
ingredientsRouter.put('/:id', authenticate, can('stock.ingredients.edit'), validateUuidParams('id'), validate(updateIngredientSchema), stockUnitOf, requireStockUnitChange(), ingredientController.update);
// Convertit un ingredient mal range en consommable (packaging_items)
ingredientsRouter.post('/:id/convert-to-consumable', authenticate, can('stock.ingredients.convert_to_consumable'), validateUuidParams('id'), validate(convertToConsumableSchema), ingredientController.convertToConsumable);
// Suppression : admin + gerant (cf demande utilisateur — flexibilite mise en place)
ingredientsRouter.delete('/:id', authenticate, can('stock.ingredients.delete'), ingredientController.remove);
