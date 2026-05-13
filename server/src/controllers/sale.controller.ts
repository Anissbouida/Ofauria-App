import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { saleRepository } from '../repositories/sale.repository.js';
import { productRepository } from '../repositories/product.repository.js';
import { cashRegisterRepository } from '../repositories/cash-register.repository.js';
import { getVitrineStock } from '../repositories/product-stock.helper.js';

export const saleController = {
  async list(req: AuthRequest, res: Response) {
    // Non-admin sans storeId : refuse explicitement (pas d'acces global implicite).
    if (!req.user!.storeId && req.user!.role !== 'admin') {
      res.status(403).json({ success: false, error: { message: 'Utilisateur non rattache a un magasin' } });
      return;
    }
    const { dateFrom, dateTo, customerId, paymentMethod, userId, search, categoryId, productId, paymentStatus, page = '1', limit = '20' } = req.query as Record<string, string>;
    // OWASP API4 : borner pagination pour eviter DoS DB.
    const p = Math.max(1, Math.min(100000, parseInt(page) || 1));
    const l = Math.max(1, Math.min(200, parseInt(limit) || 20));
    const validPaymentStatus = paymentStatus === 'paid' || paymentStatus === 'unpaid' ? paymentStatus : undefined;
    const result = await saleRepository.findAll({
      dateFrom, dateTo, customerId, paymentMethod, userId, search, categoryId, productId,
      paymentStatus: validPaymentStatus,
      storeId: req.user!.storeId,
      limit: l, offset: (p - 1) * l,
    });
    res.json({ success: true, data: result.rows, total: result.total, page: p, limit: l, totalPages: Math.ceil(result.total / l) });
  },

  async getById(req: AuthRequest, res: Response) {
    const sale = await saleRepository.findById(req.params.id);
    if (!sale) { res.status(404).json({ success: false, error: { message: 'Vente non trouvee' } }); return; }
    // Admin global (storeId: null) peut voir toutes les ventes.
    // Utilisateur rattache a un store : acces uniquement a son store.
    // Non-admin sans storeId : refuse (politique explicite, pas d'acces global implicite).
    const userStoreId = req.user!.storeId;
    if (!userStoreId && req.user!.role !== 'admin') {
      res.status(403).json({ success: false, error: { message: 'Utilisateur non rattache a un magasin' } });
      return;
    }
    if (userStoreId && sale.store_id && sale.store_id !== userStoreId) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } }); return;
    }
    res.json({ success: true, data: sale });
  },

  async checkout(req: AuthRequest, res: Response) {
    const { customerId, items, paymentMethod, notes, discountAmount = 0, paymentStatus = 'paid', unpaidCustomerName } = req.body;

    // POS strictly consumes from vitrine (product_store_stock). Cashier must be
    // rattached to a store — otherwise we risk silently decrementing the global
    // fallback in products.stock_quantity instead of the store's vitrine row.
    if (!req.user!.storeId) {
      res.status(400).json({ success: false, error: { message: 'Caissier non rattache a un magasin — impossible de vendre depuis la vitrine' } });
      return;
    }

    const saleItems = [];
    let subtotal = 0;
    for (const item of items) {
      const product = await productRepository.findById(item.productId);
      if (!product) {
        res.status(400).json({ success: false, error: { message: `Produit ${item.productId} non trouve` } });
        return;
      }

      // Verify sufficient stock in the vitrine before selling
      const currentStock = await getVitrineStock(item.productId, req.user!.storeId);
      if (currentStock < item.quantity) {
        res.status(400).json({
          success: false,
          error: { message: `Stock vitrine insuffisant pour "${product.name}" — disponible: ${currentStock}, demande: ${item.quantity}. Faire une demande d'approvisionnement.` },
        });
        return;
      }

      const itemSubtotal = parseFloat(product.price) * item.quantity;
      subtotal += itemSubtotal;
      saleItems.push({ productId: item.productId, quantity: item.quantity, unitPrice: parseFloat(product.price), subtotal: itemSubtotal });
    }

    const taxAmount = 0;

    // Defense metier : la remise ne doit jamais depasser le sous-total (OWASP A04-4).
    // Le schema Zod borne deja discountAmount a [0, 999999.99] et coerce le type.
    if (discountAmount > subtotal) {
      res.status(400).json({
        success: false,
        error: { message: `Remise (${discountAmount}) superieure au sous-total (${subtotal})` },
      });
      return;
    }

    const total = subtotal - discountAmount + taxAmount;

    // Paiement reporte : on exige un beneficiaire identifiable (client formel OU nom libre).
    // Sans ca, on ne saurait pas a qui reclamer plus tard.
    if (paymentStatus === 'unpaid' && !customerId && !(unpaidCustomerName && unpaidCustomerName.trim())) {
      res.status(400).json({ success: false, error: { message: 'Un client ou un nom de beneficiaire est requis pour un paiement reporte' } });
      return;
    }

    // Require an open cash register session
    const activeSession = await cashRegisterRepository.findOpenSession(req.user!.userId);
    if (!activeSession) {
      res.status(400).json({ success: false, error: { message: 'Vous devez ouvrir la caisse avant de vendre' } });
      return;
    }

    // Pour une vente impayee, on force payment_method='credit' jusqu'a l'encaissement
    // (le mode reel sera renseigne lors du pay).
    const effectivePaymentMethod = paymentStatus === 'unpaid' ? 'credit' : paymentMethod;

    const sale = await saleRepository.create({
      customerId, userId: req.user!.userId,
      subtotal, taxAmount, discountAmount, total, paymentMethod: effectivePaymentMethod, notes, items: saleItems,
      sessionId: activeSession.id, storeId: req.user!.storeId,
      paymentStatus, unpaidCustomerName: unpaidCustomerName?.trim() || undefined,
    });

    res.status(201).json({ success: true, data: sale });
  },

  async pay(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { paymentMethod } = req.body;

    if (!req.user!.storeId) {
      res.status(400).json({ success: false, error: { message: 'Caissier non rattache a un magasin' } });
      return;
    }

    const existing = await saleRepository.findById(id);
    if (!existing) {
      res.status(404).json({ success: false, error: { message: 'Vente non trouvee' } });
      return;
    }
    if (existing.store_id && existing.store_id !== req.user!.storeId) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } });
      return;
    }

    const activeSession = await cashRegisterRepository.findOpenSession(req.user!.userId);
    if (!activeSession) {
      res.status(400).json({ success: false, error: { message: 'Vous devez ouvrir la caisse avant d\'encaisser' } });
      return;
    }

    const result = await saleRepository.markPaid(id, { paymentMethod, sessionId: activeSession.id });
    if (!result.ok) {
      if (result.reason === 'not_found') {
        res.status(404).json({ success: false, error: { message: 'Vente non trouvee' } });
        return;
      }
      if (result.reason === 'already_paid') {
        res.status(409).json({ success: false, error: { message: 'Cette vente est deja payee' } });
        return;
      }
    } else {
      res.json({ success: true, data: result.sale });
      return;
    }
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
