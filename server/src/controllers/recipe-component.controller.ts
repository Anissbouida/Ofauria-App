import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { recipeComponentRepository } from '../repositories/recipe-component.repository.js';

export const recipeComponentController = {
  async listRoles(_req: AuthRequest, res: Response) {
    const roles = await recipeComponentRepository.listRoles();
    res.json({ success: true, data: roles });
  },

  async listSources(_req: AuthRequest, res: Response) {
    const sources = await recipeComponentRepository.listSources();
    res.json({ success: true, data: sources });
  },

  async list(req: AuthRequest, res: Response) {
    const data = await recipeComponentRepository.findByFormat(req.params.recipeId, req.params.formatId);
    if (!data) {
      res.status(404).json({ success: false, error: { message: 'Format introuvable pour cette recette' } });
      return;
    }
    res.json({ success: true, data });
  },

  async replace(req: AuthRequest, res: Response) {
    try {
      const data = await recipeComponentRepository.replaceForFormat(
        req.params.recipeId,
        req.params.formatId,
        req.body
      );
      if (!data) {
        res.status(404).json({ success: false, error: { message: 'Format introuvable pour cette recette' } });
        return;
      }
      res.json({ success: true, data });
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === 'RECIPE_CYCLE') {
        res.status(409).json({ success: false, error: { message: (err as Error).message } });
        return;
      }
      throw err;
    }
  },

  // --- Composition niveau recette ---
  async getComposition(req: AuthRequest, res: Response) {
    const data = await recipeComponentRepository.findComposition(req.params.recipeId);
    if (!data) { res.status(404).json({ success: false, error: { message: 'Recette introuvable' } }); return; }
    res.json({ success: true, data });
  },

  async saveComposition(req: AuthRequest, res: Response) {
    try {
      const data = await recipeComponentRepository.replaceComposition(req.params.recipeId, req.body);
      if (!data) { res.status(404).json({ success: false, error: { message: 'Recette introuvable' } }); return; }
      res.json({ success: true, data });
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === 'RECIPE_CYCLE') {
        res.status(409).json({ success: false, error: { message: (err as Error).message } });
        return;
      }
      throw err;
    }
  },

  async saveFinance(req: AuthRequest, res: Response) {
    const data = await recipeComponentRepository.updateFinance(req.params.recipeId, req.body);
    if (!data) { res.status(404).json({ success: false, error: { message: 'Recette introuvable' } }); return; }
    res.json({ success: true, data });
  },

  async children(req: AuthRequest, res: Response) {
    const data = await recipeComponentRepository.findChildren(req.params.recipeId);
    res.json({ success: true, data });
  },

  // --- CRUD format ---
  async listFormats(req: AuthRequest, res: Response) {
    const formats = await recipeComponentRepository.listFormats(req.params.recipeId);
    res.json({ success: true, data: formats });
  },

  async createFormat(req: AuthRequest, res: Response) {
    try {
      const data = await recipeComponentRepository.createFormat(req.params.recipeId, req.body);
      res.status(201).json({ success: true, data });
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === '23505') {
        res.status(409).json({ success: false, error: { message: 'Ce contenant est déjà utilisé par un format de cette recette' } });
        return;
      }
      throw err;
    }
  },

  async duplicateFormat(req: AuthRequest, res: Response) {
    try {
      const data = await recipeComponentRepository.duplicateFormat(req.params.recipeId, req.params.formatId, req.body.contenantId);
      if (!data) { res.status(404).json({ success: false, error: { message: 'Format source introuvable' } }); return; }
      res.status(201).json({ success: true, data });
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === '23505') {
        res.status(409).json({ success: false, error: { message: 'Ce contenant est déjà utilisé par un format de cette recette' } });
        return;
      }
      throw err;
    }
  },

  async updateFormat(req: AuthRequest, res: Response) {
    try {
      const data = await recipeComponentRepository.updateFormat(req.params.recipeId, req.params.formatId, req.body);
      if (!data) { res.status(404).json({ success: false, error: { message: 'Format introuvable' } }); return; }
      res.json({ success: true, data });
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === '23505') {
        res.status(409).json({ success: false, error: { message: 'Ce contenant est déjà utilisé par un autre format' } });
        return;
      }
      throw err;
    }
  },

  async deleteFormat(req: AuthRequest, res: Response) {
    const ok = await recipeComponentRepository.deleteFormat(req.params.recipeId, req.params.formatId);
    if (!ok) { res.status(404).json({ success: false, error: { message: 'Format introuvable' } }); return; }
    res.json({ success: true });
  },
};
