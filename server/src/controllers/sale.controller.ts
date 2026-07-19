import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { saleRepository } from '../repositories/sale.repository.js';
import { productRepository } from '../repositories/product.repository.js';
import { pricingTierRepository } from '../repositories/product-pricing-tier.repository.js';
import { channelPricingRepository } from '../repositories/product-channel-pricing.repository.js';
import { salesChannelRepository } from '../repositories/sales-channel.repository.js';
import { cashRegisterRepository } from '../repositories/cash-register.repository.js';
import { getVitrineStock } from '../repositories/product-stock.helper.js';
import { attendanceRepository } from '../repositories/employee.repository.js';

export const saleController = {
  async list(req: AuthRequest, res: Response) {
    // Non-admin sans storeId : refuse explicitement (pas d'acces global implicite).
    if (!req.user!.storeId && req.user!.role !== 'admin') {
      res.status(403).json({ success: false, error: { message: 'Utilisateur non rattache a un magasin' } });
      return;
    }
    const { dateFrom, dateTo, customerId, paymentMethod, userId, search, categoryId, productId, paymentStatus, saleType, page = '1', limit = '20' } = req.query as Record<string, string>;
    // OWASP API4 : borner pagination pour eviter DoS DB.
    const p = Math.max(1, Math.min(100000, parseInt(page) || 1));
    const l = Math.max(1, Math.min(200, parseInt(limit) || 20));
    const validPaymentStatus = paymentStatus === 'paid' || paymentStatus === 'unpaid' ? paymentStatus : undefined;
    const validSaleType = ['standard', 'advance', 'delivery', 'special'].includes(saleType) ? saleType : undefined;
    const result = await saleRepository.findAll({
      dateFrom, dateTo, customerId, paymentMethod, userId, search, categoryId, productId,
      paymentStatus: validPaymentStatus,
      saleType: validSaleType,
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
    const {
      customerId, items, paymentMethod, notes, discountAmount = 0,
      paymentStatus = 'paid', unpaidCustomerName, employeeId: explicitEmployeeId,
      sachetsGiven, sachetsSuggested, sachetReason,
      channelId: explicitChannelId,
      cashAmount, cardAmount,
    } = req.body;

    // Resolution du canal de vente : si non fourni, on prend le canal par defaut.
    let channelId: string | null = explicitChannelId || null;
    if (!channelId) {
      const defaultChannel = await salesChannelRepository.findDefault();
      channelId = defaultChannel?.id || null;
    }

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

      // Verify sufficient stock in the vitrine before selling.
      // Pour les produits au poids, item.quantity = poids vendu en grammes
      // et currentStock = grammes restants en vitrine (stock géré en grammes).
      const currentStock = await getVitrineStock(item.productId, req.user!.storeId);
      if (currentStock < item.quantity) {
        const unitLabel = product.sale_unit === 'weight' ? 'g' : 'pièces';
        res.status(400).json({
          success: false,
          error: { message: `Stock vitrine insuffisant pour "${product.name}" — disponible: ${currentStock} ${unitLabel}, demande: ${item.quantity} ${unitLabel}. Faire une demande d'approvisionnement.` },
        });
        return;
      }

      // Subtotal :
      //   - unitaire : prix × quantité
      //   - au poids : (poids_g / 1000) × prix_par_kg
      let itemSubtotal: number;
      let unitPrice: number;
      let lineUnit: 'unit' | 'g' = 'unit';
      // Unité d'affichage du recu : memorise le toggle g/kg du caissier pour
      // les ventes au poids. NULL pour les produits unitaires.
      let lineDisplayUnit: 'g' | 'kg' | null = null;
      // Resolution prix selon le canal (mig 173) :
      //   1) product_channel_pricing si un override existe pour (product, channel)
      //   2) palier tarifaire (sale_unit=weight)
      //   3) products.price / price_per_kg
      const channelOverride = await channelPricingRepository.findOverride(item.productId, channelId);

      if (product.sale_unit === 'weight') {
        let pricePerKg: number;
        if (channelOverride?.price_per_kg_override) {
          pricePerKg = parseFloat(channelOverride.price_per_kg_override);
        } else {
          const tier = await pricingTierRepository.findMatchingTier(item.productId, item.quantity);
          pricePerKg = tier
            ? parseFloat(tier.prix_per_kg)
            : parseFloat(product.price_per_kg ?? product.price);
        }
        unitPrice = pricePerKg;
        itemSubtotal = (item.quantity / 1000) * pricePerKg;
        lineUnit = 'g';
        lineDisplayUnit = item.displayUnit === 'kg' ? 'kg' : 'g';
      } else {
        unitPrice = channelOverride?.price_override
          ? parseFloat(channelOverride.price_override)
          : parseFloat(product.price);
        itemSubtotal = unitPrice * item.quantity;
      }
      // Arrondi à 2 décimales (centimes) pour éviter les écarts d'arrondi
      itemSubtotal = Math.round(itemSubtotal * 100) / 100;
      subtotal += itemSubtotal;
      saleItems.push({ productId: item.productId, quantity: item.quantity, unitPrice, subtotal: itemSubtotal, unit: lineUnit, displayUnit: lineDisplayUnit });
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

    // Paiement mixte (mig 250) : la ventilation especes/carte doit couvrir
    // exactement le total calcule cote serveur (tolerance centime d'arrondi).
    // Le total client peut differer (prix par canal, paliers) — on refuse
    // plutot que de stocker une ventilation incoherente.
    const isMixed = paymentStatus !== 'unpaid' && paymentMethod === 'mixed';
    if (isMixed) {
      const mixedSum = Math.round(((cashAmount ?? 0) + (cardAmount ?? 0)) * 100) / 100;
      const totalRounded = Math.round(total * 100) / 100;
      if (Math.abs(mixedSum - totalRounded) >= 0.01) {
        res.status(400).json({
          success: false,
          error: { message: `Ventilation mixte incoherente : especes + carte = ${mixedSum.toFixed(2)} DH, total = ${totalRounded.toFixed(2)} DH` },
        });
        return;
      }
    }

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
    // C6 — La session est en phase de comptage (close() appele mais submit()
    // pas encore). Toute vente ici gonflerait le tiroir sans etre comptee
    // dans expected_cash -> faux excedent. Refus explicite.
    if (activeSession.closing_started_at) {
      res.status(409).json({
        success: false,
        error: {
          code: 'SESSION_IN_CLOSING',
          message: 'Session en cours de fermeture — ventes bloquees jusqu\'a la validation du comptage.',
        },
      });
      return;
    }

    // Pour une vente impayee, on force payment_method='credit' jusqu'a l'encaissement
    // (le mode reel sera renseigne lors du pay).
    const effectivePaymentMethod = paymentStatus === 'unpaid' ? 'credit' : paymentMethod;

    // Attribution a un employe : selection explicite > dernier pointage actif du store > null.
    // Ce champ sert aux rapports CA/employe et au calcul de commission.
    let employeeId: string | null = explicitEmployeeId || null;
    if (!employeeId) {
      const active = await attendanceRepository.findLastActiveEmployee(req.user!.storeId);
      if (active) employeeId = active.id;
    }

    // Sachets : on accepte les champs s'ils sont fournis, on tolere leur absence
    // pour ne pas casser les anciens clients. Validation basique des types.
    const sg =
      typeof sachetsGiven === 'number' && Number.isFinite(sachetsGiven) && sachetsGiven >= 0
        ? Math.floor(sachetsGiven)
        : undefined;
    const ss =
      typeof sachetsSuggested === 'number' && Number.isFinite(sachetsSuggested) && sachetsSuggested >= 0
        ? Math.floor(sachetsSuggested)
        : undefined;
    const sr =
      typeof sachetReason === 'string' && sachetReason.trim().length > 0
        ? sachetReason.trim().slice(0, 40)
        : undefined;

    const sale = await saleRepository.create({
      customerId, userId: req.user!.userId,
      subtotal, taxAmount, discountAmount, total, paymentMethod: effectivePaymentMethod, notes, items: saleItems,
      sessionId: activeSession.id, storeId: req.user!.storeId,
      paymentStatus, unpaidCustomerName: unpaidCustomerName?.trim() || undefined,
      employeeId: employeeId || undefined,
      sachetsGiven: sg,
      sachetsSuggested: ss,
      sachetReason: sr,
      channelId,
      cashAmount: isMixed ? Math.round(cashAmount * 100) / 100 : undefined,
      cardAmount: isMixed ? Math.round(cardAmount * 100) / 100 : undefined,
    });

    res.status(201).json({ success: true, data: sale });
  },

  async pay(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { paymentMethod, paidAt } = req.body as { paymentMethod: string; paidAt?: string };

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

    // Date d'encaissement : par defaut maintenant. Si l'admin la precise (onglet
    // Impayes), on borne entre la date de creation de la vente et aujourd'hui —
    // on n'encaisse pas une vente avant qu'elle existe, ni dans le futur.
    let paidAtTs: string | undefined;
    if (paidAt) {
      const picked = new Date(`${paidAt}T12:00:00`);
      const created = new Date(existing.created_at);
      const now = new Date();
      if (Number.isNaN(picked.getTime())) {
        res.status(400).json({ success: false, error: { message: 'Date d\'encaissement invalide' } });
        return;
      }
      if (picked.getTime() > now.getTime()) {
        res.status(400).json({ success: false, error: { message: 'La date d\'encaissement ne peut pas etre dans le futur' } });
        return;
      }
      if (picked < new Date(created.toISOString().slice(0, 10) + 'T00:00:00')) {
        res.status(400).json({ success: false, error: { message: 'La date d\'encaissement ne peut pas preceder la date de la vente' } });
        return;
      }
      paidAtTs = picked.toISOString();
    }

    // L'encaissement peut etre fait sans caisse ouverte (admin qui solde un
    // impaye depuis l'onglet Impayes) : dans ce cas session_id reste null.
    const activeSession = await cashRegisterRepository.findOpenSession(req.user!.userId);

    const result = await saleRepository.markPaid(id, {
      paymentMethod,
      sessionId: activeSession?.id ?? null,
      paidAt: paidAtTs,
    });
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

  // Vente speciale B2B : back-office, prix unitaires negocies, pas de stock
  // vitrine deduit. Reserve a admin/manager (cf. route).
  async createSpecial(req: AuthRequest, res: Response) {
    const {
      customerId, items, paymentMethod,
      paymentStatus = 'paid', discountAmount = 0, notes, saleDate,
    } = req.body as {
      customerId: string;
      items: { productId: string; quantity: number; unitPrice: number }[];
      paymentMethod: string;
      paymentStatus?: 'paid' | 'unpaid';
      discountAmount?: number;
      notes?: string;
      saleDate?: string;
    };

    if (!req.user!.storeId && req.user!.role !== 'admin') {
      res.status(400).json({ success: false, error: { message: 'Utilisateur non rattache a un magasin' } });
      return;
    }

    // Calcul des subtotals avec les prix saisis (pas de fetch product.price).
    const enrichedItems = items.map(it => ({
      productId: it.productId,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      subtotal: Number((it.quantity * it.unitPrice).toFixed(2)),
      unit: 'unit' as const,
    }));
    const subtotal = Number(enrichedItems.reduce((sum, it) => sum + it.subtotal, 0).toFixed(2));

    if (discountAmount > subtotal) {
      res.status(400).json({ success: false, error: { message: 'Remise superieure au sous-total' } });
      return;
    }
    const total = Number((subtotal - discountAmount).toFixed(2));

    // Quand le statut est 'unpaid', la table sales force payment_method='credit'
    // (marqueur d'impaye). Le mode reel sera saisi au reglement (cf. /:id/pay).
    const effectivePaymentMethod = paymentStatus === 'unpaid' ? 'credit' : paymentMethod;

    // Si saleDate fournie : on stocke la vente datee a midi de ce jour
    // (evite les surprises de fuseau aux bornes minuit).
    const createdAt = saleDate ? new Date(`${saleDate}T12:00:00`).toISOString() : undefined;

    const sale = await saleRepository.create({
      customerId, userId: req.user!.userId,
      subtotal, taxAmount: 0, discountAmount, total,
      paymentMethod: effectivePaymentMethod,
      notes,
      storeId: req.user!.storeId,
      saleType: 'special',
      paymentStatus,
      skipStockDeduction: true,
      createdAt,
      items: enrichedItems,
    });
    res.status(201).json({ success: true, data: sale });
  },

  // Modification d'une vente speciale B2B : reservee a l'admin.
  async updateSpecial(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const {
      customerId, items, paymentMethod,
      paymentStatus = 'paid', discountAmount = 0, notes, saleDate,
    } = req.body as {
      customerId: string;
      items: { productId: string; quantity: number; unitPrice: number }[];
      paymentMethod: string;
      paymentStatus?: 'paid' | 'unpaid';
      discountAmount?: number;
      notes?: string;
      saleDate?: string;
    };

    const existing = await saleRepository.findById(id);
    if (!existing) {
      res.status(404).json({ success: false, error: { message: 'Vente non trouvee' } });
      return;
    }
    if (existing.store_id && req.user!.storeId && existing.store_id !== req.user!.storeId) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } });
      return;
    }

    const enrichedItems = items.map(it => ({
      productId: it.productId,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      subtotal: Number((it.quantity * it.unitPrice).toFixed(2)),
    }));
    const subtotal = Number(enrichedItems.reduce((sum, it) => sum + it.subtotal, 0).toFixed(2));

    if (discountAmount > subtotal) {
      res.status(400).json({ success: false, error: { message: 'Remise superieure au sous-total' } });
      return;
    }
    const total = Number((subtotal - discountAmount).toFixed(2));
    const createdAt = saleDate ? new Date(`${saleDate}T12:00:00`).toISOString() : undefined;

    const result = await saleRepository.updateSpecial(id, {
      customerId,
      subtotal, discountAmount, total,
      paymentMethod,
      paymentStatus,
      notes,
      createdAt,
      items: enrichedItems,
    });
    if (!result.ok) {
      if (result.reason === 'not_found') {
        res.status(404).json({ success: false, error: { message: 'Vente non trouvee' } });
        return;
      }
      if (result.reason === 'not_special') {
        res.status(400).json({ success: false, error: { message: 'Seules les ventes speciales B2B peuvent etre modifiees' } });
        return;
      }
    } else {
      res.json({ success: true, data: result.sale });
    }
  },

  // Suppression d'une vente speciale B2B : hard delete, admin seulement.
  async deleteSpecial(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const existing = await saleRepository.findById(id);
    if (!existing) {
      res.status(404).json({ success: false, error: { message: 'Vente non trouvee' } });
      return;
    }
    if (existing.store_id && req.user!.storeId && existing.store_id !== req.user!.storeId) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } });
      return;
    }

    const result = await saleRepository.deleteSpecial(id);
    if (!result.ok) {
      if (result.reason === 'not_found') {
        res.status(404).json({ success: false, error: { message: 'Vente non trouvee' } });
        return;
      }
      if (result.reason === 'not_special') {
        res.status(400).json({ success: false, error: { message: 'Seules les ventes speciales B2B peuvent etre supprimees' } });
        return;
      }
    } else {
      res.json({ success: true, data: null });
    }
  },

  async todayStats(req: AuthRequest, res: Response) {
    const stats = await saleRepository.todayStats(req.user!.storeId);
    res.json({ success: true, data: stats });
  },

  // Ventes a plus tard (impayees + reglees) pour l'onglet Impayes.
  async deferred(req: AuthRequest, res: Response) {
    if (!req.user!.storeId && req.user!.role !== 'admin') {
      res.status(403).json({ success: false, error: { message: 'Utilisateur non rattache a un magasin' } });
      return;
    }
    const rows = await saleRepository.findDeferred(req.user!.storeId);
    res.json({ success: true, data: rows });
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
