import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { subscriptionRepository } from '../repositories/subscription.repository.js';

export const subscriptionController = {
  async list(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await subscriptionRepository.list(req.user!.storeId) });
  },
  async getById(req: AuthRequest, res: Response) {
    const data = await subscriptionRepository.getById(req.params.id);
    if (!data) { res.status(404).json({ success: false, error: { message: 'Abonnement introuvable' } }); return; }
    res.json({ success: true, data });
  },
  async create(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    if (!b.customerId || !b.label || !b.amount || !b.frequency || !b.startDate) {
      res.status(400).json({ success: false, error: { message: 'Champs requis manquants (client, libellé, montant, fréquence, début)' } });
      return;
    }
    const out = await subscriptionRepository.create({
      customerId: String(b.customerId), label: String(b.label), amount: Number(b.amount),
      tvaRate: b.tvaRate !== undefined ? Number(b.tvaRate) : 0,
      frequency: String(b.frequency) as 'monthly' | 'quarterly' | 'yearly',
      startDate: String(b.startDate), endDate: b.endDate ? String(b.endDate) : null,
      storeId: req.user!.storeId ?? null, notes: b.notes ? String(b.notes) : null, userId: req.user!.userId,
    });
    if ('error' in out) { res.status(400).json({ success: false, error: { message: out.error } }); return; }
    res.json({ success: true, data: out.data });
  },
  async setStatus(req: AuthRequest, res: Response) {
    const status = String((req.body as Record<string, unknown>).status);
    if (!['active', 'paused', 'ended'].includes(status)) { res.status(400).json({ success: false, error: { message: 'Statut invalide' } }); return; }
    res.json({ success: true, data: await subscriptionRepository.setStatus(req.params.id, status as 'active' | 'paused' | 'ended') });
  },
  /** POST /subscriptions/generate { asOf?, id? } — génère les factures dues. */
  async generate(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    const asOf = b.asOf ? String(b.asOf) : new Date().toISOString().slice(0, 10);
    const out = await subscriptionRepository.generateDue({
      id: b.id ? String(b.id) : undefined, asOf, storeId: req.user!.storeId ?? null, userId: req.user!.userId,
    });
    res.json({ success: true, data: out });
  },
};
