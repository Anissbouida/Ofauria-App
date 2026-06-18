import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { db } from '../config/database.js';
import { fixedAssetRepository, runDepreciation } from '../services/depreciation.service.js';

export const fixedAssetController = {
  /** GET /api/v1/fixed-assets */
  async list(req: AuthRequest, res: Response) {
    const rows = await fixedAssetRepository.findAll({ storeId: req.user!.storeId });
    res.json({ success: true, data: rows });
  },

  /** GET /api/v1/fixed-assets/:id/schedule — plan d'amortissement */
  async schedule(req: AuthRequest, res: Response) {
    const data = await fixedAssetRepository.getSchedule(req.params.id);
    if (!data) {
      res.status(404).json({ success: false, error: { message: 'Immobilisation introuvable' } });
      return;
    }
    res.json({ success: true, data });
  },

  /** POST /api/v1/fixed-assets */
  async create(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    if (!b.label || !b.assetAccountId || !b.depreciationAccountId || !b.expenseAccountId
        || !b.acquisitionDate || !b.acquisitionCost || !b.durationYears) {
      res.status(400).json({ success: false, error: { message: 'Champs requis manquants' } });
      return;
    }
    try {
      const asset = await fixedAssetRepository.create({
        label: String(b.label),
        assetAccountId: String(b.assetAccountId),
        depreciationAccountId: String(b.depreciationAccountId),
        expenseAccountId: String(b.expenseAccountId),
        acquisitionDate: String(b.acquisitionDate),
        acquisitionCost: Number(b.acquisitionCost),
        residualValue: b.residualValue !== undefined ? Number(b.residualValue) : 0,
        durationYears: Number(b.durationYears),
        method: (b.method as 'linear' | 'degressive') || 'linear',
        supplierId: b.supplierId ? String(b.supplierId) : undefined,
        storeId: req.user!.storeId,
        notes: b.notes ? String(b.notes) : undefined,
        createdBy: req.user!.userId,
      });
      res.status(201).json({ success: true, data: asset });
    } catch (err) {
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } });
    }
  },

  /** DELETE /api/v1/fixed-assets/:id */
  async remove(req: AuthRequest, res: Response) {
    try {
      await fixedAssetRepository.delete(req.params.id);
      res.json({ success: true, data: null });
    } catch (err) {
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } });
    }
  },

  /**
   * POST /api/v1/fixed-assets/run-depreciation
   * Body : { year, month }
   * Genere les ecritures de dotation pour la periode, pour toutes les immos actives.
   */
  async runDepreciation(req: AuthRequest, res: Response) {
    const { year, month } = req.body as { year?: number; month?: number };
    if (!year || !month || month < 1 || month > 12) {
      res.status(400).json({ success: false, error: { message: 'year et month (1-12) requis' } });
      return;
    }
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const result = await runDepreciation(client, {
        year, month, userId: req.user!.userId, storeId: req.user!.storeId,
      });
      await client.query('COMMIT');
      res.json({ success: true, data: result });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } });
    } finally {
      client.release();
    }
  },
};
