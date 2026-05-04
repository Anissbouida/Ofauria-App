import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { ingredientLotRepository } from '../repositories/ingredient-lot.repository.js';
import { db } from '../config/database.js';

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

  /** POST /ingredient-lots/:id/open-container — transferre qty Économat → Pesage */
  async openContainer(req: AuthRequest, res: Response) {
    const { quantity, note } = req.body;
    const qty = parseFloat(quantity);
    if (!qty || qty <= 0) {
      res.status(400).json({ success: false, error: { message: 'Quantite a ouvrir requise et > 0' } });
      return;
    }
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const opened = await ingredientLotRepository.openContainer(client, req.params.id, qty, req.user!.userId, note);
      await client.query('COMMIT');
      res.json({ success: true, data: { lot_id: req.params.id, quantity_opened: opened } });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
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

  /** POST /ingredient-lots/:id/mark-depleted — finir un fond de sac (perte minime) */
  async markDepleted(req: AuthRequest, res: Response) {
    const { note } = req.body;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const lotResult = await client.query(
        `SELECT pesage_quantity, economat_quantity, ingredient_id, store_id FROM ingredient_lots WHERE id = $1 FOR UPDATE`,
        [req.params.id]
      );
      if (lotResult.rowCount === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ success: false, error: { message: 'Lot non trouve' } });
        return;
      }
      const lot = lotResult.rows[0];
      const wastedQty = parseFloat(lot.pesage_quantity);
      if (wastedQty > 0) {
        await client.query(
          `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, note, performed_by, store_id, ingredient_lot_id)
           VALUES ($1, 'waste', $2, $3, $4, $5, $6)`,
          [lot.ingredient_id, -wastedQty, note || `Fond de sac : ${wastedQty.toFixed(3)}`,
           req.user!.userId, lot.store_id, req.params.id]
        );
      }
      // Met le pesage a 0 + recalcule status
      await client.query(
        `UPDATE ingredient_lots
            SET pesage_quantity = 0,
                status = CASE WHEN economat_quantity = 0 THEN 'depleted' ELSE status END
          WHERE id = $1`,
        [req.params.id]
      );
      await client.query('COMMIT');
      res.json({ success: true, data: { lot_id: req.params.id, wasted_quantity: wastedQty } });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};
