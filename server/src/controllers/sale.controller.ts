import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { saleRepository } from '../repositories/sale.repository.js';
import { productRepository } from '../repositories/product.repository.js';
import { cashRegisterRepository } from '../repositories/cash-register.repository.js';

export const saleController = {
  async list(req: AuthRequest, res: Response) {
    const { dateFrom, dateTo, customerId, paymentMethod, userId, search, categoryId, productId, page = '1', limit = '20' } = req.query as Record<string, string>;
    const p = parseInt(page); const l = parseInt(limit);
    const result = await saleRepository.findAll({
      dateFrom, dateTo, customerId, paymentMethod, userId, search, categoryId, productId,
      storeId: req.user!.storeId,
      limit: l, offset: (p - 1) * l,
    });
    res.json({ success: true, data: result.rows, total: result.total, page: p, limit: l, totalPages: Math.ceil(result.total / l) });
  },

  async getById(req: AuthRequest, res: Response) {
    const sale = await saleRepository.findById(req.params.id);
    if (!sale) { res.status(404).json({ success: false, error: { message: 'Vente non trouvee' } }); return; }
    res.json({ success: true, data: sale });
  },

  async checkout(req: AuthRequest, res: Response) {
    const { customerId, items, paymentMethod, notes, discountAmount = 0 } = req.body;

    const saleItems = [];
    let subtotal = 0;
    for (const item of items) {
      const product = await productRepository.findById(item.productId);
      if (!product) {
        res.status(400).json({ success: false, error: { message: `Produit ${item.productId} non trouve` } });
        return;
      }
      const itemSubtotal = parseFloat(product.price) * item.quantity;
      subtotal += itemSubtotal;
      saleItems.push({ productId: item.productId, quantity: item.quantity, unitPrice: parseFloat(product.price), subtotal: itemSubtotal });
    }

    const taxAmount = 0;
    const total = subtotal - discountAmount + taxAmount;

    // Require an open cash register session
    const activeSession = await cashRegisterRepository.findOpenSession(req.user!.userId);
    if (!activeSession) {
      res.status(400).json({ success: false, error: { message: 'Vous devez ouvrir la caisse avant de vendre' } });
      return;
    }

    const sale = await saleRepository.create({
      customerId, userId: req.user!.userId,
      subtotal, taxAmount, discountAmount, total, paymentMethod, notes, items: saleItems,
      sessionId: activeSession.id, storeId: req.user!.storeId,
    });

    res.status(201).json({ success: true, data: sale });
  },

  async todayStats(req: AuthRequest, res: Response) {
    const stats = await saleRepository.todayStats(req.user!.storeId);
    res.json({ success: true, data: stats });
  },

  async summary(req: AuthRequest, res: Response) {
    const { dateFrom, dateTo, groupBy = 'category' } = req.query as Record<string, string>;
    const result = await saleRepository.summary({ dateFrom, dateTo, groupBy, storeId: req.user!.storeId });
    res.json({ success: true, data: result });
  },

  async importCSV(req: AuthRequest, res: Response) {
    const { days } = req.body as {
      days: {
        date: string;
        items: { sku: string; productName: string; quantity: number; unitPrice: number; netSales: number; costOfGoods: number }[];
      }[];
    };

    if (!days || !Array.isArray(days) || days.length === 0) {
      res.status(400).json({ success: false, error: { message: 'Données manquantes' } });
      return;
    }

    const results = [];
    for (const day of days) {
      const result = await saleRepository.importDailySales({
        date: day.date,
        userId: req.user!.userId,
        storeId: req.user!.storeId,
        items: day.items,
      });
      results.push({ date: day.date, ...result });
    }

    res.json({ success: true, data: results });
  },
};
