import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { rebateRepository } from '../repositories/rebate.repository.js';

/**
 * Phase 11 (D5-12) — ristournes de fin d'année (RFA).
 */
export const rebateController = {
  async list(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await rebateRepository.list(req.query.year ? Number(req.query.year) : undefined) });
  },

  async compute(req: AuthRequest, res: Response) {
    const r = await rebateRepository.compute(req.params.id);
    if (!r) { res.status(404).json({ success: false, error: { message: 'Accord introuvable' } }); return; }
    res.json({ success: true, data: r });
  },

  async create(req: AuthRequest, res: Response) {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!b.customerId || !b.year) { res.status(400).json({ success: false, error: { message: 'Client et année requis' } }); return; }
    const r = await rebateRepository.create({
      customerId: String(b.customerId), year: Number(b.year), ratePercent: Number(b.ratePercent),
      minTurnover: b.minTurnover != null ? Number(b.minTurnover) : 0,
      notes: (b.notes as string) ?? null, createdBy: req.user?.userId ?? null,
    });
    if ('error' in r) { res.status(400).json({ success: false, error: { message: r.error } }); return; }
    res.status(201).json({ success: true, data: r.data });
  },

  async settle(req: AuthRequest, res: Response) {
    const r = await rebateRepository.settle(req.params.id);
    if ('error' in r) { res.status(400).json({ success: false, error: { message: r.error } }); return; }
    res.json({ success: true, data: r.data });
  },

  async cancel(req: AuthRequest, res: Response) {
    await rebateRepository.cancel(req.params.id);
    res.json({ success: true });
  },
};
