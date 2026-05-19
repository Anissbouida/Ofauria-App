import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { sachetConfigRepository } from '../repositories/sachet-config.repository.js';
import { computeSuggestedSachets } from '../services/sachet-calculator.service.js';

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

export const sachetConfigController = {
  async get(_req: AuthRequest, res: Response) {
    const config = await sachetConfigRepository.get();
    res.json({ success: true, data: config });
  },

  async update(req: AuthRequest, res: Response) {
    const { defaultArticlesPerSachet, categories } = req.body as {
      defaultArticlesPerSachet?: unknown;
      categories?: Array<{ id: unknown; articlesPerSachet: unknown; needsSachet: unknown }>;
    };

    if (defaultArticlesPerSachet !== undefined && !isPositiveInt(defaultArticlesPerSachet)) {
      res.status(400).json({
        success: false,
        error: { message: 'Le défaut global doit être un entier > 0' },
      });
      return;
    }

    const cleanCategories: Array<{
      id: number;
      articlesPerSachet: number | null;
      needsSachet: boolean;
    }> = [];

    if (categories !== undefined) {
      if (!Array.isArray(categories)) {
        res.status(400).json({ success: false, error: { message: 'categories doit être un tableau' } });
        return;
      }
      for (const cat of categories) {
        if (!isPositiveInt(cat.id)) {
          res.status(400).json({ success: false, error: { message: 'id de catégorie invalide' } });
          return;
        }
        const aps = cat.articlesPerSachet;
        if (aps !== null && !isPositiveInt(aps)) {
          res.status(400).json({
            success: false,
            error: { message: `articlesPerSachet invalide pour la catégorie ${cat.id} (entier > 0 ou null)` },
          });
          return;
        }
        if (typeof cat.needsSachet !== 'boolean') {
          res.status(400).json({
            success: false,
            error: { message: `needsSachet invalide pour la catégorie ${cat.id} (boolean requis)` },
          });
          return;
        }
        cleanCategories.push({
          id: cat.id,
          articlesPerSachet: aps as number | null,
          needsSachet: cat.needsSachet,
        });
      }
    }

    const config = await sachetConfigRepository.update({
      defaultArticlesPerSachet: defaultArticlesPerSachet as number | undefined,
      categories: categories !== undefined ? cleanCategories : undefined,
    });

    res.json({ success: true, data: config });
  },

  async suggest(req: AuthRequest, res: Response) {
    const { items } = req.body as {
      items?: Array<{ productId: unknown; quantity: unknown }>;
    };

    if (!Array.isArray(items)) {
      res.status(400).json({ success: false, error: { message: 'items doit être un tableau' } });
      return;
    }

    const clean: Array<{ productId: string; quantity: number }> = [];
    for (const it of items) {
      if (typeof it.productId !== 'string' || it.productId.length === 0) {
        res.status(400).json({ success: false, error: { message: 'productId invalide' } });
        return;
      }
      if (typeof it.quantity !== 'number' || !isFinite(it.quantity) || it.quantity <= 0) {
        res.status(400).json({ success: false, error: { message: 'quantity invalide' } });
        return;
      }
      clean.push({ productId: it.productId, quantity: it.quantity });
    }

    const result = await computeSuggestedSachets(clean);
    res.json({ success: true, data: result });
  },

  async report(req: AuthRequest, res: Response) {
    const { dateFrom, dateTo, storeId } = req.query as Record<string, string | undefined>;

    const isValidIso = (s: string | undefined) =>
      !s || /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(s);
    if (!isValidIso(dateFrom) || !isValidIso(dateTo)) {
      res.status(400).json({ success: false, error: { message: 'Date invalide (ISO attendu)' } });
      return;
    }
    if (storeId && !/^[0-9a-f-]{36}$/i.test(storeId)) {
      res.status(400).json({ success: false, error: { message: 'storeId invalide' } });
      return;
    }

    // Non-admin : restreint au magasin de l'utilisateur.
    const effectiveStoreId =
      req.user!.role === 'admin' ? storeId : req.user!.storeId || undefined;

    const data = await sachetConfigRepository.report({
      dateFrom,
      dateTo,
      storeId: effectiveStoreId,
    });
    res.json({ success: true, data });
  },
};
