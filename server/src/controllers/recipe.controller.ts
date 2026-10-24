import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { recipeRepository } from '../repositories/recipe.repository.js';

export const recipeController = {
  async list(req: AuthRequest, res: Response) {
    // ?archived=1 -> vue « Archivees » (fiches retirees des listes, restaurables).
    const recipes = await recipeRepository.findAll(req.query.archived === '1');
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
  async listCategories(_req: AuthRequest, res: Response) {
    const categories = await recipeRepository.listCategories();
    res.json({ success: true, data: categories });
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
      if (err?.code === 'PIECE_WEIGHT_REQUIRED') {
        res.status(422).json({ success: false, error: { code: err.code, message: err.message } });
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
      if (err?.code === 'PIECE_WEIGHT_REQUIRED') {
        res.status(422).json({ success: false, error: { code: err.code, message: err.message } });
        return;
      }
      throw err;
    }
  },
  async versions(req: AuthRequest, res: Response) {
    const versions = await recipeRepository.findVersions(req.params.id);
    res.json({ success: true, data: versions });
  },
  // DELETE /recipes/:id ARCHIVE la fiche (mig 346) : plus de suppression physique,
  // l'historique de production la reference encore. Restaurable.
  async remove(req: AuthRequest, res: Response) {
    const result = await recipeRepository.archive([req.params.id], req.user?.userId ?? null);
    res.json({ success: true, data: result });
  },
  async restore(req: AuthRequest, res: Response) {
    const result = await recipeRepository.restore([req.params.id]);
    res.json({ success: true, data: result });
  },
  async bulkArchive(req: AuthRequest, res: Response) {
    const result = await recipeRepository.archive(req.body.ids as string[], req.user?.userId ?? null);
    res.json({ success: true, data: result });
  },
  async bulkRestore(req: AuthRequest, res: Response) {
    const result = await recipeRepository.restore(req.body.ids as string[]);
    res.json({ success: true, data: result });
  },
};
