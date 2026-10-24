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

  /** GET /ingredient-lots/pesage-stock — Stock actuel au Pesage agrege par ingredient */
  async pesageStock(req: AuthRequest, res: Response) {
    const data = await ingredientLotRepository.findPesageStock(req.user!.storeId);
    res.json({ success: true, data });
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
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) || undefined : undefined;
    const lot = await ingredientLotRepository.quarantine(req.params.id, req.user!.userId, reason);
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

  /** POST /ingredient-lots/:id/open-container — transferre qty Économat → Pesage */
  /** POST /ingredient-lots/:id/return-to-economat — reliquat du pesage range en reserve. */
  async returnToEconomat(req: AuthRequest, res: Response) {
    const qty = parseFloat(req.body?.quantity);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : undefined;
    if (!qty || qty <= 0) {
      res.status(400).json({ success: false, error: { message: 'Quantite a retourner requise et > 0' } });
      return;
    }
    try {
      const data = await ingredientLotRepository.returnToEconomat(req.params.id, qty, req.user!.userId, reason);
      res.json({ success: true, data });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } });
    }
  },

  /** POST /ingredient-lots/:id/open-to-pesage — ouverture a l'avance (hors bon), economat -> pesage. */
  async openToPesage(req: AuthRequest, res: Response) {
    const qty = parseFloat(req.body?.quantity);
    const containerCount = Number.isFinite(Number(req.body?.containerCount)) && Number(req.body?.containerCount) > 0 ? Math.floor(Number(req.body.containerCount)) : null;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : undefined;
    if (!qty || qty <= 0) {
      res.status(400).json({ success: false, error: { message: 'Quantite a ouvrir requise et > 0' } });
      return;
    }
    try {
      const data = await ingredientLotRepository.openToPesage(req.params.id, qty, req.user!.userId, { containerCount, reason });
      res.json({ success: true, data });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } });
    }
  },

  /** POST /ingredient-lots/:id/pesage-waste — perte / casse en zone pesage (motif obligatoire). */
  async wasteFromPesage(req: AuthRequest, res: Response) {
    const qty = parseFloat(req.body?.quantity);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
    if (!qty || qty <= 0) {
      res.status(400).json({ success: false, error: { message: 'Quantite perdue requise et > 0' } });
      return;
    }
    if (!reason) {
      res.status(400).json({ success: false, error: { message: 'Motif obligatoire' } });
      return;
    }
    try {
      const reasonCode = typeof req.body?.reasonCode === 'string' && /^[a-z0-9_]{1,40}$/.test(req.body.reasonCode) ? req.body.reasonCode : undefined;
      const data = await ingredientLotRepository.wasteFromPesage(req.params.id, qty, req.user!.userId, reason, reasonCode);
      res.json({ success: true, data });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } });
    }
  },

  /** GET /ingredient-lots/expired-active — lots actifs avec DLC ou DLV depassee */
  async expiredActive(req: AuthRequest, res: Response) {
    const lots = await ingredientLotRepository.findExpiredActiveLots(req.user!.storeId);
    res.json({ success: true, data: lots });
  },

  /** POST /ingredient-lots/:id/send-to-losses — envoyer aux pertes avec motif */
  async sendToLosses(req: AuthRequest, res: Response) {
    const { reason, note } = req.body;
    if (!reason) {
      res.status(400).json({ success: false, error: { message: 'Motif requis' } });
      return;
    }
    try {
      const result = await ingredientLotRepository.sendToLosses(
        req.params.id, reason, req.user!.userId, note
      );
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur';
      res.status(400).json({ success: false, error: { message: msg } });
    }
  },

  /**
   * POST /ingredient-lots/:id/movement — point d'entree UNIQUE des mouvements de lot
   * (module Stock, lot 3). Remplace open-container / open-to-pesage / return-to-economat /
   * pesage-waste / send-to-losses / waste, qui restent montes en facade.
   *   open     : scelle -> entame (quantity, containerCount?, reason?)
   *   return   : entame -> scelle (quantity, reason?)
   *   waste    : perte partielle en zone entamee (quantity, reason obligatoire)
   *   losses   : lot entier aux pertes, deux zones (reason code, note?)
   *   quarantine : blocage du lot (admin/gerant)
   */
  async movement(req: AuthRequest, res: Response) {
    const type = String(req.body?.type || '');
    const qty = parseFloat(req.body?.quantity);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : undefined;
    const reasonCode = typeof req.body?.reasonCode === 'string' && /^[a-z0-9_]{1,40}$/.test(req.body.reasonCode) ? req.body.reasonCode : undefined;
    const containerCount = Number.isFinite(Number(req.body?.containerCount)) && Number(req.body?.containerCount) > 0
      ? Math.floor(Number(req.body.containerCount)) : null;
    const userId = req.user!.userId;
    const lotId = req.params.id;
    const needQty = type === 'open' || type === 'return' || type === 'waste';
    if (needQty && (!qty || qty <= 0)) {
      res.status(400).json({ success: false, error: { message: 'Quantite requise et > 0' } });
      return;
    }
    try {
      let data: unknown;
      switch (type) {
        case 'open':
          data = await ingredientLotRepository.openToPesage(lotId, qty, userId, { containerCount, reason: reason || undefined });
          break;
        case 'return':
          data = await ingredientLotRepository.returnToEconomat(lotId, qty, userId, reason || undefined);
          break;
        case 'waste':
          if (!reason) { res.status(400).json({ success: false, error: { message: 'Motif obligatoire' } }); return; }
          data = await ingredientLotRepository.wasteFromPesage(lotId, qty, userId, reason, reasonCode);
          break;
        case 'losses':
          if (!reason) { res.status(400).json({ success: false, error: { message: 'Motif requis' } }); return; }
          data = await ingredientLotRepository.sendToLosses(lotId, reason, userId, note);
          break;
        case 'quarantine':
          if (!['admin', 'manager'].includes(req.user!.role)) {
            res.status(403).json({ success: false, error: { message: 'Quarantaine reservee admin/gerant' } });
            return;
          }
          data = await ingredientLotRepository.quarantine(lotId, userId, note || undefined);
          if (!data) { res.status(404).json({ success: false, error: { message: 'Lot non trouve' } }); return; }
          break;
        default:
          res.status(400).json({ success: false, error: { message: `Type de mouvement inconnu : ${type}` } });
          return;
      }
      res.json({ success: true, data });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } });
    }
  },
};
