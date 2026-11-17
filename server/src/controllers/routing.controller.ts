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
      name: String(b.name), hourlyCost: Number(b.hourlyCost) || 0,
      capacityMinutesPerDay: b.capacityMinutesPerDay != null && b.capacityMinutesPerDay !== '' ? Number(b.capacityMinutesPerDay) : null,
      storeId: req.user!.storeId ?? null, userId: req.user!.userId,
    }) });
  },
  async updateWorkCenter(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    const w = await routingRepository.updateWorkCenter(req.params.id, {
      name: b.name !== undefined ? String(b.name) : undefined,
      hourlyCost: b.hourlyCost !== undefined ? Number(b.hourlyCost) : undefined,
      capacityMinutesPerDay: b.capacityMinutesPerDay !== undefined
        ? (b.capacityMinutesPerDay != null && b.capacityMinutesPerDay !== '' ? Number(b.capacityMinutesPerDay) : null)
        : undefined,
    });
    if (!w) { res.status(404).json({ success: false, error: { message: 'Poste introuvable' } }); return; }
    res.json({ success: true, data: w });
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
    const b = req.body as { name: string; productId?: string | null; recipeId?: string | null; notes?: string | null; batchSize?: number | '' | null };
    res.status(201).json({ success: true, data: await routingRepository.createRouting({
      name: b.name, productId: b.productId ?? null, recipeId: b.recipeId ?? null, notes: b.notes ?? null,
      batchSize: b.batchSize != null && b.batchSize !== '' ? Number(b.batchSize) : undefined,
      storeId: req.user!.storeId ?? null, userId: req.user!.userId,
    }) });
  },
  async updateRouting(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, any>;
    const r = await routingRepository.updateRouting(req.params.id as string, {
      name: b.name, productId: b.productId, recipeId: b.recipeId, notes: b.notes,
      batchSize: b.batchSize != null && b.batchSize !== '' ? Number(b.batchSize) : undefined,
      operations: b.operations,
    });
    if (!r) { res.status(404).json({ success: false, error: { message: 'Gamme introuvable' } }); return; }
    res.json({ success: true, data: r });
  },
  async getRoutingForRecipe(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await routingRepository.getRoutingForRecipe(req.params.recipeId as string) });
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

  // ── Statut & arrêts machine / TRS (mig 402) — roadmap lot 7 ──
  async setWorkCenterStatus(req: AuthRequest, res: Response) {
    const status = String((req.body as Record<string, unknown>).status || '');
    if (!['production', 'off', 'idle', 'probleme', 'maintenance', 'reglage'].includes(status)) {
      res.status(400).json({ success: false, error: { message: 'Statut invalide' } }); return;
    }
    const w = await routingRepository.setWorkCenterStatus(req.params.id, status);
    if (!w) { res.status(404).json({ success: false, error: { message: 'Poste introuvable' } }); return; }
    res.json({ success: true, data: w });
  },
  async recordDowntime(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    if (!b.fromTime || !b.reason) { res.status(400).json({ success: false, error: { message: 'Début et motif requis' } }); return; }
    const d = await routingRepository.recordDowntime({
      workCenterId: req.params.id, fromTime: String(b.fromTime),
      toTime: b.toTime ? String(b.toTime) : null, reason: String(b.reason), notes: b.notes ? String(b.notes) : null,
    }, req.user!.userId);
    res.status(201).json({ success: true, data: d });
  },
  async listDowntime(req: AuthRequest, res: Response) {
    const d = await routingRepository.listDowntime(req.params.id, req.query.from as string | undefined, req.query.to as string | undefined);
    res.json({ success: true, data: d });
  },
  async getOee(req: AuthRequest, res: Response) {
    const to = (req.query.to as string) || new Date().toISOString();
    const from = (req.query.from as string) || new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const d = await routingRepository.getOee(req.params.id, from, to);
    res.json({ success: true, data: d });
  },
  // Calendrier des postes (M5-04).
  async getCalendar(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await routingRepository.getCalendar(req.params.id as string) });
  },
  async setCalendar(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await routingRepository.setCalendar(req.params.id as string, req.body.slots) });
  },
  async addClosure(req: AuthRequest, res: Response) {
    try {
      const b = req.body as { closedOn: string; reason?: string | null; allCenters?: boolean };
      res.status(201).json({ success: true, data: await routingRepository.addClosure(b.allCenters ? null : req.params.id as string, b.closedOn, b.reason ?? null) });
    } catch (err) {
      res.status(400).json({ success: false, error: { message: err instanceof Error && /uq_wc_closures/.test(err.message) ? 'Ce jour est déjà fermé' : 'Fermeture impossible' } });
    }
  },
  async removeClosure(req: AuthRequest, res: Response) {
    const ok = await routingRepository.removeClosure(req.params.closureId as string);
    res.status(ok ? 200 : 404).json({ success: ok });
  },
};
