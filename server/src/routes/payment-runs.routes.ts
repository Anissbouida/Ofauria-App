import { Router } from 'express';
import { z } from 'zod';
import { paymentRunController } from '../controllers/payment-run.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';

/** Paiements fournisseurs en lot (G4-01) — direction uniquement, comme les règlements. */
const router = Router();
const id = validateUuidParams('id');

const createRunSchema = z.object({
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date de paiement invalide'),
  treasuryAccountId: z.string().uuid('Compte de trésorerie requis'),
  notes: z.string().max(1000).nullable().optional(),
  lines: z.array(z.object({ invoiceId: z.string().uuid(), amount: z.coerce.number().positive().max(100_000_000) })).min(1, 'Sélectionnez au moins une facture').max(500),
});
const rejectLineSchema = z.object({ reasonCodeId: z.string().uuid('Motif requis'), note: z.string().max(500).nullable().optional() });
const emptySchema = z.object({}).passthrough();

router.get('/candidates', authenticate, can('accounting.payment_runs.view'), asyncHandler(paymentRunController.candidates));
router.get('/', authenticate, can('accounting.payment_runs.view'), asyncHandler(paymentRunController.list));
router.post('/', authenticate, can('accounting.payment_runs.create'), validate(createRunSchema), asyncHandler(paymentRunController.create));
router.get('/:id', authenticate, can('accounting.payment_runs.view'), id, asyncHandler(paymentRunController.get));
router.post('/:id/submit', authenticate, can('accounting.payment_runs.submit'), id, validate(emptySchema), asyncHandler(paymentRunController.submit));
router.get('/:id/transfer-file', authenticate, can('accounting.payment_runs.view'), id, asyncHandler(paymentRunController.transferFile));
router.get('/:id/order-letter', authenticate, can('accounting.payment_runs.view'), id, asyncHandler(paymentRunController.orderLetter));
router.post('/:id/execute', authenticate, can('accounting.payment_runs.execute'), id, validate(emptySchema), asyncHandler(paymentRunController.execute));
router.post('/:id/cancel', authenticate, can('accounting.payment_runs.cancel'), id, validate(emptySchema), asyncHandler(paymentRunController.cancel));
router.post('/lines/:lineId/reject', authenticate, can('accounting.payment_runs.reject'), validateUuidParams('lineId'), validate(rejectLineSchema), asyncHandler(paymentRunController.rejectLine));

export default router;
