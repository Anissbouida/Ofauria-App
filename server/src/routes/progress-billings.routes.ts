import { Router, type Response } from 'express';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import { progressBillingRepository } from '../repositories/progress-billing.repository.js';
import { progressBillingDraftSchema, progressBillingTermsSchema, progressBillingActionSchema } from '../validators/sales-terms.validator.js';

/**
 * Facturation à l'avancement — situations de travaux (mig 713, feuille de route étape 3.3).
 * Fermée par la capacité facturation_avancement (garde d'activation, registre partagé).
 * Lecture et préparation : direction (montants du marché).
 */
const router = Router();
const ok = (res: Response, data: unknown) => res.json({ success: true, data });

router.get('/contracts', authenticate, can('sales.progress_billings.view'),
  asyncHandler(async (_req: AuthRequest, res: Response) => ok(res, await progressBillingRepository.contracts())));
router.get('/', authenticate, can('sales.progress_billings.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => ok(res, await progressBillingRepository.list(typeof req.query.quoteId === 'string' ? req.query.quoteId : undefined))));
router.get('/prepare/:quoteId', authenticate, can('sales.progress_billings.view'), validateUuidParams('quoteId'),
  asyncHandler(async (req: AuthRequest, res: Response) => ok(res, await progressBillingRepository.prepare(String(req.params.quoteId)))));
router.get('/:id', authenticate, can('sales.progress_billings.view'), validateUuidParams('id'),
  asyncHandler(async (req: AuthRequest, res: Response) => ok(res, await progressBillingRepository.get(String(req.params.id)))));
router.put('/terms/:quoteId', authenticate, can('sales.progress_billings.manage'), validateUuidParams('quoteId'), validate(progressBillingTermsSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body as { retentionPct: number | string; advanceAmount: number | string; advanceRecoveryPct: number | string };
    await progressBillingRepository.setTerms(String(req.params.quoteId), { retentionPct: Number(b.retentionPct), advanceAmount: Number(b.advanceAmount), advanceRecoveryPct: Number(b.advanceRecoveryPct) });
    ok(res, await progressBillingRepository.prepare(String(req.params.quoteId)));
  }));
router.post('/draft/:quoteId', authenticate, can('sales.progress_billings.manage'), validateUuidParams('quoteId'), validate(progressBillingDraftSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body as { periodEnd: string; notes?: string | null; lines?: { quoteItemId: string; pctCumulative: number | string }[] | null };
    ok(res, await progressBillingRepository.saveDraft(String(req.params.quoteId), {
      periodEnd: b.periodEnd, notes: b.notes, lines: (b.lines ?? []).map(l => ({ quoteItemId: l.quoteItemId, pctCumulative: Number(l.pctCumulative) })),
    }, req.user!.userId));
  }));
router.put('/:id/validate', authenticate, can('sales.progress_billings.manage'), validateUuidParams('id'), validate(progressBillingActionSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => ok(res, await progressBillingRepository.validate(String(req.params.id), req.user!.userId))));
router.put('/:id/cancel', authenticate, can('sales.progress_billings.manage'), validateUuidParams('id'), validate(progressBillingActionSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => { await progressBillingRepository.cancel(String(req.params.id)); ok(res, null); }));

export default router;
