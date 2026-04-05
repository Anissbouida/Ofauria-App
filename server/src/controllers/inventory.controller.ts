import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { inventoryRepository, ingredientRepository } from '../repositories/inventory.repository.js';
import { db } from '../config/database.js';

export const inventoryController = {
  async list(req: AuthRequest, res: Response) {
    const items = await inventoryRepository.findAll(req.user!.storeId);
    res.json({ success: true, data: items });
  },
  async alerts(req: AuthRequest, res: Response) {
    const alerts = await inventoryRepository.findAlerts(req.user!.storeId);
    res.json({ success: true, data: alerts });
  },
  async restock(_req: AuthRequest, res: Response) {
    res.status(403).json({
      success: false,
      error: { message: 'Le restockage direct est desactive. Utilisez un bon de commande fournisseur pour ajouter du stock.' },
    });
  },
  async adjust(req: AuthRequest, res: Response) {
    const { ingredientId, quantity, type = 'adjustment', note } = req.body;
    if (!ingredientId || quantity === undefined) {
      res.status(400).json({ success: false, error: { message: 'Ingredient et quantite requis' } });
      return;
    }
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const storeFilter = req.user!.storeId ? ' AND store_id = $3' : '';
      const params: unknown[] = [quantity, ingredientId];
      if (req.user!.storeId) params.push(req.user!.storeId);
      await client.query(
        `UPDATE inventory SET current_quantity = current_quantity + $1, updated_at = NOW()
         WHERE ingredient_id = $2${storeFilter}`,
        params
      );
      await client.query(
        `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, note, performed_by, store_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [ingredientId, type, quantity, note || null, req.user!.userId, req.user!.storeId || null]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    res.json({ success: true, data: null });
  },
  async updateThreshold(req: AuthRequest, res: Response) {
    const { ingredientId, threshold } = req.body;
    if (!ingredientId || threshold === undefined) {
      res.status(400).json({ success: false, error: { message: 'Donnees manquantes' } });
      return;
    }
    const storeFilter = req.user!.storeId ? ' AND store_id = $3' : '';
    const params: unknown[] = [threshold, ingredientId];
    if (req.user!.storeId) params.push(req.user!.storeId);
    await db.query(
      `UPDATE inventory SET minimum_threshold = $1, updated_at = NOW()
       WHERE ingredient_id = $2${storeFilter}`,
      params
    );
    res.json({ success: true, data: null });
  },
  async transactions(req: AuthRequest, res: Response) {
    const { ingredientId } = req.query as Record<string, string>;
    const transactions = await inventoryRepository.getTransactions(ingredientId, 50, req.user!.storeId);
    res.json({ success: true, data: transactions });
  },
};

export const ingredientController = {
  async list(_req: AuthRequest, res: Response) {
    const ingredients = await ingredientRepository.findAll();
    res.json({ success: true, data: ingredients });
  },
  async getById(req: AuthRequest, res: Response) {
    const ingredient = await ingredientRepository.findById(req.params.id);
    if (!ingredient) { res.status(404).json({ success: false, error: { message: 'Ingrédient non trouvé' } }); return; }
    res.json({ success: true, data: ingredient });
  },
  async create(req: AuthRequest, res: Response) {
    const ingredient = await ingredientRepository.create(req.body);
    res.status(201).json({ success: true, data: ingredient });
  },
  async update(req: AuthRequest, res: Response) {
    const ingredient = await ingredientRepository.update(req.params.id, req.body);
    res.json({ success: true, data: ingredient });
  },
  async remove(req: AuthRequest, res: Response) {
    await ingredientRepository.delete(req.params.id);
    res.json({ success: true, data: null });
  },
};
