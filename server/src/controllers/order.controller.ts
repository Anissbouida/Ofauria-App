import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { orderRepository } from '../repositories/order.repository.js';
import { productRepository } from '../repositories/product.repository.js';
import { cashRegisterRepository } from '../repositories/cash-register.repository.js';
import { saleRepository } from '../repositories/sale.repository.js';
import { createNotification } from '../utils/notify.js';
import { paymentRepository, invoiceRepository } from '../repositories/accounting.repository.js';
import { getLocalNow } from '../utils/timezone.js';
import { deliveryNoteRepository } from '../repositories/delivery-note.repository.js';
import { db } from '../config/database.js';
import { FLAGS } from '../config/feature-flags.js';
import { fromAdvanceForfeit, persistEntry } from '../services/journal-generator.service.js';
import { postOrQueue } from '../services/ledger-posting.service.js';
import { evaluate as evaluatePromotions, recordApplied } from '../services/promotions.js';
import { checkCredit, customerExposure } from '../services/credit-control.js';
import { getParameter, type PricingRules } from '../services/module-parameters.service.js';

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


const DIRECTION_ROLES = ['admin', 'manager'];
const isDirection = (req: AuthRequest) =>
  [req.user!.role, ...((req.user as { baseRoles?: string[] }).baseRoles ?? [])].some(r => DIRECTION_ROLES.includes(r));
const round2 = (n: number) => Math.round(n * 100) / 100;
const fail = (res: Response, code: number, message: string) => { res.status(code).json({ success: false, error: { message } }); };

/**
 * Deux processus de commande (mig 354) :
 *   - particulier ou passager : la caisse prend la commande (avance facultative,
 *     non remboursable, comptée dans la session qui la prend) et la remet contre
 *     le solde intégral (compté dans la session qui la remet) ;
 *   - professionnel (fiche client non « particulier ») : la direction gère tout —
 *     prix catalogue moins la remise, TVA par ligne, ni avance ni caisse,
 *     livraison sur BL, facture selon le rythme du client.
 */
export async function loadCustomer(customerId?: string | null) {
  if (!customerId) return null;
  const r = await db.query(
    `SELECT id, customer_type, remise_pct, tva_exonere, credit_limit, billing_frequency FROM customers WHERE id = $1`, [customerId]);
  return r.rows[0] ?? null;
}
export const isProCustomer = (c: { customer_type?: string | null } | null) => !!c && (c.customer_type ?? 'particulier') !== 'particulier';

type InItem = { productId: string; quantity: number; unitPrice?: number | string | null; tvaRate?: number | string | null; notes?: string };
type OrderLine = { productId: string; quantity: number; unitPrice: number; subtotal: number; tvaRate: number | null; notes?: string;
  /** Prix grille au moment de la saisie et dérogation éventuelle (O2C L3, mig 443). */
  listPrice?: number; overrideBy?: string | null; overrideReason?: string | null };
/** Contexte de saisie : rôle et auteur pour les dérogations de prix (absent : pas de contrôle, ex. devis). */
export type PriorLine = { unitPrice: number; listPrice: number | null; overrideBy: string | null; overrideReason: string | null };
/** `prior` (modification) : lignes déjà en commande par produit — un prix inchangé n'est pas une nouvelle dérogation. */
export type PricingCtx = { role: string; userId: string; overrideReason?: string | null; prior?: Record<string, PriorLine> };

/**
 * Remise de commande en % (mig 355) : discountPct prioritaire, sinon ancien
 * montant discountAmount converti. Renvoie le taux et le montant arrondi.
 */
async function orderDiscount(body: Record<string, unknown>, subtotal: number, role: string): Promise<{ pct: number; amount: number } | { error: string }> {
  // Remise personnel : taux de la société, imposé par le serveur (plus seulement par l'écran).
  if (body.type === 'staff') {
    const staff = Number((await db.query(`SELECT staff_discount_percent FROM company_settings LIMIT 1`)).rows[0]?.staff_discount_percent ?? 10) || 10;
    return { pct: round2(staff), amount: round2(subtotal * staff / 100) };
  }
  const raw = body.discountPct;
  let pct: number;
  if (raw !== undefined && raw !== null && raw !== '') {
    pct = Number(raw);
  } else {
    const amount = parseFloat(String(body.discountAmount ?? 0)) || 0;
    pct = subtotal > 0 ? (amount / subtotal) * 100 : 0;
  }
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { error: 'Remise invalide : entre 0 et 100 %' };
  pct = round2(pct);
  // O2C L3 (G-OM-05) : remise bornée par rôle côté serveur.
  if (role !== 'admin' && pct > 0) {
    const rules = await getParameter<PricingRules>('sales.pricing');
    const max = role === 'manager' ? rules.max_discount_pct_manager : rules.max_discount_pct_sales;
    if (pct > max + 0.001) return { error: `Remise de ${pct} % au-delà de votre plafond (${max} %) : demandez à la direction` };
  }
  return { pct, amount: round2(subtotal * pct / 100) };
}

