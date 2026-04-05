import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { orderRepository } from '../repositories/order.repository.js';
import { productRepository } from '../repositories/product.repository.js';
import { customerRepository } from '../repositories/customer.repository.js';
import { cashRegisterRepository } from '../repositories/cash-register.repository.js';
import { saleRepository } from '../repositories/sale.repository.js';
import { productionRepository } from '../repositories/production.repository.js';
import { createNotification } from '../utils/notify.js';

/** Category slug → chef role mapping */
const CATEGORY_ROLE_MAP: Record<string, string> = {
  'baguette': 'baker', 'baguette-tradition': 'baker', 'beldi': 'baker',
  'pain-rond': 'baker', 'pain-sandwich': 'baker',
  'viennoiseries': 'viennoiserie',
  'patisserie-classique': 'pastry_chef', 'patisserie-premium': 'pastry_chef',
  'gateaux-cookies': 'pastry_chef', 'les-boites': 'pastry_chef',
  'macaron': 'pastry_chef', 'pieces-portions': 'pastry_chef',
  'plateau-sale-sucre': 'pastry_chef', 'sachet-mini': 'pastry_chef',
};

/** Determine which chef role is responsible for a product based on its category slug */
function getRoleForCategorySlug(slug: string | null): string {
  if (!slug) return 'baker';
  return CATEGORY_ROLE_MAP[slug] || 'baker';
}

