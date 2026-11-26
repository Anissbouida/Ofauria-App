import { Router, type Response } from 'express';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate } from '../middleware/validate.middleware.js';
import { depositStockRepository } from '../repositories/deposit-stock.repository.js';
import { depositArticleSchema, depositMoveSchema } from '../validators/sales-terms.validator.js';

/**
 * Stock des déposants (entrepôt pour compte de clients, mig 719). Fermé par la capacité
 * stock_deposant. Consulter : stock ; réceptionner et expédier : stock (création).
 */
const router = Router();
const ok = (res: Response, data: unknown) => res.json({ success: true, data });
const cust = (req: AuthRequest) => (typeof req.query.customerId === 'string' && req.query.customerId ? req.query.customerId : undefined);
const ctx = (req: AuthRequest) => ({ userId: req.user!.userId, storeId: req.user!.storeId ?? null });
const lines = (b: Record<string, any>) => (Array.isArray(b.lines) ? b.lines : []).map((l: Record<string, any>) => ({
  articleId: String(l.articleId ?? ''), quantity: Number(l.quantity), lotNumber: l.lotNumber ?? null, expirationDate: l.expirationDate || null,
}));

router.get('/articles', authenticate, can('stock.deposit.view'), asyncHandler(async (req: AuthRequest, res: Response) => ok(res, await depositStockRepository.articles(cust(req)))));
router.post('/articles', authenticate, can('stock.deposit.move'), validate(depositArticleSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body as Record<string, any>;
  ok(res, await depositStockRepository.createArticle({ customerId: String(b.customerId ?? ''), code: String(b.code ?? ''), label: String(b.label ?? ''), unit: b.unit ?? null }, req.user!.userId));
}));
router.get('/stock', authenticate, can('stock.deposit.view'), asyncHandler(async (req: AuthRequest, res: Response) => ok(res, await depositStockRepository.stock(cust(req)))));
router.get('/movements', authenticate, can('stock.deposit.view'), asyncHandler(async (req: AuthRequest, res: Response) => ok(res, await depositStockRepository.movements(cust(req)))));
router.post('/receive', authenticate, can('stock.deposit.move'), validate(depositMoveSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body as Record<string, any>;
  ok(res, await depositStockRepository.move('in', { reference: b.reference, note: b.note, locationId: b.locationId, lines: lines(b) }, ctx(req)));
}));
router.post('/ship', authenticate, can('stock.deposit.move'), validate(depositMoveSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body as Record<string, any>;
  ok(res, await depositStockRepository.move('out', { reference: b.reference, note: b.note, locationId: b.locationId, lines: lines(b) }, ctx(req)));
}));

export default router;
