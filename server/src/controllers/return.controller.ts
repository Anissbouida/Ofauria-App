import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { returnRepository } from '../repositories/return.repository.js';
import { saleRepository } from '../repositories/sale.repository.js';
import { cashRegisterRepository } from '../repositories/cash-register.repository.js';

export const returnController = {
  /** List all returns with date filtering */
  async list(req: AuthRequest, res: Response) {
    const { dateFrom, dateTo, limit, offset } = req.query as Record<string, string>;
    const result = await returnRepository.findAll({
      dateFrom, dateTo, storeId: req.user!.storeId,
      limit: limit ? parseInt(limit) : 100,
      offset: offset ? parseInt(offset) : 0,
    });
    res.json({ success: true, data: result.rows, total: result.total });
  },

  /** Search a sale by its sale_number */
  async searchSale(req: AuthRequest, res: Response) {
    const { saleNumber } = req.query as Record<string, string>;
    if (!saleNumber) {
      res.status(400).json({ success: false, error: { message: 'Numero de vente requis' } });
      return;
    }

    const result = await saleRepository.findBySaleNumber(saleNumber.trim());
    if (!result) {
      res.status(404).json({ success: false, error: { message: 'Vente non trouvee' } });
      return;
    }

    // Get already returned quantities per sale_item
    const returnedQtys = await returnRepository.getReturnedQuantities(result.id);

    // Attach returned_quantity to each item
    const items = (result.items || []).map((item: Record<string, unknown>) => ({
      ...item,
      returned_quantity: returnedQtys[item.id as string] || 0,
      returnable_quantity: (item.quantity as number) - (returnedQtys[item.id as string] || 0),
    }));

    const returns = await returnRepository.findBySaleId(result.id);

    res.json({ success: true, data: { ...result, items, returns } });
  },

  /** Create a return or exchange */
  async create(req: AuthRequest, res: Response) {
    const { originalSaleId, type, reason, items, exchangeProducts } = req.body;

    if (!originalSaleId || !type || !items?.length) {
      res.status(400).json({ success: false, error: { message: 'Donnees incompletes' } });
      return;
    }

    if (type === 'exchange' && (!exchangeProducts || !exchangeProducts.length)) {
      res.status(400).json({ success: false, error: { message: 'Produits de remplacement requis pour un echange' } });
      return;
    }

    const sale = await saleRepository.findById(originalSaleId);
    if (!sale) {
      res.status(404).json({ success: false, error: { message: 'Vente non trouvee' } });
      return;
    }

    // Require an open cash register session
    const activeSession = await cashRegisterRepository.findOpenSession(req.user!.userId);
    if (!activeSession) {
      res.status(400).json({ success: false, error: { message: 'Vous devez ouvrir la caisse' } });
      return;
    }

    // Check that returned quantities don't exceed returnable quantities
    const returnedQtys = await returnRepository.getReturnedQuantities(originalSaleId);
    const saleItems = (sale.items || []) as Record<string, unknown>[];

    for (const item of items) {
      const saleItem = saleItems.find((si: Record<string, unknown>) => si.id === item.saleItemId);
      if (!saleItem) {
        res.status(400).json({ success: false, error: { message: `Article ${item.saleItemId} non trouve dans la vente` } });
        return;
      }
      const alreadyReturned = returnedQtys[item.saleItemId] || 0;
      const maxReturnable = (saleItem.quantity as number) - alreadyReturned;
      if (item.quantity > maxReturnable) {
        res.status(400).json({
          success: false,
          error: { message: `L'article "${(saleItem as Record<string, unknown>).product_name}" a deja ete retourne (${alreadyReturned}/${saleItem.quantity}). Maximum retournable: ${maxReturnable}` }
        });
        return;
      }
    }

    const refundAmount = items.reduce((sum: number, it: { subtotal: number }) => sum + it.subtotal, 0);

    const result = await returnRepository.create({
      originalSaleId,
      userId: req.user!.userId,
      sessionId: activeSession.id,
      storeId: req.user!.storeId,
      type,
      reason,
      refundAmount,
      items,
      exchangeProducts: type === 'exchange' ? exchangeProducts : undefined,
    });

    res.status(201).json({ success: true, data: result });
  },
};
