import { Router, type Response } from 'express';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import { emptyBody } from '../validators/common.validator.js';
import { transportOrderRepository, type TransportOrderInput } from '../repositories/transport-order.repository.js';
import { transportOrderSchema, transportOrderPlanSchema, transportOrderDeliverSchema } from '../validators/sales-terms.validator.js';

/**
 * Ordres de transport (mig 726, feuille de route étape 6.2). Fermés par la capacité
 * ordre_transport (garde d'activation, registre partagé). Consulter, saisir et faire avancer :
 * équipe d'exploitation ; facturer : direction.
 */
const router = Router();
const ok = (res: Response, data: unknown) => res.json({ success: true, data });
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const toInput = (b: Record<string, any>): TransportOrderInput => ({
  customerId: String(b.customerId ?? ''), pickupAddress: String(b.pickupAddress ?? ''), deliveryAddress: String(b.deliveryAddress ?? ''),
  originZone: b.originZone ?? null, destinationZone: b.destinationZone ?? null, pickupDate: b.pickupDate || null, deliveryDate: b.deliveryDate || null,
  goodsDescription: b.goodsDescription ?? null, weightKg: num(b.weightKg), pallets: num(b.pallets), distanceKm: num(b.distanceKm),
  pricingBasis: b.pricingBasis || null, amountHt: num(b.amountHt), tvaRate: num(b.tvaRate), notes: b.notes ?? null,
});
const id = (req: AuthRequest) => String(req.params.id);

router.get('/', authenticate, can('sales.transport_orders.view'), asyncHandler(async (req: AuthRequest, res: Response) =>
  ok(res, await transportOrderRepository.list({
    status: typeof req.query.status === 'string' ? req.query.status : null,
    routeId: typeof req.query.routeId === 'string' && /^[0-9a-f-]{36}$/i.test(req.query.routeId) ? req.query.routeId : null,
  }))));
router.get('/:id', authenticate, can('sales.transport_orders.view'), validateUuidParams('id'),
  asyncHandler(async (req: AuthRequest, res: Response) => ok(res, await transportOrderRepository.get(id(req)))));
router.post('/', authenticate, can('sales.transport_orders.manage'), validate(transportOrderSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => ok(res, await transportOrderRepository.create(toInput(req.body), req.user!.userId))));
router.put('/:id', authenticate, can('sales.transport_orders.manage'), validateUuidParams('id'), validate(transportOrderSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => ok(res, await transportOrderRepository.update(id(req), toInput(req.body)))));
router.put('/:id/plan', authenticate, can('sales.transport_orders.manage'), validateUuidParams('id'), validate(transportOrderPlanSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => ok(res, await transportOrderRepository.plan(id(req), String(req.body.routeId)))));
router.put('/:id/pickup', authenticate, can('sales.transport_orders.manage'), validateUuidParams('id'), validate(emptyBody),
  asyncHandler(async (req: AuthRequest, res: Response) => ok(res, await transportOrderRepository.pickup(id(req)))));
router.put('/:id/deliver', authenticate, can('sales.transport_orders.manage'), validateUuidParams('id'), validate(transportOrderDeliverSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => ok(res, await transportOrderRepository.deliver(id(req), String(req.body.podName ?? ''), req.body.podNote ?? null))));
router.put('/:id/cancel', authenticate, can('sales.transport_orders.manage'), validateUuidParams('id'), validate(emptyBody),
  asyncHandler(async (req: AuthRequest, res: Response) => ok(res, await transportOrderRepository.cancel(id(req)))));
router.put('/:id/invoice', authenticate, can('sales.transport_orders.invoice'), validateUuidParams('id'), validate(emptyBody),
  asyncHandler(async (req: AuthRequest, res: Response) => ok(res, await transportOrderRepository.invoice(id(req), req.user!.userId))));

export default router;
