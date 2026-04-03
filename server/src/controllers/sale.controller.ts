import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { saleRepository } from '../repositories/sale.repository.js';
import { productRepository } from '../repositories/product.repository.js';

export const saleController = {
  async list(req: AuthRequest, res: Response) {
    const { dateFrom, dateTo, customerId, page = '1', limit = '20' } = req.query as Record<string, string>;
    const p = parseInt(page); const l = parseInt(limit);
    const result = await saleRepository.findAll({
      dateFrom, dateTo, customerId, limit: l, offset: (p - 1) * l,
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

    const sale = await saleRepository.create({
      customerId, userId: req.user!.userId,
      subtotal, taxAmount, discountAmount, total, paymentMethod, notes, items: saleItems,
    });

    res.status(201).json({ success: true, data: sale });
  },

  async todayStats(_req: AuthRequest, res: Response) {
    const stats = await saleRepository.todayStats();
    res.json({ success: true, data: stats });
  },
};
