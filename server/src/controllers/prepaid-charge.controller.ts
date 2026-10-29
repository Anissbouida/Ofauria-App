import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { prepaidChargeRepository } from '../repositories/prepaid-charge.repository.js';

export const prepaidChargeController = {
  /** GET /api/v1/prepaid-charges */
  async list(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await prepaidChargeRepository.list(req.user!.storeId) });
  },

  /** GET /api/v1/prepaid-charges/:id */
  async getById(req: AuthRequest, res: Response) {
    const data = await prepaidChargeRepository.getById(req.params.id);
    if (!data) { res.status(404).json({ success: false, error: { message: 'Charge constatée d\'avance introuvable' } }); return; }
    res.json({ success: true, data });
  },

  /** POST /api/v1/prepaid-charges */
  async create(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    if (!b.label || !b.chargeAccountCode || !b.totalAmount || !b.startDate || !b.endDate) {
      res.status(400).json({ success: false, error: { message: 'Champs requis manquants (libellé, compte, montant, dates)' } });
      return;
    }
    const out = await prepaidChargeRepository.create({
      label: String(b.label),
      chargeAccountCode: String(b.chargeAccountCode),
      totalAmount: Number(b.totalAmount),
      startDate: String(b.startDate),
      endDate: String(b.endDate),
      sourceInvoiceId: b.sourceInvoiceId ? String(b.sourceInvoiceId) : null,
      storeId: req.user!.storeId ?? null,
      notes: b.notes ? String(b.notes) : null,
      userId: req.user!.userId,
    });
    if ('error' in out) { res.status(400).json({ success: false, error: { message: out.error } }); return; }
    res.json({ success: true, data: out.data });
  },

  /**
   * POST /api/v1/prepaid-charges/recognize  { asOf?, id? }
   * Constate les mois échus (jusqu'à asOf, défaut aujourd'hui) d'une CCA ou de
   * toutes les CCA actives.
   */
  async recognize(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    const asOf = b.asOf ? String(b.asOf) : new Date().toISOString().slice(0, 10);
    const out = await prepaidChargeRepository.recognizeDue({
      id: b.id ? String(b.id) : undefined,
      asOf,
      storeId: req.user!.storeId ?? null,
      userId: req.user!.userId,
    });
    res.json({ success: true, data: out });
  },
};