export const orderController = {
  async list(req: AuthRequest, res: Response) {
    const { status, type, customerId, page = '1', limit = '20' } = req.query as Record<string, string>;
    const p = parseInt(page); const l = parseInt(limit);
    const result = await orderRepository.findAll({
      status, type, customerId, storeId: req.user!.storeId, limit: l, offset: (p - 1) * l,
    });
    res.json({ success: true, data: result.rows, total: result.total, page: p, limit: l, totalPages: Math.ceil(result.total / l) });
  },

  async getById(req: AuthRequest, res: Response) {
    const order = await orderRepository.findById(req.params.id);
    if (!order) { res.status(404).json({ success: false, error: { message: 'Commande non trouvee' } }); return; }
    res.json({ success: true, data: order });
  },

  async create(req: AuthRequest, res: Response) {
    let { customerId } = req.body;
    const { customerName, customerPhone, type, items, paymentMethod, notes, pickupDate, discountAmount = 0, advanceAmount = 0 } = req.body;

    // If no customerId, find or create customer by name/phone
    if (!customerId && customerName) {
      const nameParts = customerName.trim().split(/\s+/);
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(' ') || '';

      // Try to find existing customer by phone
      if (customerPhone) {
        const existing = await customerRepository.findByPhone(customerPhone);
        if (existing) {
          customerId = existing.id;
        }
      }

      // Create new customer if not found
      if (!customerId) {
        const newCustomer = await customerRepository.create({
          firstName, lastName, phone: customerPhone || undefined,
        });
        customerId = newCustomer.id;
      }
    }

    if (!customerId) {
      res.status(400).json({ success: false, error: { message: 'Le nom du client est requis' } });
      return;
    }
    if (!pickupDate) {
      res.status(400).json({ success: false, error: { message: 'Une date de retrait est requise' } });
      return;
    }

    const orderItems = [];
    const responsibleUserIds = new Set<string>();
    const responsibleRoles = new Set<string>();
    let subtotal = 0;
    for (const item of items) {
      const product = await productRepository.findById(item.productId);
      if (!product) {
        res.status(400).json({ success: false, error: { message: `Produit ${item.productId} non trouve` } });
        return;
      }
      const itemSubtotal = parseFloat(product.price) * item.quantity;
      subtotal += itemSubtotal;
      orderItems.push({ productId: item.productId, quantity: item.quantity, unitPrice: parseFloat(product.price), subtotal: itemSubtotal, notes: item.notes });
      // Track responsible chefs for targeted notifications
      if (product.responsible_user_id) {
        responsibleUserIds.add(product.responsible_user_id);
      }
      if (product.responsible_role) {
        responsibleRoles.add(product.responsible_role);
      }
    }

    const taxAmount = 0;
    const total = subtotal - discountAmount + taxAmount;
    const orderNumber = await orderRepository.generateOrderNumber();

    // Link to active cash register session
    const activeSession = await cashRegisterRepository.findOpenSession(req.user!.userId);

    const order = await orderRepository.create({
      orderNumber, customerId, userId: req.user!.userId, type: type || 'custom',
      subtotal, taxAmount, discountAmount, total, advanceAmount, paymentMethod, notes, pickupDate, items: orderItems,
      sessionId: activeSession?.id, storeId: req.user!.storeId,
    });

    // Auto-confirm and send order to production
    await orderRepository.updateStatus(order.id, 'confirmed');
    await orderRepository.updateStatus(order.id, 'in_production');

    // Auto-create production plans grouped by responsible chef role
    // Priority: product.responsible_role > category-based role > 'baker' fallback
    const itemsByRole = new Map<string, { productId: string; plannedQuantity: number }[]>();
    for (const item of items) {
      const product = await productRepository.findById(item.productId);
      if (!product) continue;
      const role = product.responsible_role || getRoleForCategorySlug(product.category_slug);
      if (!itemsByRole.has(role)) itemsByRole.set(role, []);
      itemsByRole.get(role)!.push({ productId: item.productId, plannedQuantity: item.quantity });
    }

    // Create one production plan per chef role, linked to the order
    const createdPlans: { id: string; targetRole: string }[] = [];
    for (const [role, planItems] of itemsByRole) {
      try {
        const plan = await productionRepository.create({
          planDate: pickupDate,
          type: 'daily',
          notes: `Commande ${orderNumber} — Client: ${customerName || ''}`,
          createdBy: req.user!.userId,
          targetRole: role,
          storeId: req.user!.storeId,
          orderId: order.id,
          items: planItems,
        });
        createdPlans.push({ id: plan.id, targetRole: role });
      } catch (err) {
        console.error(`Failed to auto-create production plan for role ${role}:`, err);
      }
    }

    // Notify chefs about auto-created production plans
    for (const plan of createdPlans) {
      await createNotification({
        targetRole: plan.targetRole,
        storeId: req.user!.storeId,
        type: 'production_plan_created',
        title: 'Nouvelle demande de production',
        message: `Commande ${orderNumber} pour le ${pickupDate} — ${itemsByRole.get(plan.targetRole)?.length || 0} produit(s) a produire`,
        referenceType: 'production_plan',
        referenceId: plan.id,
        createdBy: req.user!.userId,
      });
    }

    res.status(201).json({ success: true, data: { ...order, status: 'in_production' } });
  },

  async update(req: AuthRequest, res: Response) {
    let { customerId } = req.body;
    const { customerName, customerPhone, type, items, paymentMethod, notes, pickupDate, discountAmount = 0, advanceAmount = 0 } = req.body;

    // Find or create customer if name provided
    if (!customerId && customerName) {
      const nameParts = customerName.trim().split(/\s+/);
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(' ') || '';

      if (customerPhone) {
        const existing = await customerRepository.findByPhone(customerPhone);
        if (existing) customerId = existing.id;
      }
      if (!customerId) {
        const newCustomer = await customerRepository.create({ firstName, lastName, phone: customerPhone || undefined });
        customerId = newCustomer.id;
      }
    }

    const orderItems = [];
    let subtotal = 0;
    for (const item of items) {
      const product = await productRepository.findById(item.productId);
      if (!product) {
        res.status(400).json({ success: false, error: { message: `Produit ${item.productId} non trouve` } });
        return;
      }
      const itemSubtotal = parseFloat(product.price) * item.quantity;
      subtotal += itemSubtotal;
      orderItems.push({ productId: item.productId, quantity: item.quantity, unitPrice: parseFloat(product.price), subtotal: itemSubtotal, notes: item.notes });
    }

    const taxAmount = 0;
    const total = subtotal - discountAmount + taxAmount;

    const order = await orderRepository.update(req.params.id, {
      customerId, type, subtotal, taxAmount, discountAmount, total, advanceAmount,
      paymentMethod, notes, pickupDate, items: orderItems,
    });

    if (!order) {
      res.status(400).json({ success: false, error: { message: 'Commande non modifiable (statut avance)' } });
      return;
    }

    res.json({ success: true, data: order });
  },

  async updateStatus(req: AuthRequest, res: Response) {
    const { status } = req.body;
    const order = await orderRepository.updateStatus(req.params.id, status);
    if (!order) { res.status(404).json({ success: false, error: { message: 'Commande non trouvee' } }); return; }

    // Notify based on status change
    if (status === 'ready') {
      // Notify cashier/saleswoman that order is ready for pickup
      for (const role of ['cashier', 'saleswoman', 'manager']) {
        await createNotification({
          targetRole: role,
          storeId: req.user!.storeId,
          type: 'order_ready',
          title: 'Commande prete',
          message: `La commande ${order.order_number} est prete pour le retrait`,
          referenceType: 'order',
          referenceId: req.params.id,
          createdBy: req.user!.userId,
        });
      }
    }

    res.json({ success: true, data: order });
  },

  async deliver(req: AuthRequest, res: Response) {
    const { amountPaid, paymentMethod = 'cash' } = req.body;
    const orderId = req.params.id;

    // Require an open cash register session
    const activeSession = await cashRegisterRepository.findOpenSession(req.user!.userId);
    if (!activeSession) {
      res.status(400).json({ success: false, error: { message: 'Vous devez ouvrir la caisse avant de livrer une commande' } });
      return;
    }

    // Get full order with items
    const order = await orderRepository.findById(orderId);
    if (!order) {
      res.status(404).json({ success: false, error: { message: 'Commande non trouvee' } });
      return;
    }
    if (order.status !== 'ready') {
      res.status(400).json({ success: false, error: { message: 'La commande doit etre prete pour etre livree' } });
      return;
    }

    const total = parseFloat(order.total);
    const advanceAmount = parseFloat(order.advance_amount);
    const remaining = total - advanceAmount;
    const paid = parseFloat(amountPaid) || 0;

    // Create a sale for the remaining amount, linked to the active session
    const saleItems = order.items.map((item: Record<string, unknown>) => ({
      productId: item.product_id as string,
      quantity: item.quantity as number,
      unitPrice: parseFloat(item.unit_price as string),
      subtotal: parseFloat(item.subtotal as string),
    }));

    await saleRepository.create({
      customerId: order.customer_id,
      userId: req.user!.userId,
      subtotal: parseFloat(order.subtotal),
      taxAmount: parseFloat(order.tax_amount),
      discountAmount: parseFloat(order.discount_amount),
      total: remaining,
      paymentMethod,
      notes: `Livraison commande ${order.order_number} — Avance: ${advanceAmount.toFixed(2)} DH, Reste paye: ${paid.toFixed(2)} DH`,
      sessionId: activeSession?.id,
      storeId: req.user!.storeId,
      items: saleItems,
    });

    // Mark order as completed
    await orderRepository.updateStatus(orderId, 'completed');

    res.json({ success: true, data: { remaining, paid, orderNumber: order.order_number } });
  },

  // Get pending orders for a specific date (for production planning)
  async forDate(req: AuthRequest, res: Response) {
    const { date } = req.query as Record<string, string>;
    if (!date) { res.status(400).json({ success: false, error: { message: 'Date requise' } }); return; }
    const orders = await orderRepository.findByPickupDate(date, req.user!.storeId);
    res.json({ success: true, data: orders });
  },
};
