import { Router, type Response } from 'express';
import { reportsController } from '../controllers/reports.controller.js';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { reportBuilderRepository as rb } from '../repositories/report-builder.repository.js';

const router = Router();

router.get('/dashboard', authenticate, authorize('admin', 'manager'), reportsController.dashboard);
// Vue Pilotage : engagement / tresorerie / pipeline / top fournisseurs
router.get('/finance-overview', authenticate, authorize('admin', 'manager'), reportsController.financeOverview);
// Drill-down : liste detaillee derriere une carte du Pilotage
router.get('/finance-overview/detail', authenticate, authorize('admin', 'manager'), reportsController.financeOverviewDetail);
router.get('/sales', authenticate, authorize('admin', 'manager'), reportsController.sales);
router.get('/products', authenticate, authorize('admin', 'manager'), reportsController.productPerformance);
router.get('/cost-summary', authenticate, authorize('admin', 'manager'), reportsController.costSummary);
router.get('/menu-engineering', authenticate, authorize('admin', 'manager'), reportsController.menuEngineering);

/* ─── Rapports configurables (mig 394) — admin / gérant ─────────────────── */
const AM = [authenticate, authorize('admin', 'manager')];
const storeOf = (req: AuthRequest) => (req.user!.role === 'admin' ? null : req.user!.storeId ?? null);
const bad = (res: Response, m: string) => res.status(400).json({ success: false, error: { message: m } });

router.get('/custom/sources', ...AM, asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: rb.listSources() });
}));

router.get('/custom/filter-options', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { source, filter } = req.query as { source?: string; filter?: string };
  if (!source || !filter) { bad(res, 'Paramètres requis'); return; }
  res.json({ success: true, data: await rb.filterOptions(source, filter) });
}));

router.post('/custom/run', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const out = await rb.run(req.body ?? {}, { storeId: storeOf(req) });
  if ('error' in out) { bad(res, out.error as string); return; }
  res.json({ success: true, data: out });
}));

router.get('/custom/definitions', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await rb.list(storeOf(req)) });
}));

router.post('/custom/definitions', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { name, sourceKey, config } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim() || typeof sourceKey !== 'string' || !sourceKey) { bad(res, 'Nom et source requis'); return; }
  const out = await rb.create({ name, sourceKey, config: config ?? {} }, { userId: req.user!.userId, storeId: storeOf(req) });
  if ('error' in out) { bad(res, out.error as string); return; }
  res.status(201).json({ success: true, data: out });
}));

router.put('/custom/definitions/:id', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { name, sourceKey, config } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim() || typeof sourceKey !== 'string' || !sourceKey) { bad(res, 'Nom et source requis'); return; }
  const out = await rb.update(req.params.id, { name, sourceKey, config: config ?? {} });
  if ('error' in out) { res.status(out.error === 'Rapport introuvable' ? 404 : 400).json({ success: false, error: { message: out.error } }); return; }
  res.json({ success: true, data: out });
}));

router.delete('/custom/definitions/:id', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  await rb.remove(req.params.id);
  res.json({ success: true, data: null });
}));

/* ─── Tableaux de bord (mig 395) ───────────────────────────────────────── */
router.get('/custom/dashboards', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await rb.listDashboards(storeOf(req)) });
}));

router.get('/custom/dashboards/:id', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const d = await rb.getDashboard(req.params.id);
  if (!d) { res.status(404).json({ success: false, error: { message: 'Introuvable' } }); return; }
  res.json({ success: true, data: d });
}));

router.post('/custom/dashboards', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { name, tiles } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) { bad(res, 'Nom requis'); return; }
  res.status(201).json({ success: true, data: await rb.createDashboard({ name, tiles }, { userId: req.user!.userId, storeId: storeOf(req) }) });
}));

router.put('/custom/dashboards/:id', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { name, tiles } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) { bad(res, 'Nom requis'); return; }
  const out = await rb.updateDashboard(req.params.id, { name, tiles: Array.isArray(tiles) ? tiles : [] });
  if ('error' in out) { res.status(404).json({ success: false, error: { message: out.error } }); return; }
  res.json({ success: true, data: out });
}));

router.delete('/custom/dashboards/:id', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  await rb.removeDashboard(req.params.id);
  res.json({ success: true, data: null });
}));

export default router;
