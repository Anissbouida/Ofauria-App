import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { costCenterRepository } from '../repositories/cost-center.repository.js';

export const costCenterController = {
  async list(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await costCenterRepository.list(req.user!.storeId ?? null) });
  },
  async create(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    if (!b.code || !b.name) { res.status(400).json({ success: false, error: { message: 'Code et nom requis' } }); return; }
    const out = await costCenterRepository.create({ code: String(b.code), name: String(b.name), storeId: req.user!.storeId ?? null, userId: req.user!.userId });
    if ('error' in out) { res.status(400).json({ success: false, error: { message: out.error } }); return; }
    res.status(201).json({ success: true, data: out.data });
  },
  async setActive(req: AuthRequest, res: Response) {
    const active = Boolean((req.body as Record<string, unknown>).active);
    const c = await costCenterRepository.setActive(req.params.id, active);
    if (!c) { res.status(404).json({ success: false, error: { message: 'Centre introuvable' } }); return; }
    res.json({ success: true, data: c });
  },
  async assign(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    if (!b.invoiceId) { res.status(400).json({ success: false, error: { message: 'Facture requise' } }); return; }
    const out = await costCenterRepository.assignInvoice(String(b.invoiceId), b.costCenterId ? String(b.costCenterId) : null);
    if ('error' in out) { res.status(404).json({ success: false, error: { message: out.error } }); return; }
    res.json({ success: true, data: null });
  },
  async invoices(req: AuthRequest, res: Response) {
    const q = req.query;
    res.json({ success: true, data: await costCenterRepository.invoicesForAssignment({
      storeId: req.user!.storeId ?? null,
      kind: q.kind === 'received' || q.kind === 'emitted' ? q.kind : undefined,
      onlyUnassigned: q.onlyUnassigned === 'true',
      from: typeof q.from === 'string' ? q.from : undefined,
      to: typeof q.to === 'string' ? q.to : undefined,
      limit: Math.min(Number(q.limit) || 200, 500),
    }) });
  },
  async report(req: AuthRequest, res: Response) {
    const today = new Date(); const y = today.getFullYear();
    const from = (req.query.from as string) || `${y}-01-01`;
    const to = (req.query.to as string) || `${y}-12-31`;
    res.json({ success: true, data: await costCenterRepository.report({ from, to, storeId: req.user!.storeId ?? null }) });
  },
};
