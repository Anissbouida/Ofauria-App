import { Router, type Response } from 'express';
import { reportsController } from '../controllers/reports.controller.js';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { reportBuilderRepository as rb } from '../repositories/report-builder.repository.js';

const router = Router();

router.get('/dashboard', authenticate, can('reports.view'), reportsController.dashboard);
// Vue Pilotage : engagement / tresorerie / pipeline / top fournisseurs
router.get('/finance-overview', authenticate, can('reports.view'), reportsController.financeOverview);
// Drill-down : liste detaillee derriere une carte du Pilotage
router.get('/finance-overview/detail', authenticate, can('reports.view'), reportsController.financeOverviewDetail);
router.get('/sales', authenticate, can('reports.view'), reportsController.sales);
router.get('/products', authenticate, can('reports.view'), reportsController.productPerformance);
router.get('/cost-summary', authenticate, can('reports.view'), reportsController.costSummary);
router.get('/menu-engineering', authenticate, can('reports.view'), reportsController.menuEngineering);

/* ─── Rapports configurables (mig 394) — admin / gérant ─────────────────── */
const storeOf = (req: AuthRequest) => (req.user!.role === 'admin' ? null : req.user!.storeId ?? null);
const bad = (res: Response, m: string) => res.status(400).json({ success: false, error: { message: m } });

router.get('/custom/sources', authenticate, can('reports.view'), asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: rb.listSources() });
}));

router.get('/custom/filter-options', authenticate, can('reports.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { source, filter } = req.query as { source?: string; filter?: string };
  if (!source || !filter) { bad(res, 'Paramètres requis'); return; }
  res.json({ success: true, data: await rb.filterOptions(source, filter) });
}));

router.post('/custom/run', authenticate, can('reports.run'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const out = await rb.run(req.body ?? {}, { storeId: storeOf(req) });
  if ('error' in out) { bad(res, out.error as string); return; }
  res.json({ success: true, data: out });
}));

router.get('/custom/definitions', authenticate, can('reports.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await rb.list(storeOf(req)) });
}));

router.post('/custom/definitions', authenticate, can('reports.definitions'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { name, sourceKey, config } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim() || typeof sourceKey !== 'string' || !sourceKey) { bad(res, 'Nom et source requis'); return; }
  const out = await rb.create({ name, sourceKey, config: config ?? {} }, { userId: req.user!.userId, storeId: storeOf(req) });
  if ('error' in out) { bad(res, out.error as string); return; }
  res.status(201).json({ success: true, data: out });
}));

router.put('/custom/definitions/:id', authenticate, can('reports.definitions'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { name, sourceKey, config } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim() || typeof sourceKey !== 'string' || !sourceKey) { bad(res, 'Nom et source requis'); return; }
  const out = await rb.update(req.params.id, { name, sourceKey, config: config ?? {} }, storeOf(req));
  if ('error' in out) { res.status(out.error === 'Rapport introuvable' ? 404 : 400).json({ success: false, error: { message: out.error } }); return; }
  res.json({ success: true, data: out });
}));

router.delete('/custom/definitions/:id', authenticate, can('reports.delete'), asyncHandler(async (req: AuthRequest, res: Response) => {
  await rb.remove(req.params.id, storeOf(req));
  res.json({ success: true, data: null });
}));

/* ─── Tableaux de bord (mig 395) ───────────────────────────────────────── */
router.get('/custom/dashboards', authenticate, can('reports.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await rb.listDashboards(storeOf(req)) });
}));

router.get('/custom/dashboards/:id', authenticate, can('reports.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const d = await rb.getDashboard(req.params.id);
  if (!d) { res.status(404).json({ success: false, error: { message: 'Introuvable' } }); return; }
  res.json({ success: true, data: d });
}));

router.post('/custom/dashboards', authenticate, can('reports.dashboards'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { name, tiles } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) { bad(res, 'Nom requis'); return; }
  res.status(201).json({ success: true, data: await rb.createDashboard({ name, tiles }, { userId: req.user!.userId, storeId: storeOf(req) }) });
}));

router.put('/custom/dashboards/:id', authenticate, can('reports.dashboards'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { name, tiles } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) { bad(res, 'Nom requis'); return; }
  const out = await rb.updateDashboard(req.params.id, { name, tiles: Array.isArray(tiles) ? tiles : [] }, storeOf(req));
  if ('error' in out) { res.status(404).json({ success: false, error: { message: out.error } }); return; }
  res.json({ success: true, data: out });
}));

router.delete('/custom/dashboards/:id', authenticate, can('reports.delete'), asyncHandler(async (req: AuthRequest, res: Response) => {
  await rb.removeDashboard(req.params.id, storeOf(req));
  res.json({ success: true, data: null });
}));

export default router;