/**
 * Remise d'une commande ou d'un devis (mig 372) : promotions en vigueur d'abord, puis la
 * remise manuelle en % sur le reste. discount = promotions + remise manuelle.
 */
export async function documentDiscount(
  lines: OrderLine[], products: Record<string, any>[], subtotal: number, pct: number,
  ctx: { channel: 'orders' | 'quotes'; storeId?: string | null; customerId?: string | null },
) {
  const promo = await evaluatePromotions(lines.map((l, i) => ({
    productId: l.productId, categoryId: products[i]?.category_id ?? null, quantity: l.quantity, unit: 'unit' as const, unitPrice: l.unitPrice, subtotal: l.subtotal,
  })), ctx);
  const manual = round2((subtotal - promo.total) * pct / 100);
  return { promotionAmount: promo.total, applied: promo.applied, discount: round2(promo.total + manual) };
}

/** TVA d'un professionnel calculée sur le HT après remise de commande. */
export function taxAfterDiscount(lines: OrderLine[], subtotal: number, discountAmount: number) {
  const ratio = subtotal > 0 ? 1 - discountAmount / subtotal : 1;
  return round2(lines.reduce((s, l) => s + (l.tvaRate ? Math.round(l.subtotal * ratio * l.tvaRate) / 100 : 0), 0));
}

/**
 * Lignes chiffrées : prix saisi, sinon catalogue (particulier) ou catalogue remisé + dernière TVA
 * (professionnel). O2C L3 (G-OM-04) : le prix grille est figé sur la ligne ; avec un contexte de
 * saisie, un prix différent est une dérogation réservée à la direction, motivée, et au-delà de
 * l'écart paramétré réservée à l'administrateur.
 */
export async function priceLines(items: InItem[], pro: Record<string, unknown> | null, ctx?: PricingCtx) {
  const defaults = pro ? await deliveryNoteRepository.lineDefaults(pro.id as string, items.map(i => i.productId)) : {};
  const rules = ctx ? await getParameter<PricingRules>('sales.pricing') : null;
  const lines: OrderLine[] = [];
  const products: Record<string, unknown>[] = [];
  for (const item of items) {
    const product = await productRepository.findById(item.productId);
    if (!product) return { error: `Produit ${item.productId} non trouve` };
    const qty = Number(item.quantity);
    if (!(qty > 0)) return { error: 'Quantite invalide' };
    const given = item.unitPrice != null && item.unitPrice !== '' && Number.isFinite(parseFloat(String(item.unitPrice))) && parseFloat(String(item.unitPrice)) >= 0
      ? parseFloat(String(item.unitPrice)) : null;
    let listPrice = pro ? (defaults[item.productId]?.unitPrice ?? parseFloat(product.price)) : parseFloat(product.price);
    const unitPrice = given ?? listPrice;
    let overrideBy: string | null = null, overrideReason: string | null = null;
    const prior = ctx?.prior?.[item.productId];
    if (prior && Math.abs(unitPrice - prior.unitPrice) <= 0.005) {
      // Ligne reprise à l'identique : prix grille et dérogation d'origine conservés.
      listPrice = prior.listPrice ?? unitPrice; overrideBy = prior.overrideBy; overrideReason = prior.overrideReason;
    } else if (ctx && rules && Math.abs(unitPrice - listPrice) > 0.005) {
      if (ctx.role !== 'admin' && ctx.role !== 'manager') {
        return { error: `Prix de « ${product.name} » modifié (${unitPrice.toFixed(2)} au lieu de ${listPrice.toFixed(2)}) : réservé à la direction` };
      }
      const gap = listPrice > 0 ? Math.abs(unitPrice - listPrice) / listPrice * 100 : 100;
      if (ctx.role === 'manager' && gap > rules.max_price_override_pct + 0.001) {
        return { error: `Prix de « ${product.name} » à ${gap.toFixed(1)} % du prix grille : au-delà de ${rules.max_price_override_pct} %, réservé à l'administrateur` };
      }
      if (!ctx.overrideReason || ctx.overrideReason.trim().length < 3) {
        return { error: `Prix de « ${product.name} » différent du prix grille (${listPrice.toFixed(2)}) : indiquez le motif de la dérogation` };
      }
      overrideBy = ctx.userId; overrideReason = ctx.overrideReason.trim().slice(0, 300);
    }
    // Prix plancher (phase 6.4) : sous le plancher, réservé à la direction (admin).
    // S'applique à tout rôle non-admin ; sans rôle (devis), traité comme non privilégié.
    const floor = product.floor_price != null ? parseFloat(String(product.floor_price)) : null;
    if (floor != null && Number.isFinite(floor) && unitPrice < floor - 0.005 && ctx?.role !== 'admin') {
      return { error: `Prix de « ${product.name} » (${unitPrice.toFixed(2)}) sous le prix plancher (${floor.toFixed(2)}) : approbation de la direction requise` };
    }
    let tvaRate: number | null = null;
    if (pro) {
      const t = item.tvaRate != null && item.tvaRate !== '' ? Number(item.tvaRate) : defaults[item.productId]?.tvaRate ?? null;
      tvaRate = pro.tva_exonere ? 0 : (t != null && Number.isFinite(t) && t >= 0 ? t : null);
    }
    lines.push({ productId: item.productId, quantity: qty, unitPrice, subtotal: round2(unitPrice * qty), tvaRate, notes: item.notes,
      listPrice: round2(listPrice), overrideBy, overrideReason });
    products.push(product);
  }
  const subtotal = round2(lines.reduce((s, l) => s + l.subtotal, 0));
  return { lines, products, subtotal };
}

