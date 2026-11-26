import { Router, type Response } from 'express';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import { freightRateRepository, type FreightGridInput } from '../repositories/freight-rate.repository.js';
import { freightGridSchema, freightPriceSchema } from '../validators/sales-terms.validator.js';

/**
 * Grilles tarifaires du transport (mig 714, feuille de route étape 3.4). Fermées par la
 * capacité grille_transport. Consulter et calculer un prix : équipe de vente ; gérer : direction.
 */
const router = Router();
const ok = (res: Response, data: unknown) => res.json({ success: true, data });
const toInput = (b: Record<string, any>): FreightGridInput => ({
  name: String(b.name ?? ''), customerId: b.customerId ?? null, basis: String(b.basis ?? ''),
  originZone: b.originZone ?? null, destinationZone: b.destinationZone ?? null,
  minimumCharge: Number(b.minimumCharge ?? 0), tvaRate: Number(b.tvaRate ?? 0),
  validFrom: b.validFrom || null, validTo: b.validTo || null, isActive: b.isActive !== false,
  brackets: (Array.isArray(b.brackets) ? b.brackets : []).map((x: Record<string, any>) => ({
    upTo: x.upTo === null || x.upTo === undefined || x.upTo === '' ? null : Number(x.upTo),
    unitPrice: Number(x.unitPrice ?? 0), flatPrice: Number(x.flatPrice ?? 0),
  })),
});

router.get('/', authenticate, can('sales.freight_rates.view'),
  asyncHandler(async (_req: AuthRequest, res: Response) => ok(res, await freightRateRepository.list())));
router.post('/price', authenticate, can('sales.freight_rates.view'), validate(freightPriceSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body as Record<string, any>;
    ok(res, await freightRateRepository.price({ basis: String(b.basis ?? ''), quantity: Number(b.quantity), customerId: b.customerId ?? null,
      originZone: b.originZone ?? null, destinationZone: b.destinationZone ?? null, date: b.date ?? null }));
  }));
router.post('/', authenticate, can('sales.freight_rates.manage'), validate(freightGridSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => ok(res, { id: await freightRateRepository.create(toInput(req.body), req.user!.userId) })));
router.put('/:id', authenticate, can('sales.freight_rates.manage'), validateUuidParams('id'), validate(freightGridSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => { await freightRateRepository.update(String(req.params.id), toInput(req.body)); ok(res, null); }));
router.delete('/:id', authenticate, can('sales.freight_rates.manage'), validateUuidParams('id'),
  asyncHandler(async (req: AuthRequest, res: Response) => { await freightRateRepository.remove(String(req.params.id)); ok(res, null); }));

export default router;
