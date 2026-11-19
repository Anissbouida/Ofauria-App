import { Router } from 'express';
import { stockFrigoController } from '../controllers/stock-frigo.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import { emptyBody } from '../validators/common.validator.js';
import { frigoSurplusSchema, frigoConsumeSchema, frigoLossSchema, frigoAdjustSchema } from '../validators/stock-flow.validator.js';

const router = Router();

// List & summary
router.get('/', authenticate, asyncHandler(stockFrigoController.list));
router.get('/summary', authenticate, asyncHandler(stockFrigoController.summary));
router.get('/base-recipes', authenticate, asyncHandler(stockFrigoController.baseRecipes));
router.get('/recipe-lineage/:recipeId', authenticate, asyncHandler(stockFrigoController.recipeLineage));
router.get('/available/:productId', authenticate, asyncHandler(stockFrigoController.available));

// Mutations (admin/manager only)
router.post('/surplus', authenticate, can('production.stock_frigo.surplus'), validate(frigoSurplusSchema), asyncHandler(stockFrigoController.addSurplus));
router.post('/consume', authenticate, can('production.stock_frigo.consume'), validate(frigoConsumeSchema), asyncHandler(stockFrigoController.consume));
router.put('/:id/loss', authenticate, can('production.stock_frigo.loss'), validateUuidParams('id'), validate(frigoLossSchema), asyncHandler(stockFrigoController.recordLoss));
router.put('/:id/adjust', authenticate, can('production.stock_frigo.adjust'), validateUuidParams('id'), validate(frigoAdjustSchema), asyncHandler(stockFrigoController.adjust));

// F-044 — Reconciliation semi-finis <-> lots : rapport (dry-run) pour le gerant,
// application reservee a l'admin (mutation du stock agrege, tracee).
router.get('/reconciliation', authenticate, can('production.stock_frigo.view'), asyncHandler(stockFrigoController.reconcile));
router.post('/reconciliation/apply', authenticate, can('production.stock_frigo.apply'), validate(emptyBody), asyncHandler(stockFrigoController.reconcile));

// Transactions history
router.get('/:id/transactions', authenticate, asyncHandler(stockFrigoController.transactions));

export default router;