/**
 * Alerte plafond (non bloquante, non journalisée) : encours unique (fn_customer_exposure,
 * O2C L3 — tickets impayés, factures ouvertes, BL non facturés, reste des commandes) + cette commande.
 */
export async function creditWarning(customer: Record<string, unknown>, orderTotal: number, excludeOrderId?: string) {
  const limit = customer.credit_limit != null ? Number(customer.credit_limit) : 0;
  if (!(limit > 0)) return null;
  const outstanding = await customerExposure(db, customer.id as string, excludeOrderId ?? null);
  const exposure = round2(outstanding + orderTotal);
  if (exposure <= limit + 0.005) return null;
  return { creditLimit: limit, outstanding, exposure,
    message: `Plafond de crédit dépassé : ${exposure.toFixed(2)} DH engagés pour un plafond de ${limit.toFixed(2)} DH.` };
}

/** Prévient les chefs concernés quand une commande a déclenché un plan de production. */
export async function notifyProductionChefs(p: {
  productionPlanId: string; products: Record<string, unknown>[]; storeId?: string | null; orderNumber: string; pickupDate: string; userId: string;
}) {
  const rolesToNotify = new Set<string>();
  for (const product of p.products) {
    rolesToNotify.add((product.responsible_role as string) || getRoleForCategorySlug(product.category_slug as string | null));
  }
  for (const role of rolesToNotify) {
    await createNotification({
      targetRole: role,
      storeId: p.storeId ?? undefined,
      type: 'production_plan_created',
      title: 'Nouvelle demande de production',
      message: `Commande ${p.orderNumber} pour le ${p.pickupDate} — produits a produire`,
      referenceType: 'production_plan',
      referenceId: p.productionPlanId,
      createdBy: p.userId,
    });
  }
}

/**
 * Contrôle de crédit bloquant (mig 366) : client bloqué par une relance ou par la
 * direction → refus ; plafond dépassé → refus si le contrôle est « bloquant ».
 * Renvoie le motif du refus, ou null.
 */
export async function creditGate(customer: Record<string, unknown>, orderTotal: number, excludeOrderId?: string,
  checkpoint: 'create' | 'confirm' = 'create', documentType: 'order' | 'quote' = 'order', documentId: string | null = null): Promise<string | null> {
  // O2C L3 : encours unique et décision journalisée (credit_check_events).
  const d = await checkCredit(db, { customerId: customer.id as string, amount: orderTotal, checkpoint, documentType, documentId, excludeOrderId: excludeOrderId ?? null });
  if (d.decision !== 'block') return null;
  return d.onHold
    ? `${d.message} Débloquez-le dans Ventes › Relances ou faites régler comptant.`
    : `${d.message} Commande refusée (contrôle du plafond bloquant).`;
}

