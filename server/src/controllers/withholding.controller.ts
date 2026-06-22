import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { withholdingRepository } from '../repositories/withholding.repository.js';

export const withholdingController = {
  /** GET /api/v1/withholding/types */
  async listTypes(_req: AuthRequest, res: Response) {
    const rows = await withholdingRepository.listTypes({ includeInactive: true });
    res.json({ success: true, data: rows });
  },

  /** PATCH /api/v1/withholding/types/:id — modifier taux/seuil/base/echeance */
  async updateType(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    try {
      const updated = await withholdingRepository.updateType(req.params.id, {
        rate: b.rate === null ? null : (b.rate !== undefined ? Number(b.rate) : undefined),
        threshold: b.threshold === null ? null : (b.threshold !== undefined ? Number(b.threshold) : undefined),
        rateAbove: b.rateAbove === null ? null : (b.rateAbove !== undefined ? Number(b.rateAbove) : undefined),
        base: b.base !== undefined ? String(b.base) : undefined,
        echeanceJours: b.echeanceJours !== undefined ? Number(b.echeanceJours) : undefined,
        isActive: b.isActive !== undefined ? Boolean(b.isActive) : undefined,
        notes: b.notes === null ? null : (b.notes !== undefined ? String(b.notes) : undefined),
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } });
    }
  },

  /** GET /api/v1/withholding/to-remit?startDate=&endDate= — etat des RAS a reverser */
  async toRemit(req: AuthRequest, res: Response) {
    const data = await withholdingRepository.toRemit({
      startDate: req.query.startDate as string | undefined,
      endDate: req.query.endDate as string | undefined,
      storeId: req.user!.storeId,
    });
    res.json({ success: true, data });
  },

  /** POST /api/v1/withholding/reversement — genere l'ecriture de reversement DGI */
  async reversement(req: AuthRequest, res: Response) {
    const { typeCode, amount, date, method } = req.body as {
      typeCode?: string; amount?: number; date?: string; method?: string;
    };
    if (!typeCode || !amount || !date) {
      res.status(400).json({ success: false, error: { message: 'typeCode, amount et date requis' } });
      return;
    }
    try {
      const result = await withholdingRepository.createReversement({
        typeCode, amount: Number(amount), date,
        method: method === 'cash' ? 'cash' : 'bank',
        storeId: req.user!.storeId ?? null, userId: req.user!.userId,
      });
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } });
    }
  },
};
