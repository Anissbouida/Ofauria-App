import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { routingRepository } from '../repositories/routing.repository.js';

export const routingController = {
  async listWorkCenters(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await routingRepository.listWorkCenters(req.user!.storeId ?? null) });
  },
  async createWorkCenter(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    if (!b.name) { res.status(400).json({ success: false, error: { message: 'Nom requis' } }); return; }
    res.status(201).json({ success: true, data: await routingRepository.createWorkCenter({
      name: String(b.name), hourlyCost: Number(b.hourlyCost) || 0, storeId: req.user!.storeId ?? null, userId: req.user!.userId,
    }) });
  },
  async setWorkCenterActive(req: AuthRequest, res: Response) {
    const w = await routingRepository.setWorkCenterActive(req.params.id, Boolean((req.body as Record<string, unknown>).active));
    if (!w) { res.status(404).json({ success: false, error: { message: 'Poste introuvable' } }); return; }
    res.json({ success: true, data: w });
  },

  async listRoutings(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await routingRepository.listRoutings(req.user!.storeId ?? null) });
  },
  async getRouting(req: AuthRequest, res: Response) {
    const r = await routingRepository.getRouting(req.params.id);
    if (!r) { res.status(404).json({ success: false, error: { message: 'Gamme introuvable' } }); return; }
    res.json({ success: true, data: r });
  },
  async createRouting(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    if (!b.name) { res.status(400).json({ success: false, error: { message: 'Nom requis' } }); return; }
    res.status(201).json({ success: true, data: await routingRepository.createRouting({
      name: String(b.name), productId: b.productId ? String(b.productId) : null, notes: b.notes ? String(b.notes) : null,
      storeId: req.user!.storeId ?? null, userId: req.user!.userId,
    }) });
  },
  async updateRouting(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    const ops = Array.isArray(b.operations) ? (b.operations as Record<string, unknown>[]).map(o => ({
      operationName: String(o.operationName ?? ''), workCenterId: o.workCenterId ? String(o.workCenterId) : null, durationMin: Number(o.durationMin) || 0,
    })) : undefined;
    const r = await routingRepository.updateRouting(req.params.id, {
      name: b.name !== undefined ? String(b.name) : undefined,
      productId: b.productId !== undefined ? (b.productId ? String(b.productId) : null) : undefined,
      notes: b.notes !== undefined ? (b.notes ? String(b.notes) : null) : undefined,
      operations: ops,
    });
    if (!r) { res.status(404).json({ success: false, error: { message: 'Gamme introuvable' } }); return; }
    res.json({ success: true, data: r });
  },
  async setRoutingActive(req: AuthRequest, res: Response) {
    const r = await routingRepository.setRoutingActive(req.params.id, Boolean((req.body as Record<string, unknown>).active));
    if (!r) { res.status(404).json({ success: false, error: { message: 'Gamme introuvable' } }); return; }
    res.json({ success: true, data: r });
  },
  async deleteRouting(req: AuthRequest, res: Response) {
    await routingRepository.deleteRouting(req.params.id);
    res.json({ success: true, data: null });
  },
};