export const orderController = {
  async list(req: AuthRequest, res: Response) {
    const { status, type, customerId, page = '1', limit = '20' } = req.query as Record<string, string>;
    const p = parseInt(page); const l = parseInt(limit);
    const result = await orderRepository.findAll({
      status, type, customerId, storeId: req.user!.storeId, limit: l, offset: (p - 1) * l,
      // Les commandes de professionnels sont l'affaire de la direction : la caisse ne les voit pas.
      hidePro: !isDirection(req),
    });
    res.json({ success: true, data: result.rows, total: result.total, page: p, limit: l, totalPages: Math.ceil(result.total / l) });
  },

  async getById(req: AuthRequest, res: Response) {
    const order = await orderRepository.findById(req.params.id);
    if (!order) { res.status(404).json({ success: false, error: { message: 'Commande non trouvee' } }); return; }
    if (req.user!.storeId && order.store_id && order.store_id !== req.user!.storeId) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } }); return;
    }
    if (isProCustomer(order) && !isDirection(req)) { fail(res, 403, 'Commande de professionnel : réservée à la direction'); return; }
    const reschedules = (await db.query(
      `SELECT r.*, concat_ws(' ', u.first_name, u.last_name) AS created_by_name FROM order_reschedules r
         LEFT JOIN users u ON u.id = r.created_by WHERE r.order_id = $1 ORDER BY r.created_at`, [order.id])).rows;
    res.json({ success: true, data: { ...order, reschedules } });
  },

  async create(req: AuthRequest, res: Response) {
    const { customerId, customerName, customerPhone, type, items, notes, pickupDate, orderDate } = req.body;
    let { paymentMethod } = req.body;

    // Walk-in clients: store name/phone on order directly, no customer record
    // Known clients: customerId is provided by the frontend
    if (!customerId && !customerName) { fail(res, 400, 'Le nom du client est requis'); return; }
    if (!pickupDate) { fail(res, 400, 'Une date de retrait est requise'); return; }
    if (!Array.isArray(items) || items.length === 0) { fail(res, 400, 'Ajoutez au moins un produit'); return; }

    const customer = await loadCustomer(customerId);
    if (customerId && !customer) { fail(res, 400, 'Client introuvable'); return; }
    const pro = isProCustomer(customer) ? customer : null;
    if (pro && !isDirection(req)) { fail(res, 403, 'Les commandes de professionnels sont prises par la direction'); return; }

    const priced = await priceLines(items, pro, { role: req.user!.role, userId: req.user!.userId, overrideReason: req.body.priceOverrideReason ?? null });
    if ('error' in priced) { fail(res, 400, priced.error as string); return; }
    const { lines: orderItems, products, subtotal } = priced;
    const disc = await orderDiscount(req.body, subtotal, req.user!.role);
    if ('error' in disc) { fail(res, 400, disc.error); return; }
    const promo = await documentDiscount(orderItems, products as Record<string, any>[], subtotal, disc.pct, { channel: 'orders', storeId: req.user!.storeId, customerId: customerId || null });
    const discountAmount = promo.discount, discountPct = disc.pct;
    const taxAmount = taxAfterDiscount(orderItems, subtotal, discountAmount);
    const total = round2(subtotal - discountAmount + taxAmount);
    if (total < 0) { fail(res, 400, 'Remise supérieure au montant de la commande'); return; }
    if (pro) {
      const refused = await creditGate(pro, total);
      if (refused) { fail(res, 409, refused); return; }
    }

    // Professionnel : ni avance ni caisse, réglé sur facture par la direction.
    // Particulier : jamais de paiement reporté, l'avance (facultative) est encaissée maintenant.
    const advance = pro ? 0 : round2(parseFloat(String(req.body.advanceAmount ?? 0)) || 0);
    if (pro) {
      paymentMethod = 'deferred';
    } else {
      if (paymentMethod === 'deferred' || req.body.deferPayment) {
        fail(res, 400, 'Un particulier ne peut pas régler plus tard : avance facultative à la commande, solde intégral au retrait'); return;
      }
      paymentMethod = paymentMethod || 'cash';
    }
    // F-040 : l'avance ne peut etre ni negative ni superieure au total.
    if (advance < 0) { fail(res, 400, 'Avance invalide (négative).'); return; }
    if (advance > total + 0.005) {
      fail(res, 400, `Avance (${advance.toFixed(2)} DH) supérieure au total de la commande (${total.toFixed(2)} DH).`); return;
    }

    // L'avance est comptée dans la session de la caissière qui prend la commande.
    const activeSession = pro ? null : await cashRegisterRepository.findOpenSession(req.user!.userId);
    if (advance > 0 && !activeSession) { fail(res, 400, 'Ouvrez la caisse pour encaisser l\'avance'); return; }

    const orderNumber = await orderRepository.generateOrderNumber();
    // O2C L3 (G-OM-07) : commande, promotion et ticket d'avance dans UNE transaction — plus de
    // commande enregistrée sans son avance (ou l'inverse) si l'une des écritures échoue.
    const client = await db.getClient();
    let order: Record<string, any>;
    let advanceReceipt = null;
    try {
      await client.query('BEGIN');
      order = await orderRepository.create({
        orderNumber, customerId, customerName, customerPhone,
        userId: req.user!.userId, type: type || 'custom',
        subtotal, taxAmount, discountAmount, discountPct, total, advanceAmount: advance, paymentMethod, notes, pickupDate, orderDate, items: orderItems,
        sessionId: activeSession?.id, storeId: req.user!.storeId, channelId: req.body.channelId ?? null,
      }, client);
      if (promo.applied.length) {
        await client.query(`UPDATE orders SET promotion_amount = $2 WHERE id = $1`, [order.id, promo.promotionAmount]);
        await recordApplied(client, { orderId: order.id }, promo.applied);
      }

      // Ticket d'avance : il apparaît dans la caisse et les ventes du jour.
      if (advance > 0 && activeSession) {
        await saleRepository.create({
          customerId: customerId || undefined,
          userId: req.user!.userId,
          subtotal: advance,
          taxAmount: 0,
          discountAmount: 0,
          total: advance,
          paymentMethod,
          notes: `Avance commande ${orderNumber} — Total: ${total.toFixed(2)} DH, Reste: ${(total - advance).toFixed(2)} DH`,
          sessionId: activeSession.id,
          storeId: req.user!.storeId,
          orderId: order.id,
          saleType: 'advance',
          channelId: order.channel_id ?? null,
          skipStockDeduction: true, // stock is deducted at delivery
          items: orderItems.map(it => ({
            productId: it.productId,
            quantity: 0, // zero qty = no stock impact, items listed for reference only
            unitPrice: it.unitPrice,
            subtotal: 0,
          })),
        }, client);
        advanceReceipt = {
          orderNumber,
          advanceAmount: advance,
          total,
          remaining: round2(total - advance),
          paymentMethod,
          date: getLocalNow().toISOString(),
        };
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    const warning = pro ? await creditWarning(pro, total, order.id) : null;

    // Sourcing automatique : orderRepository.create a deja calcule
    // qty_from_stock vs qty_to_produce et cree un plan de production
    // UNIQUEMENT pour les produits manquants (memes regles que DRA).
    // Si _productionPlanId est present → notifier les chefs concernes.
    const productionPlanId = (order as Record<string, unknown>)._productionPlanId as string | null;

    if (productionPlanId) {
      await notifyProductionChefs({ productionPlanId, products, storeId: req.user!.storeId, orderNumber, pickupDate, userId: req.user!.userId });
    }

    res.status(201).json({ success: true, data: { ...order, advanceReceipt, creditWarning: warning, items: orderItems } });
  },

  async update(req: AuthRequest, res: Response) {
    const { customerId, customerName, customerPhone, type, items, notes, pickupDate } = req.body;
    const existing = await orderRepository.findById(req.params.id);
    if (!existing) { fail(res, 404, 'Commande non trouvee'); return; }
    if (!Array.isArray(items) || items.length === 0) { fail(res, 400, 'Ajoutez au moins un produit'); return; }
    // O2C L0 (G-IV-03) : une commande déjà facturée ne se modifie plus (la facture est figée) ;
    // on corrige la facture par son annulation (avoir) avant de modifier la commande.
    const linkedInvoice = await invoiceRepository.findEmittedByOrderId(req.params.id);
    if (linkedInvoice && linkedInvoice.status !== 'cancelled') {
      fail(res, 409, `Commande facturée (${linkedInvoice.invoice_number}) : annulez d'abord la facture pour la modifier`); return;
    }

    const customer = await loadCustomer(customerId);
    if (customerId && !customer) { fail(res, 400, 'Client introuvable'); return; }
    const pro = isProCustomer(customer) ? customer : null;
    if ((pro || isProCustomer(existing)) && !isDirection(req)) { fail(res, 403, 'Les commandes de professionnels sont gérées par la direction'); return; }

    // L'avance a été encaissée à la prise de commande : elle ne se modifie pas ici.
    const advance = parseFloat(existing.advance_amount) || 0;
    if (pro && advance > 0) { fail(res, 400, 'Cette commande a une avance encaissée en caisse : elle reste une commande de particulier'); return; }
    // Si la date change, passer par le report (règle des 24 h, journal).
    if (pickupDate && existing.pickup_date && new Date(pickupDate).getTime() !== new Date(existing.pickup_date).getTime()) {
      fail(res, 400, 'Pour changer la date de retrait, utilisez « Reporter »'); return;
    }

    // Lignes déjà en commande : un prix inchangé garde son prix grille et sa dérogation d'origine.
    const prior: Record<string, PriorLine> = {};
    for (const r of (await db.query(
      `SELECT product_id, unit_price, list_price, price_override_by, price_override_reason FROM order_items WHERE order_id = $1`, [req.params.id])).rows) {
      prior[r.product_id] = { unitPrice: Number(r.unit_price), listPrice: r.list_price != null ? Number(r.list_price) : null,
        overrideBy: r.price_override_by, overrideReason: r.price_override_reason };
    }
    const priced = await priceLines(items, pro, { role: req.user!.role, userId: req.user!.userId, overrideReason: req.body.priceOverrideReason ?? null, prior });
    if ('error' in priced) { fail(res, 400, priced.error as string); return; }
    const { lines: orderItems, products: updProducts, subtotal } = priced;
    const disc = await orderDiscount({ ...req.body, type: req.body.type ?? existing.type }, subtotal, req.user!.role);
    if ('error' in disc) { fail(res, 400, disc.error); return; }
    const promo = await documentDiscount(orderItems, updProducts as Record<string, any>[], subtotal, disc.pct, { channel: 'orders', storeId: existing.store_id ?? req.user!.storeId, customerId: customerId || null });
    const discountAmount = promo.discount, discountPct = disc.pct;
    const taxAmount = taxAfterDiscount(orderItems, subtotal, discountAmount);
    const total = round2(subtotal - discountAmount + taxAmount);
    if (total + 0.005 < advance) { fail(res, 400, `Le total (${total.toFixed(2)} DH) ne peut pas descendre sous l'avance encaissée (${advance.toFixed(2)} DH)`); return; }
    const paymentMethod = pro ? 'deferred' : (existing.payment_method === 'deferred' ? 'cash' : existing.payment_method);

    const order = await orderRepository.update(req.params.id, {
      customerId, customerName, customerPhone, type, subtotal, taxAmount, discountAmount, discountPct, total, advanceAmount: advance,
      paymentMethod, notes, items: orderItems,
    });

    if (!order) { fail(res, 400, 'Commande non modifiable (livree ou annulee)'); return; }
    await db.query(`UPDATE orders SET promotion_amount = $2 WHERE id = $1`, [req.params.id, promo.promotionAmount]);
    await recordApplied(db, { orderId: req.params.id }, promo.applied, false);

    const warning = pro ? await creditWarning(pro, total, order.id) : null;
    res.json({ success: true, data: { ...order, creditWarning: warning } });
  },

  async updateStatus(req: AuthRequest, res: Response) {
    const { status, reason } = req.body as { status: string; reason?: string };
    const allowed = ['pending', 'confirmed', 'in_production', 'ready', 'cancelled'];
    if (!allowed.includes(status)) {
      fail(res, 400, status === 'completed'
        ? 'Une commande se termine par sa remise (encaissement du solde) ou par son bon de livraison'
        : 'Statut invalide'); return;
    }
    const current = await orderRepository.findById(req.params.id);
    if (!current) { fail(res, 404, 'Commande non trouvee'); return; }
    if (current.status === 'completed' || current.status === 'cancelled') { fail(res, 409, 'Commande déjà terminée ou annulée'); return; }
    if (current.status === 'partially_delivered') { fail(res, 409, 'Commande partiellement livrée : livrez le reste ou soldez le reliquat'); return; }
    if (isProCustomer(current) && !isDirection(req)) { fail(res, 403, 'Les commandes de professionnels sont gérées par la direction'); return; }
    // O2C L3 (G-CR-02) : contrôle de crédit à la confirmation (la commande figure déjà dans l'encours).
    if (status === 'confirmed' && isProCustomer(current) && current.customer_id) {
      const customer = await loadCustomer(current.customer_id);
      const refused = customer ? await creditGate(customer, 0, undefined, 'confirm', 'order', req.params.id) : null;
      if (refused) { fail(res, 409, refused); return; }
    }

    // Annulation ou absence au retrait : l'avance d'un particulier reste acquise (rien n'est remboursé).
    const order = await orderRepository.updateStatus(req.params.id, status,
      status === 'cancelled' ? { userId: req.user!.userId, reason: reason?.trim() || null } : undefined);
    if (!order) { fail(res, 404, 'Commande non trouvee'); return; }

    // O2C L6 (G-RR-01) : l'avance (4421) d'une commande annulée devient un produit acquis.
    if (status === 'cancelled' && FLAGS.LEDGER_AUTOGEN && Number(current.advance_amount ?? 0) > 0) {
      const c = await db.getClient();
      try {
        await c.query('BEGIN');
        await postOrQueue(c, { kind: 'advance_forfeit', id: req.params.id }, async () => {
          const day = (await c.query(`SELECT (now() AT TIME ZONE 'Africa/Casablanca')::date::text AS d`)).rows[0].d;
          const entry = await fromAdvanceForfeit(c, req.params.id, day);
          if (entry) await persistEntry(c, entry, { userId: req.user!.userId });
        });
        await c.query('COMMIT');
      } catch (err) {
        await c.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        c.release();
      }
    }

    // Note : a la creation de la commande, orderRepository.create a deja fait
    // le sourcing (stock vs production) et cree le plan UNIQUEMENT si
    // qty_to_produce > 0. Ce handler ne re-cree donc PAS de plan ici.

    // Notify cashier/saleswoman when order is ready for pickup
    if (status === 'ready') {
      const roles = isProCustomer(current) ? ['manager', 'admin'] : ['cashier', 'saleswoman', 'manager'];
      for (const role of roles) {
        await createNotification({
          targetRole: role,
          storeId: req.user!.storeId,
          type: 'order_ready',
          title: 'Commande prete',
          message: isProCustomer(current)
            ? `La commande ${order.order_number} est prete a livrer`
            : `La commande ${order.order_number} est prete pour le retrait`,
          referenceType: 'order',
          referenceId: req.params.id,
          createdBy: req.user!.userId,
        });
      }
    }

    res.json({ success: true, data: order });
  },

  /**
   * Report de la date de retrait (mig 354). Le client appelle au moins 24 h
   * avant le retrait prévu : report libre. À moins de 24 h, seule la direction
   * peut forcer le report, avec un motif.
   */
  async reschedule(req: AuthRequest, res: Response) {
    const { newPickupDate, reason } = req.body as { newPickupDate?: string; reason?: string };
    if (!newPickupDate || Number.isNaN(new Date(newPickupDate).getTime())) { fail(res, 400, 'Nouvelle date de retrait requise'); return; }
    const order = await orderRepository.findById(req.params.id);
    if (!order) { fail(res, 404, 'Commande non trouvee'); return; }
    if (order.status === 'completed' || order.status === 'cancelled') { fail(res, 409, 'Commande déjà terminée ou annulée'); return; }
    if (isProCustomer(order) && !isDirection(req)) { fail(res, 403, 'Les commandes de professionnels sont gérées par la direction'); return; }
    const now = Date.now();
    if (new Date(newPickupDate).getTime() <= now) { fail(res, 400, 'La nouvelle date doit être dans le futur'); return; }
    const hoursLeft = order.pickup_date ? (new Date(order.pickup_date).getTime() - now) / 3_600_000 : Infinity;
    const forced = hoursLeft < 24;
    if (forced && !isDirection(req)) {
      fail(res, 403, 'Moins de 24 h avant le retrait : seule la direction peut reporter la commande'); return;
    }
    if (forced && !reason?.trim()) { fail(res, 400, 'Motif obligatoire pour un report à moins de 24 h du retrait'); return; }
    const updated = await orderRepository.reschedule(order.id, {
      newPickupDate, reason: reason?.trim() || null, forced, userId: req.user!.userId,
    });
    res.json({ success: true, data: { ...updated, forced } });
  },

  /**
   * Remise d'une commande de particulier en caisse : le reste (total − avance)
   * est encaissé en entier, dans la session de la caissière qui remet la
   * commande. Sans solde intégral, pas de remise. Un professionnel se livre
   * sur bon de livraison (direction), jamais en caisse.
   */
  async deliver(req: AuthRequest, res: Response) {
    const { amountPaid, paymentMethod = 'cash' } = req.body;
    const orderId = req.params.id;

    const order = await orderRepository.findById(orderId);
    if (!order) { fail(res, 404, 'Commande non trouvee'); return; }
    if (isProCustomer(order)) {
      fail(res, 409, 'Commande de professionnel : elle se livre sur bon de livraison par la direction, sans encaissement en caisse'); return;
    }
    if (order.status !== 'ready') { fail(res, 400, 'La commande doit etre prete pour etre livree'); return; }
    if (paymentMethod === 'deferred') { fail(res, 400, 'Le solde doit être réglé au retrait'); return; }

    // Require an open cash register session
    const activeSession = await cashRegisterRepository.findOpenSession(req.user!.userId);
    if (!activeSession) { fail(res, 400, 'Vous devez ouvrir la caisse avant de livrer une commande'); return; }

    const total = parseFloat(order.total);
    const advanceAmount = parseFloat(order.advance_amount) || 0;
    const remaining = round2(Math.max(0, total - advanceAmount));
    const paid = round2(parseFloat(amountPaid) || 0);
    if (paid + 0.005 < remaining) {
      fail(res, 400, `Le client doit régler l'intégralité du reste (${remaining.toFixed(2)} DH) pour retirer sa commande`); return;
    }

    // Vente du RESTE uniquement : l'avance a deja ete comptee le jour de la commande.
    const saleItems = order.items.map((item: Record<string, unknown>) => ({
      productId: item.product_id as string,
      quantity: item.quantity as number,
      unitPrice: parseFloat(item.unit_price as string),
      subtotal: parseFloat(item.subtotal as string),
    }));
    const hasAdvance = advanceAmount > 0;

    // Le sous-total de la vente de remise est ramene au reste (+ remise) : l'avance
    // a deja ete comptabilisee le jour de la commande, l'ecriture reste equilibree.
    const discount = parseFloat(order.discount_amount) || 0;
    const tax = parseFloat(order.tax_amount) || 0;
    await saleRepository.create({
      customerId: order.customer_id,
      userId: req.user!.userId,
      subtotal: round2(remaining + discount - tax),
      taxAmount: tax,
      discountAmount: discount,
      total: remaining,
      paymentMethod,
      notes: hasAdvance
        ? `Livraison commande ${order.order_number} — Reste apres avance de ${advanceAmount.toFixed(2)} DH`
        : `Livraison commande ${order.order_number}`,
      sessionId: activeSession.id,
      storeId: req.user!.storeId,
      items: saleItems,
      orderId,
      saleType: hasAdvance ? 'delivery' : 'standard',
      advanceAmount: hasAdvance ? advanceAmount : 0,
      advanceDate: hasAdvance ? order.created_at : null,
      completeOrder: true,
      channelId: order.channel_id ?? null,
    });

    res.json({ success: true, data: { remaining, paid, change: round2(paid - remaining), orderNumber: order.order_number } });
  },

  async remove(req: AuthRequest, res: Response) {
    try {
      const result = await orderRepository.delete(req.params.id);
      if (!result.deleted) {
        if (result.reason === 'not_found') {
          res.status(404).json({ success: false, error: { message: 'Commande non trouvee' } });
          return;
        }
        res.status(409).json({ success: false, error: { message: 'Seules les commandes annulees peuvent etre supprimees' } });
        return;
      }
      res.json({ success: true, data: null });
    } catch (err: unknown) {
      // FK violation: a facture (or other dependent record) references this order
      if ((err as { code?: string }).code === '23503') {
        res.status(409).json({ success: false, error: { message: 'Impossible de supprimer cette commande (facture liee)' } });
        return;
      }
      throw err;
    }
  },

  // Get pending orders for a specific date (for production planning)
  async forDate(req: AuthRequest, res: Response) {
    const { date } = req.query as Record<string, string>;
    if (!date) { res.status(400).json({ success: false, error: { message: 'Date requise' } }); return; }
    const orders = await orderRepository.findByPickupDate(date, req.user!.storeId);
    res.json({ success: true, data: orders });
  },

  // Facture d'acompte (phase 5.4) — direction : émet une pièce d'acompte (série FA)
  // sur la commande, reprise ensuite sur la facture finale.
  async prepaymentInvoice(req: AuthRequest, res: Response) {
    const { percent, amount } = req.body as { percent?: number; amount?: number };
    if (percent == null && amount == null) { fail(res, 400, 'Indiquez un pourcentage ou un montant d\'acompte'); return; }
    try {
      const inv = await invoiceRepository.createOrderPrepayment(
        req.params.id,
        { percent: percent != null ? Number(percent) : undefined, amount: amount != null ? Number(amount) : undefined },
        req.user!.userId
      );
      res.status(201).json({ success: true, data: inv });
    } catch (e) {
      fail(res, (e as { statusCode?: number }).statusCode ?? 400, (e as Error).message);
    }
  },
};
