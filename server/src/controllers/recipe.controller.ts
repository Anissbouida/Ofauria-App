import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { recipeRepository } from '../repositories/recipe.repository.js';

export const recipeController = {
  async list(_req: AuthRequest, res: Response) {
    const recipes = await recipeRepository.findAll();
    res.json({ success: true, data: recipes });
  },
  async getById(req: AuthRequest, res: Response) {
    const recipe = await recipeRepository.findById(req.params.id);
    if (!recipe) { res.status(404).json({ success: false, error: { message: 'Recette non trouvée' } }); return; }
    res.json({ success: true, data: recipe });
  },
  async getByProductId(req: AuthRequest, res: Response) {
    const recipe = await recipeRepository.findByProductId(req.params.productId);
    if (!recipe) { res.status(404).json({ success: false, error: { message: 'Aucune recette pour ce produit' } }); return; }
    res.json({ success: true, data: recipe });
  },
  async baseRecipes(_req: AuthRequest, res: Response) {
    const recipes = await recipeRepository.findBaseRecipes();
    res.json({ success: true, data: recipes });
  },
  async create(req: AuthRequest, res: Response) {
    try {
      const recipe = await recipeRepository.create(req.body);
      res.status(201).json({ success: true, data: recipe });
    } catch (err: any) {
      if (err.message?.includes('circulaire')) {
        res.status(400).json({ success: false, error: { message: err.message } });
        return;
      }
      throw err;
    }
  },
  async update(req: AuthRequest, res: Response) {
    try {
      const recipe = await recipeRepository.update(req.params.id, {
        ...req.body,
        changedBy: req.user?.userId,
      });
      if (!recipe) { res.status(404).json({ success: false, error: { message: 'Recette non trouvée' } }); return; }
      res.json({ success: true, data: recipe });
    } catch (err: any) {
      if (err.message?.includes('circulaire')) {
        res.status(400).json({ success: false, error: { message: err.message } });
        return;
      }
      throw err;
    }
  },
  async versions(req: AuthRequest, res: Response) {
    const versions = await recipeRepository.findVersions(req.params.id);
    res.json({ success: true, data: versions });
  },
  async remove(req: AuthRequest, res: Response) {
    await recipeRepository.delete(req.params.id);
    res.json({ success: true, data: null });
  },
};
