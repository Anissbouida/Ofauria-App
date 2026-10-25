import { Router } from 'express';
import { stockFrigoController } from '../controllers/stock-frigo.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// List & summary
router.get('/', authenticate, asyncHandler(stockFrigoController.list));
router.get('/summary', authenticate, asyncHandler(stockFrigoController.summary));
router.get('/base-recipes', authenticate, asyncHandler(stockFrigoController.baseRecipes));
router.get('/recipe-lineage/:recipeId', authenticate, asyncHandler(stockFrigoController.recipeLineage));
router.get('/available/:productId', authenticate, asyncHandler(stockFrigoController.available));

// Mutations (admin/manager only)
router.post('/surplus', authenticate, authorize('admin', 'manager'), asyncHandler(stockFrigoController.addSurplus));
router.post('/consume', authenticate, authorize('admin', 'manager'), asyncHandler(stockFrigoController.consume));
router.put('/:id/loss', authenticate, authorize('admin', 'manager'), asyncHandler(stockFrigoController.recordLoss));
router.put('/:id/adjust', authenticate, authorize('admin', 'manager'), asyncHandler(stockFrigoController.adjust));

// F-044 — Reconciliation semi-finis <-> lots : rapport (dry-run) pour le gerant,
// application reservee a l'admin (mutation du stock agrege, tracee).
router.get('/reconciliation', authenticate, authorize('admin', 'manager'), asyncHandler(stockFrigoController.reconcile));
router.post('/reconciliation/apply', authenticate, authorize('admin'), asyncHandler(stockFrigoController.reconcile));

// Transactions history
router.get('/:id/transactions', authenticate, asyncHandler(stockFrigoController.transactions));

export default router;
