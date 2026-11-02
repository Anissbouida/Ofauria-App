import { Router, type Response } from 'express';
import { z } from 'zod';
import { fixedAssetController } from '../controllers/fixed-asset.controller.js';
import { fixedAssetDisposal } from '../services/depreciation.service.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { requireVerb } from '../middleware/module.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validateUuidParams } from '../middleware/validate.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

// Immobilisations : reserve a l'admin (comme le reste du noyau comptable).
const router = Router();
const AM = [authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER)];

router.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), fixedAssetController.list);
// Tableau des immobilisations d'un exercice (mig 427) — avant /:id/… pour ne pas être pris pour un id.
router.get('/table', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  if (year < 2000 || year > 2100) { res.status(400).json({ success: false, error: { message: 'Exercice invalide' } }); return; }
  res.json({ success: true, data: await fixedAssetDisposal.table(year, req.user!.storeId ?? null) });
}));
router.get('/:id/schedule', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), fixedAssetController.schedule);
router.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), fixedAssetController.create);
router.post('/run-depreciation', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), fixedAssetController.runDepreciation);
router.delete('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), fixedAssetController.remove);

// Cession / mise au rebut (mig 427) : aperçu libre, sortie et annulation avec le droit « post ».
const disposalBody = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(['sale', 'scrap']),
  price: z.coerce.number().min(0).optional(),
  vatRate: z.coerce.number().refine(v => [0, 7, 10, 14, 20].includes(v), 'Taux de TVA non géré').optional(),
  counterpart: z.enum(['receivable', 'bank', 'cash']).optional(),
  buyer: z.string().trim().max(200).nullish(),
  reason: z.string().trim().max(1000).nullish(),
});
const bad = (res: Response, m?: string) => res.status(400).json({ success: false, error: { message: m ?? 'Saisie invalide' } });
router.post('/:id/disposal/preview', ...AM, validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = disposalBody.safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message); return; }
  res.json({ success: true, data: await fixedAssetDisposal.preview(req.params.id, r.data) });
}));
router.post('/:id/dispose', ...AM, requireVerb('accounting', 'post'), validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = disposalBody.safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message); return; }
  res.json({ success: true, data: await fixedAssetDisposal.dispose(req.params.id, r.data, req.user!.userId) });
}));
router.post('/:id/cancel-disposal', ...AM, requireVerb('accounting', 'post'), validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ reason: z.string().trim().min(3).max(500) }).safeParse(req.body);
  if (!r.success) { bad(res, 'Motif de l\'annulation obligatoire (3 caractères au moins)'); return; }
  res.json({ success: true, data: await fixedAssetDisposal.cancel(req.params.id, r.data.reason, req.user!.userId) });
}));

export default router;
