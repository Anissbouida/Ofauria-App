import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { db } from '../config/database.js';
import { salesTargetRepository } from '../repositories/sales-target.repository.js';

/**
 * Phase 11 (D3-13) — objectifs par commercial.
 */
export const salesTargetController = {
  async report(req: AuthRequest, res: Response) {
    const { periodStart, periodEnd } = req.query as Record<string, string>;
    if (!periodStart || !periodEnd) { res.status(400).json({ success: false, error: { message: 'Période requise' } }); return; }
    res.json({ success: true, data: await salesTargetRepository.report(periodStart, periodEnd) });
  },

  /** Vendeurs possibles (utilisateurs actifs), pour poser un objectif. */
  async salespeople(_req: AuthRequest, res: Response) {
    const rows = (await db.query(
      `SELECT id, first_name, last_name FROM users WHERE is_active IS NOT FALSE ORDER BY last_name, first_name`)).rows;
    res.json({ success: true, data: rows });
  },

  async upsert(req: AuthRequest, res: Response) {
    const { salespersonId, periodStart, periodEnd, targetAmount } = (req.body ?? {}) as Record<string, unknown>;
    if (!salespersonId || !periodStart || !periodEnd) { res.status(400).json({ success: false, error: { message: 'Vendeur et période requis' } }); return; }
    const r = await salesTargetRepository.upsert({
      salespersonId: String(salespersonId), periodStart: String(periodStart), periodEnd: String(periodEnd),
      targetAmount: Number(targetAmount), createdBy: req.user?.userId ?? null,
    });
    if ('error' in r) { res.status(400).json({ success: false, error: { message: r.error } }); return; }
    res.status(201).json({ success: true, data: r.data });
  },

  async remove(req: AuthRequest, res: Response) {
    await salesTargetRepository.remove(req.params.id);
    res.json({ success: true });
  },
};
