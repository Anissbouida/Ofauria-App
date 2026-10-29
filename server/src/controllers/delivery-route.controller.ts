import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { deliveryRouteRepository } from '../repositories/delivery-route.repository.js';

export const deliveryRouteController = {
  async list(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await deliveryRouteRepository.list({
      storeId: req.user!.storeId ?? null, status: typeof req.query.status === 'string' ? req.query.status : undefined,
      limit: Math.min(Number(req.query.limit) || 100, 300),
    }) });
  },
  async getById(req: AuthRequest, res: Response) {
    const d = await deliveryRouteRepository.getById(req.params.id);
    if (!d) { res.status(404).json({ success: false, error: { message: 'Tournée introuvable' } }); return; }
    res.json({ success: true, data: d });
  },
  async create(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    if (!b.label) { res.status(400).json({ success: false, error: { message: 'Libellé requis' } }); return; }
    res.status(201).json({ success: true, data: await deliveryRouteRepository.create({
      label: String(b.label), routeDate: b.routeDate ? String(b.routeDate) : null, driverName: b.driverName ? String(b.driverName) : null,
      notes: b.notes ? String(b.notes) : null, storeId: req.user!.storeId ?? null, userId: req.user!.userId,
    }) });
  },
  async setStatus(req: AuthRequest, res: Response) {
    const status = String((req.body as Record<string, unknown>).status);
    if (!['planned', 'in_progress', 'done'].includes(status)) { res.status(400).json({ success: false, error: { message: 'Statut invalide' } }); return; }
    const d = await deliveryRouteRepository.setStatus(req.params.id, status as 'planned' | 'in_progress' | 'done');
    if (!d) { res.status(404).json({ success: false, error: { message: 'Tournée introuvable' } }); return; }
    res.json({ success: true, data: d });
  },
  async addStops(req: AuthRequest, res: Response) {
    const ids = (req.body as Record<string, unknown>).deliveryNoteIds;
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ success: false, error: { message: 'Aucun bon de livraison' } }); return; }
    const d = await deliveryRouteRepository.addStops(req.params.id, ids.map(String));
    if (!d) { res.status(404).json({ success: false, error: { message: 'Tournée introuvable' } }); return; }
    res.json({ success: true, data: d });
  },
  async removeStop(req: AuthRequest, res: Response) {
    const d = await deliveryRouteRepository.removeStop(req.params.stopId);
    res.json({ success: true, data: d });
  },
  async reorder(req: AuthRequest, res: Response) {
    const ids = (req.body as Record<string, unknown>).stopIds;
    if (!Array.isArray(ids)) { res.status(400).json({ success: false, error: { message: 'Ordre invalide' } }); return; }
    const d = await deliveryRouteRepository.reorder(req.params.id, ids.map(String));
    res.json({ success: true, data: d });
  },
  async markStop(req: AuthRequest, res: Response) {
    const delivered = Boolean((req.body as Record<string, unknown>).delivered);
    const d = await deliveryRouteRepository.markStop(req.params.stopId, delivered);
    res.json({ success: true, data: d });
  },
  async availableNotes(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await deliveryRouteRepository.availableDeliveryNotes({ storeId: req.user!.storeId ?? null, limit: Math.min(Number(req.query.limit) || 200, 500) }) });
  },
};
