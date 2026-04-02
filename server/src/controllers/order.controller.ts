import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { orderRepository } from '../repositories/order.repository.js';
import { productRepository } from '../repositories/product.repository.js';

export const orderController = {
  async list(req: AuthRequest, res: Response) {
    const { status, type, customerId, page = '1', limit = '20' } = req.query as Record<string, string>;
    const p = parseInt(page); const l = parseInt(limit);
    const result = await orderRepository.findAll({
      status, type, customerId, limit: l, offset: (p - 1) * l,
    });
    res.json({ success: true, data: result.rows, total: result.total, page: p, limit: l, totalPages: Math.ceil(result.total / l) });
  },

  async getById(req: AuthRequest, res: Response) {
    const order = await orderRepository.findById(req.params.id);
    if (!order) { res.status(404).json({ success: false, error: { message: 'Commande non trouvée' } }); return; }
    res.json({ success: true, data: order });
  },

  async create(req: AuthRequest, res: Response) {
    const { customerId, type, items, paymentMethod, notes, pickupDate, discountAmount = 0 } = req.body;

    // Resolve prices
    const orderItems = [];
    let subtotal = 0;
    for (const item of items) {
      const product = await productRepository.findById(item.productId);
      if (!product) {
        res.status(400).json({ success: false, error: { message: `Produit ${item.productId} non trouvé` } });
        return;
      }
      const itemSubtotal = parseFloat(product.price) * item.quantity;
      subtotal += itemSubtotal;
      orderItems.push({ productId: item.productId, quantity: item.quantity, unitPrice: parseFloat(product.price), subtotal: itemSubtotal, notes: item.notes });
    }

    const taxAmount = 0; // TVA gérée selon la réglementation
    const total = subtotal - discountAmount + taxAmount;
    const orderNumber = await orderRepository.generateOrderNumber();

    const order = await orderRepository.create({
      orderNumber, customerId, userId: req.user!.userId, type,
      subtotal, taxAmount, discountAmount, total, paymentMethod, notes, pickupDate, items: orderItems,
    });

    res.status(201).json({ success: true, data: order });
  },

  async updateStatus(req: AuthRequest, res: Response) {
    const { status } = req.body;
    const order = await orderRepository.updateStatus(req.params.id, status);
    if (!order) { res.status(404).json({ success: false, error: { message: 'Commande non trouvée' } }); return; }
    res.json({ success: true, data: order });
  },
};
