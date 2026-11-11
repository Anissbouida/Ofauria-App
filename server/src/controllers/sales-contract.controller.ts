import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { salesContractRepository } from '../repositories/sales-contract.repository.js';

/**
 * Phase 11 (D3-37) — contrats-cadres / commandes ouvertes.
 */
export const salesContractController = {
  async list(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await salesContractRepository.list(req.query.customerId ? String(req.query.customerId) : undefined) });
  },

  async get(req: AuthRequest, res: Response) {
    const c = await salesContractRepository.getWithConsumption(req.params.id);
    if (!c) { res.status(404).json({ success: false, error: { message: 'Contrat introuvable' } }); return; }
    res.json({ success: true, data: c });
  },

  async create(req: AuthRequest, res: Response) {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!b.customerId || !b.basis || !b.startDate) {
      res.status(400).json({ success: false, error: { message: 'Client, base et date de début requis' } }); return;
    }
    const r = await salesContractRepository.create({
      customerId: String(b.customerId),
      basis: b.basis as 'quantity' | 'value',
      productId: (b.productId as string) ?? null,
      committedQuantity: b.committedQuantity != null ? Number(b.committedQuantity) : null,
      committedValue: b.committedValue != null ? Number(b.committedValue) : null,
      unitPrice: b.unitPrice != null ? Number(b.unitPrice) : null,
      startDate: String(b.startDate),
      endDate: (b.endDate as string) ?? null,
      notes: (b.notes as string) ?? null,
      createdBy: req.user?.userId ?? null,
    });
    if ('error' in r) { res.status(400).json({ success: false, error: { message: r.error } }); return; }
    res.status(201).json({ success: true, data: r.data });
  },

  async addRelease(req: AuthRequest, res: Response) {
    const orderId = (req.body as { orderId?: string })?.orderId;
    if (!orderId) { res.status(400).json({ success: false, error: { message: 'Commande requise' } }); return; }
    const r = await salesContractRepository.recordRelease(req.params.id, orderId);
    if ('error' in r) { res.status(400).json({ success: false, error: { message: r.error } }); return; }
    res.json({ success: true, data: r.data });
  },

  async close(req: AuthRequest, res: Response) {
    await salesContractRepository.close(req.params.id);
    res.json({ success: true });
  },
};
