import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { inventoryRepository, ingredientRepository } from '../repositories/inventory.repository.js';

export const inventoryController = {
  async list(_req: AuthRequest, res: Response) {
    const items = await inventoryRepository.findAll();
    res.json({ success: true, data: items });
  },
  async alerts(_req: AuthRequest, res: Response) {
    const alerts = await inventoryRepository.findAlerts();
    res.json({ success: true, data: alerts });
  },
  async restock(req: AuthRequest, res: Response) {
    const { ingredientId, quantity, note } = req.body;
    await inventoryRepository.restock(ingredientId, quantity, req.user!.userId, note);
    res.json({ success: true, data: null });
  },
  async transactions(req: AuthRequest, res: Response) {
    const { ingredientId } = req.query as Record<string, string>;
    const transactions = await inventoryRepository.getTransactions(ingredientId);
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
