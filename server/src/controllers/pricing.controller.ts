import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { db } from '../config/database.js';
import { priceListRepository } from '../repositories/pricing.repository.js';
import { resolveSalePrice, priceContextForCustomer } from '../services/pricing.service.js';

// Listes de prix (phase 6.1–6.3) : administration + résolution du prix applicable.

export const pricingController = {
  async list(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: await priceListRepository.list() });
  },
  async get(req: AuthRequest, res: Response) {
    const row = await priceListRepository.get(req.params.id);
    if (!row) { res.status(404).json({ success: false, error: { message: 'Liste introuvable' } }); return; }
    res.json({ success: true, data: row });
  },
  async create(req: AuthRequest, res: Response) {
    const { name } = req.body as { name?: string };
    if (!name || !name.trim()) { res.status(400).json({ success: false, error: { message: 'Nom requis' } }); return; }
    res.status(201).json({ success: true, data: await priceListRepository.create(req.body, req.user!.userId) });
  },
  async update(req: AuthRequest, res: Response) {
    const row = await priceListRepository.update(req.params.id, req.body);
    if (!row) { res.status(404).json({ success: false, error: { message: 'Liste introuvable' } }); return; }
    res.json({ success: true, data: row });
  },
  async remove(req: AuthRequest, res: Response) {
    const row = await priceListRepository.remove(req.params.id);
    if (!row) { res.status(404).json({ success: false, error: { message: 'Liste introuvable' } }); return; }
    res.json({ success: true, data: null });
  },
  async setItem(req: AuthRequest, res: Response) {
    const { productId, unitPrice } = req.body as { productId?: string; unitPrice?: number };
    if (!productId || unitPrice == null) { res.status(400).json({ success: false, error: { message: 'Article et prix requis' } }); return; }
    res.status(201).json({ success: true, data: await priceListRepository.setItem(req.params.id, req.body) });
  },
  async removeItem(req: AuthRequest, res: Response) {
    const row = await priceListRepository.removeItem(req.params.id, req.params.itemId);
    if (!row) { res.status(404).json({ success: false, error: { message: 'Ligne introuvable' } }); return; }
    res.json({ success: true, data: null });
  },

  /** Mise à jour en masse du prix catalogue (phase 6.5), tracée. */
  async bulkUpdate(req: AuthRequest, res: Response) {
    const { mode, value, reason, categoryId, family, productIds } = req.body as Record<string, any>;
    if (mode !== 'increase_pct' && mode !== 'set') { res.status(400).json({ success: false, error: { message: 'Mode invalide' } }); return; }
    if (value == null || !Number.isFinite(Number(value))) { res.status(400).json({ success: false, error: { message: 'Valeur requise' } }); return; }
    if (categoryId == null && !family && !(Array.isArray(productIds) && productIds.length)) {
      res.status(400).json({ success: false, error: { message: 'Choisissez une famille, une catégorie ou des articles' } }); return;
    }
    const result = await priceListRepository.bulkUpdatePrices(
      { categoryId: categoryId != null ? Number(categoryId) : undefined, family: family || undefined,
        productIds: Array.isArray(productIds) ? productIds : undefined, mode, value: Number(value), reason: reason || '' },
      req.user!.userId);
    res.json({ success: true, data: result });
  },

  /** Historique des changements de prix (phase 6.5). */
  async history(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await priceListRepository.priceHistory((req.query.productId as string) || undefined) });
  },

  /** Prix applicable pour un article dans un contexte (caisse, devis, commande, BL). */
  async resolve(req: AuthRequest, res: Response) {
    const { productId, quantity, channelId, customerId } = req.query as Record<string, string>;
    if (!productId) { res.status(400).json({ success: false, error: { message: 'productId requis' } }); return; }
    const qty = parseFloat(quantity) || 1;
    const ctx = await priceContextForCustomer(db, customerId || null, channelId || null);
    const resolved = await resolveSalePrice(db, productId, qty, ctx);
    res.json({ success: true, data: resolved });
  },
};
