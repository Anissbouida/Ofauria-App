import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { productionMarkupRepository } from '../repositories/production-markup.repository.js';

/** Valide un pourcentage de majoration : nombre fini entre 0 et 100. */
function parsePercent(value: unknown): number | null {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
}

export const productionMarkupController = {
  async get(_req: AuthRequest, res: Response) {
    const config = await productionMarkupRepository.getConfig();
    const history = await productionMarkupRepository.getHistory(50);
    res.json({ success: true, data: { ...config, history } });
  },

  // Met a jour le taux global et/ou des overrides de categorie en un lot.
  // Une categorie avec percent null/absent => suppression de son override.
  async update(req: AuthRequest, res: Response) {
    const body = req.body as { globalPercent?: unknown; categories?: unknown };
    const changes: {
      globalPercent?: number;
      categories: { categoryId: number; percent: number | null }[];
    } = { categories: [] };

    if (body.globalPercent !== undefined) {
      const g = parsePercent(body.globalPercent);
      if (g === null) {
        res.status(400).json({ success: false, error: { message: 'Majoration globale invalide (0 a 100 %)' } });
        return;
      }
      changes.globalPercent = g;
    }

    if (Array.isArray(body.categories)) {
      for (const c of body.categories as Array<{ categoryId: unknown; percent: unknown }>) {
        const categoryId = parseInt(String(c.categoryId), 10);
        if (!Number.isInteger(categoryId)) {
          res.status(400).json({ success: false, error: { message: 'Categorie invalide' } });
          return;
        }
        let percent: number | null = null;
        if (c.percent !== null && c.percent !== undefined && c.percent !== '') {
          percent = parsePercent(c.percent);
          if (percent === null) {
            res.status(400).json({ success: false, error: { message: 'Majoration de categorie invalide (0 a 100 %)' } });
            return;
          }
        }
        changes.categories.push({ categoryId, percent });
      }
    }

    await productionMarkupRepository.applyChanges(changes, req.user!.userId);
    const config = await productionMarkupRepository.getConfig();
    const history = await productionMarkupRepository.getHistory(50);
    res.json({ success: true, data: { ...config, history } });
  },
};
