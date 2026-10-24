import { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ROLE_GROUPS } from '@ofauria/shared';
import { controleRepository as repo } from '../repositories/controle.repository.js';

/**
 * Contrôle & Qualité (mig 313) : vue d'ensemble des anomalies et registre unifié
 * des pertes. Lecture seule ; admin et gérant.
 */
export const controleRouter = Router();

const AM = [authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER)];
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const range = z.object({ dateFrom: isoDate.optional(), dateTo: isoDate.optional() });
// Un utilisateur rattaché à un magasin ne voit que le sien ; l'admin global voit tout.
const storeOf = (req: AuthRequest) => (req.user!.role === 'admin' ? undefined : req.user!.storeId);

controleRouter.get('/overview', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = range.safeParse(req.query);
  if (!r.success) { res.status(400).json({ success: false, error: { message: 'Paramètres invalides' } }); return; }
  res.json({ success: true, data: await repo.overview({ ...r.data, storeId: storeOf(req) }) });
}));

controleRouter.get('/losses/summary', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = range.safeParse(req.query);
  if (!r.success) { res.status(400).json({ success: false, error: { message: 'Paramètres invalides' } }); return; }
  res.json({ success: true, data: await repo.lossesSummary({ ...r.data, storeId: storeOf(req) }) });
}));

const board = range.extend({
  family: z.enum(['production', 'invendu', 'vitrine', 'perime', 'recyclage', 'matiere']).optional(),
  source: z.enum(['produit', 'matiere']).optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
controleRouter.get('/losses', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = board.safeParse(req.query);
  if (!r.success) { res.status(400).json({ success: false, error: { message: 'Paramètres invalides' } }); return; }
  const { page, pageSize, search, ...f } = r.data;
  const data = await repo.lossesBoard({ ...f, search: search || undefined, storeId: storeOf(req), limit: pageSize, offset: (page - 1) * pageSize });
  res.json({ success: true, data: { ...data, page, pageSize } });
}));

// Anomalies de production (rendement, contrôle qualité, pesées, refus du chef).
const productionBoard = range.extend({
  kind: z.enum(['rendement', 'qc', 'pesee', 'refus']).optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
controleRouter.get('/production', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = productionBoard.safeParse(req.query);
  if (!r.success) { res.status(400).json({ success: false, error: { message: 'Paramètres invalides' } }); return; }
  const { page, pageSize, search, ...f } = r.data;
  const data = await repo.productionIssues({ ...f, search: search || undefined, storeId: storeOf(req), limit: pageSize, offset: (page - 1) * pageSize });
  res.json({ success: true, data: { ...data, page, pageSize } });
}));

// Contrôles à réception, par bon de réception (saisie : POST /ingredient-lots/quality-check/:id).
const receptionBoard = range.extend({
  status: z.enum(['a_controler', 'conforme', 'non_conforme']).optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
controleRouter.get('/receptions', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = receptionBoard.safeParse(req.query);
  if (!r.success) { res.status(400).json({ success: false, error: { message: 'Paramètres invalides' } }); return; }
  const { page, pageSize, search, ...f } = r.data;
  const data = await repo.receptions({ ...f, search: search || undefined, storeId: storeOf(req), limit: pageSize, offset: (page - 1) * pageSize });
  res.json({ success: true, data: { ...data, page, pageSize } });
}));
