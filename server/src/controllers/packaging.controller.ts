import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { packagingItemRepository } from '../repositories/packaging-item.repository.js';
import { recipeRepository } from '../repositories/recipe.repository.js';
import { db } from '../config/database.js';

export const packagingController = {
  async list(req: AuthRequest, res: Response) {
    const { search, category, activeOnly } = req.query as Record<string, string>;
    const items = await packagingItemRepository.findAll({
      search,
      category,
      storeId: req.user!.storeId,
      activeOnly: activeOnly !== 'false',
    });
    res.json({ success: true, data: items });
  },

  async getById(req: AuthRequest, res: Response) {
    const item = await packagingItemRepository.findById(req.params.id, req.user!.storeId);
    if (!item) { res.status(404).json({ success: false, error: { message: 'Emballage introuvable' } }); return; }
    res.json({ success: true, data: item });
  },

  async create(req: AuthRequest, res: Response) {
    const item = await packagingItemRepository.create(req.body);
    res.status(201).json({ success: true, data: item });
  },

  async update(req: AuthRequest, res: Response) {
    const updated = await packagingItemRepository.update(req.params.id, req.body);
    if (!updated) { res.status(404).json({ success: false, error: { message: 'Emballage introuvable' } }); return; }

    // Si le prix unitaire a change, cascade sur les recettes qui utilisent cet emballage
    if (req.body.unit_cost !== undefined) {
      try {
        await recipeRepository.recalcOnPackagingChange(req.params.id);
      } catch (err) {
        console.error('[recalcOnPackagingChange] erreur :', err);
      }
    }
    res.json({ success: true, data: updated });
  },

  async remove(req: AuthRequest, res: Response) {
    await packagingItemRepository.remove(req.params.id);
    res.json({ success: true });
  },

  /** POST /packaging-items/:id/adjust-stock — ajustement direct (reception, perte, etc.) */
  async adjustStock(req: AuthRequest, res: Response) {
    const { quantity, type, note, unitCost } = req.body;
    const storeId = req.user!.storeId;
    if (!storeId) {
      res.status(400).json({ success: false, error: { message: 'Aucun magasin associe' } });
      return;
    }
    const newStock = await packagingItemRepository.adjustStock(db, {
      packagingId: req.params.id,
      storeId,
      change: parseFloat(quantity),
      type: type || 'adjustment',
      note,
      unitCost: unitCost !== undefined ? parseFloat(unitCost) : undefined,
      performedBy: req.user!.userId,
    });
    res.json({ success: true, data: { stock_quantity: newStock } });
  },

  /** GET /packaging-items/:id/transactions — historique mouvements */
  async transactions(req: AuthRequest, res: Response) {
    const result = await db.query(
      `SELECT pst.*, u.first_name, u.last_name
       FROM packaging_stock_transactions pst
       LEFT JOIN users u ON u.id = pst.performed_by
       WHERE pst.packaging_id = $1
       ORDER BY pst.created_at DESC
       LIMIT 100`,
      [req.params.id]
    );
    res.json({ success: true, data: result.rows });
  },
};
