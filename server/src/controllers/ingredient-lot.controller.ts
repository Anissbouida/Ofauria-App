import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { ingredientLotRepository } from '../repositories/ingredient-lot.repository.js';

export const ingredientLotController = {
  async list(req: AuthRequest, res: Response) {
    const { ingredientId, status, search, expiringWithinDays, page = '1', limit = '50' } = req.query as Record<string, string>;
    const p = parseInt(page);
    const l = parseInt(limit);
    const result = await ingredientLotRepository.findAll({
      ingredientId, status, search,
      expiringWithinDays: expiringWithinDays ? parseInt(expiringWithinDays) : undefined,
      storeId: req.user!.storeId,
      limit: l,
      offset: (p - 1) * l,
    });
    res.json({ success: true, data: result.rows, total: result.total, page: p, limit: l });
  },

  async getById(req: AuthRequest, res: Response) {
    const lot = await ingredientLotRepository.findById(req.params.id);
    if (!lot) { res.status(404).json({ success: false, error: { message: 'Lot non trouve' } }); return; }
    if (req.user!.storeId && lot.store_id && lot.store_id !== req.user!.storeId) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } }); return;
    }
    res.json({ success: true, data: lot });
  },

  async expiring(req: AuthRequest, res: Response) {
    const days = parseInt(req.query.days as string) || 7;
    const lots = await ingredientLotRepository.findExpiring(days, req.user!.storeId);
    res.json({ success: true, data: lots });
  },

  async expired(req: AuthRequest, res: Response) {
    const lots = await ingredientLotRepository.findExpired(req.user!.storeId);
    res.json({ success: true, data: lots });
  },

  async traceability(req: AuthRequest, res: Response) {
    const productions = await ingredientLotRepository.findProductionsByLot(req.params.id);
    res.json({ success: true, data: productions });
  },

  async productionLots(req: AuthRequest, res: Response) {
    const lots = await ingredientLotRepository.findLotsByProduction(req.params.id);
    res.json({ success: true, data: lots });
  },

  async quarantine(req: AuthRequest, res: Response) {
    const lot = await ingredientLotRepository.quarantine(req.params.id);
    if (!lot) { res.status(404).json({ success: false, error: { message: 'Lot non trouve' } }); return; }
    res.json({ success: true, data: lot });
  },

  async markAsWaste(req: AuthRequest, res: Response) {
    const lot = await ingredientLotRepository.markAsWaste(req.params.id);
    if (!lot) { res.status(404).json({ success: false, error: { message: 'Lot non trouve' } }); return; }
    res.json({ success: true, data: lot });
  },

  async stats(req: AuthRequest, res: Response) {
    const stats = await ingredientLotRepository.stats(req.user!.storeId);
    res.json({ success: true, data: stats });
  },

  async saveQualityCheck(req: AuthRequest, res: Response) {
    const { temperatureOk, temperatureValue, visualOk, packagingOk, labelsOk, overallConformity, notes } = req.body;
    const qc = await ingredientLotRepository.saveQualityCheck({
      receptionVoucherId: req.params.id,
      temperatureOk, temperatureValue, visualOk, packagingOk, labelsOk,
      overallConformity: overallConformity ?? true,
      notes,
      checkedBy: req.user!.userId,
    });
    res.json({ success: true, data: qc });
  },

  async fefoPreview(req: AuthRequest, res: Response) {
    const preview = await ingredientLotRepository.previewFEFO(req.params.planId, req.user!.storeId);
    res.json({ success: true, data: preview });
  },

  async getQualityCheck(req: AuthRequest, res: Response) {
    const qc = await ingredientLotRepository.findQualityCheck(req.params.id);
    res.json({ success: true, data: qc });
  },
};
