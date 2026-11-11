import type { Response } from 'express';
import { receivablesRepository } from '../repositories/receivables.repository.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { db } from '../config/database.js';
import { saleRepository } from '../repositories/sale.repository.js';
import { productRepository } from '../repositories/product.repository.js';
import { posLinePrice } from '../services/pos-pricing.js';
import { evaluate as evaluatePromotions, type PromoLine } from '../services/promotions.js';
import { checkRedeem } from '../services/loyalty.js';
import { posAllowsNegativeStock } from '../services/module-parameters.service.js';
import { salesChannelRepository } from '../repositories/sales-channel.repository.js';
import { cashRegisterRepository } from '../repositories/cash-register.repository.js';
import { getVitrineStock } from '../repositories/product-stock.helper.js';
import { attendanceRepository } from '../repositories/employee.repository.js';
import { dunningRepository } from '../repositories/dunning.repository.js';
import { taxCodeRepository } from '../repositories/tax-code.repository.js';
import { invoiceRepository } from '../repositories/accounting.repository.js';
import { netFromGross, round2 } from '../utils/tva.js';

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
      couponCode, loyaltyPoints = 0,
    } = req.body;

    // Paiement reporte = creance d'un client identifie (mig 351, « Compte client ») :
    // une fiche client est obligatoire, un nom libre ne permet ni suivi ni relance.
    if (paymentStatus === 'unpaid' && !customerId) {
      res.status(400).json({ success: false, error: { message: 'Choisissez ou créez la fiche du client : une vente à plus tard est portée sur son compte' } });
      return;
    }

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

    // Caisse : produits sans stock vendables selon le paramètre (mig 374).
    const sellWithoutStock = await posAllowsNegativeStock();
    const saleItems: { productId: string; quantity: number; unitPrice: number; subtotal: number; unit: 'unit' | 'g' | 'person'; displayUnit: 'g' | 'kg' | null; promoDiscount: number; taxCode: string | null; taxRate: number; taxAmount: number }[] = [];
    const promoLines: PromoLine[] = [];
    let subtotal = 0;
    for (const item of items) {
      const product = await productRepository.findById(item.productId);
      if (!product) {
        res.status(400).json({ success: false, error: { message: `Produit ${item.productId} non trouve` } });
        return;
      }

      // F-026 : la quantite est toujours entiere — des pieces pour un produit
      // unitaire, des grammes pour un produit au poids (sale_items.quantity est
      // un INTEGER). Un decimal (ex. 1,5 piece) faisait echouer l'INSERT cote
      // Postgres (22P02) et, sans asyncHandler, laissait la requete pendante.
      // On refuse proprement en 400 avant d'atteindre la base.
      if (!Number.isInteger(item.quantity)) {
        const unitLabel = product.sale_unit === 'weight' ? 'grammes' : product.sale_unit === 'person' ? 'personnes' : 'pièces';
        res.status(400).json({
          success: false,
          error: { message: `Quantité invalide pour "${product.name}" : un nombre entier de ${unitLabel} est requis.` },
        });
        return;
      }

      // Verify sufficient stock in the vitrine before selling.
      // Pour les produits au poids, item.quantity = poids vendu en grammes
      // et currentStock = grammes restants en vitrine (stock géré en grammes).
      // Entremets par personne : assemblés à la commande, quantity = nombre de
      // personnes (pas des pièces de vitrine) — on n'applique pas le stock vitrine.
      const currentStock = await getVitrineStock(item.productId, req.user!.storeId);
      if (currentStock < item.quantity && !sellWithoutStock && product.sale_unit !== 'person') {
        const unitLabel = product.sale_unit === 'weight' ? 'g' : product.sale_unit === 'person' ? 'pers' : 'pièces';
        res.status(400).json({
          success: false,
          error: { message: `Stock vitrine insuffisant pour "${product.name}" — disponible: ${currentStock} ${unitLabel}, demande: ${item.quantity} ${unitLabel}. Faire une demande d'approvisionnement.` },
        });
        return;
      }

      // Liste de prix (phase 6), prix du canal, palier au poids ou catalogue (services/pos-pricing.ts).
      const priced = await posLinePrice(product, item.quantity, channelId, customerId || null);
      const unitPrice = priced.unitPrice;
      const itemSubtotal = priced.subtotal;
      const lineUnit = priced.unit;
      // Unité d'affichage du recu : memorise le toggle g/kg du caissier pour
      // les ventes au poids. NULL pour les produits unitaires.
      const lineDisplayUnit: 'g' | 'kg' | null = lineUnit === 'g' ? (item.displayUnit === 'kg' ? 'kg' : 'g') : null;
      subtotal += itemSubtotal;
      saleItems.push({ productId: item.productId, quantity: item.quantity, unitPrice, subtotal: itemSubtotal, unit: lineUnit, displayUnit: lineDisplayUnit, promoDiscount: 0, taxCode: product.tax_code ?? null, taxRate: 0, taxAmount: 0 });
      promoLines.push({ productId: item.productId, categoryId: product.category_id ?? null, quantity: item.quantity, unit: lineUnit, unitPrice, subtotal: itemSubtotal });
    }

    // Phase 5.2 (mig 480) — TVA au comptoir par article. Le prix de caisse est le
    // prix payé (TTC) ; la TVA y est *incluse*, elle ne s'ajoute pas. Pour chaque
    // ligne, on dérive la TVA contenue au taux du code TVA de l'article (mig 473) :
    // TVA = TTC - TTC/(1+taux). Article sans code TVA (cas Ofauria) → taux 0 →
    // TVA 0 : le total encaissé est strictement inchangé.
    const rateCache = new Map<string, number>();
    let taxAmount = 0;
    for (const li of saleItems) {
      if (!li.taxCode) continue;
      let rate = rateCache.get(li.taxCode);
      if (rate === undefined) {
        rate = (await taxCodeRepository.rateFor(li.taxCode)) ?? 0;
        rateCache.set(li.taxCode, rate);
      }
      if (rate <= 0) continue;
      li.taxRate = rate;
      li.taxAmount = round2(li.subtotal - netFromGross(li.subtotal, rate));
      taxAmount = round2(taxAmount + li.taxAmount);
    }

    // Promotions (mig 372) : recalculées ici, l'aperçu de la caisse n'est qu'indicatif.
    const promo = await evaluatePromotions(promoLines, { channel: 'pos', storeId: req.user!.storeId, customerId: customerId || null, couponCode: couponCode || null });
    if (promo.coupon && (promo.coupon.status === 'invalid' || promo.coupon.status === 'not_applicable')) {
      res.status(400).json({ success: false, error: { message: `${promo.coupon.message} (${promo.coupon.code})` } });
      return;
    }
    promo.lines.forEach((l, i) => { saleItems[i].promoDiscount = l.discount; });
    const promotionAmount = promo.total;

    // Defense metier : la remise ne doit jamais depasser le sous-total (OWASP A04-4).
    // Le schema Zod borne deja discountAmount a [0, 999999.99] et coerce le type.
    // discountAmount = remise manuelle du caissier, en plus des promotions.
    if (discountAmount > Math.round((subtotal - promotionAmount) * 100) / 100 + 0.001) {
      res.status(400).json({
        success: false,
        error: { message: `Remise (${discountAmount}) superieure au montant apres promotions (${(subtotal - promotionAmount).toFixed(2)})` },
      });
      return;
    }

    // Points de fidélité utilisés : une remise payée par la dette de fidélité.
    let loyaltyAmount = 0;
    if (loyaltyPoints > 0) {
      if (!customerId) { res.status(400).json({ success: false, error: { message: 'Choisissez le client pour utiliser ses points' } }); return; }
      const r = await checkRedeem(db, customerId, loyaltyPoints, Math.round((subtotal - promotionAmount - discountAmount) * 100) / 100);
      if ('error' in r) { res.status(400).json({ success: false, error: { message: r.error } }); return; }
      loyaltyAmount = r.amount;
    }

    // taxAmount n'entre pas dans le total : c'est la TVA *incluse* dans le prix TTC
    // encaissé (ventilation, phase 5.2), pas un montant ajouté.
    const total = Math.round((subtotal - promotionAmount - discountAmount - loyaltyAmount) * 100) / 100;

    // Vente à crédit (mig 366) : refusée pour un client bloqué, ou au-delà du plafond si le contrôle est bloquant.
    if (paymentStatus === 'unpaid' && customerId) {
      const credit = await dunningRepository.creditCheck(customerId, Math.round(total * 100) / 100);
      if (credit.blocked) { res.status(409).json({ success: false, error: { message: credit.blocked } }); return; }
    }

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
      subtotal, taxAmount, discountAmount: Math.round((discountAmount + promotionAmount + loyaltyAmount) * 100) / 100, total,
      paymentMethod: effectivePaymentMethod, notes, items: saleItems,
      promotionAmount, appliedPromotions: promo.applied, couponCode: promo.coupon?.status === 'applied' ? promo.coupon.code.toUpperCase() : null,
      loyaltyPointsUsed: loyaltyAmount > 0 ? loyaltyPoints : 0, loyaltyAmount,
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
      userId: req.user!.userId,
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

  /**
   * Retiré (O2C L4, G-OM-01) : la vente spéciale B2B contournait commande, BL et
   * facture. Une vente à un professionnel passe par la commande (ou le BL direct)
   * puis la facture sur livré. Les ventes spéciales passées restent consultables.
   */
  async specialRetired(_req: AuthRequest, res: Response) {
    res.status(410).json({ success: false, error: { message:
      'La vente spéciale est retirée : saisissez une commande professionnelle ou un bon de livraison (Ventes pro), la facture suit la livraison.' } });
  },

  async todayStats(req: AuthRequest, res: Response) {
    const stats = await saleRepository.todayStats(req.user!.storeId);
    res.json({ success: true, data: stats });
  },

  /** Créances clients (mig 351) : balance âgée, tickets impayés + factures clients ouvertes. */
  async receivables(req: AuthRequest, res: Response) {
    if (!req.user!.storeId && req.user!.role !== 'admin') {
      res.status(403).json({ success: false, error: { message: 'Utilisateur non rattache a un magasin' } });
      return;
    }
    res.json({ success: true, data: await receivablesRepository.agedBalance(req.user!.storeId) });
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

  /**
   * Facture depuis un ticket de caisse (phase 5.5) : un client demande sa facture
   * après l'achat au comptoir. La vente est déjà comptabilisée ; on émet la pièce
   * légale (série continue) sans recompter. `customerId` facultatif si le ticket
   * est anonyme.
   */
  async invoice(req: AuthRequest, res: Response) {
    const sale = await saleRepository.findById(req.params.id);
    if (!sale) { res.status(404).json({ success: false, error: { message: 'Vente non trouvee' } }); return; }
    const userStoreId = req.user!.storeId;
    if (!userStoreId && req.user!.role !== 'admin') {
      res.status(403).json({ success: false, error: { message: 'Utilisateur non rattache a un magasin' } }); return;
    }
    if (userStoreId && sale.store_id && sale.store_id !== userStoreId) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } }); return;
    }
    const { customerId } = req.body as { customerId?: string };
    try {
      const inv = await invoiceRepository.createFromSale(
        req.params.id, customerId || undefined, req.user!.userId);
      res.status(201).json({ success: true, data: inv });
    } catch (e) {
      res.status((e as { statusCode?: number }).statusCode ?? 400).json({ success: false, error: { message: (e as Error).message } });
    }
  },
};
