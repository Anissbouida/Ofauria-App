import { db } from '../config/database.js';
import { orderRepository } from '../repositories/order.repository.js';
import { webhookRepository } from '../repositories/webhook.repository.js';
import { deliveryNoteRepository } from '../repositories/delivery-note.repository.js';
import { resolveSalePrice, priceContextForCustomer } from './pricing.service.js';
import { checkCredit } from './credit-control.js';
import type { ApiKeyRow } from '../repositories/api-key.repository.js';

/**
 * Phase 10.2 — création d'une commande par l'API publique (site marchand).
 *
 * Réutilise le flux interne : prix résolu par les listes de prix (phase 6) avec
 * repli sur le prix catalogue, numéro de commande de la série habituelle,
 * `orderRepository.create`. Émet l'événement `order.created` (webhook) dans la
 * MÊME transaction.
 *
 * G0-01 (plan d'action 2026-11) :
 *  - le prix vient TOUJOURS des listes de prix ; `unitPrice` n'est accepté que
 *    d'une clé portant `orders:price_override`, borné à >= 0 et au prix plancher ;
 *  - TVA par ligne pour un client professionnel (même défaut que la prise de
 *    commande interne : code TVA de l'article, exonération du client) ;
 *  - magasin forcé à celui de la clé : la commande suit alors le sourcing et la
 *    réservation de stock internes ; une clé sans magasin entre sans sourcing ;
 *  - contrôle de crédit (client bloqué, plafond bloquant) comme en interne.
 */

/** Portée qui autorise une clé à imposer son prix. Sans elle, `unitPrice` est ignoré. */
export const PRICE_OVERRIDE_SCOPE = 'orders:price_override';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface PublicOrderItemInput {
  productId: string;
  quantity: number;
  /** Prix imposé par le site : lu seulement si la clé porte `orders:price_override`. */
  unitPrice?: number;
}

export interface PublicOrderInput {
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  items: PublicOrderItemInput[];
  notes?: string;
  pickupDate?: string;
}

export interface PublicOrderResult {
  id: string;
  orderNumber: string;
  subtotal: number;
  taxAmount: number;
  total: number;
}

export async function createPublicOrder(
  apiKey: Pick<ApiKeyRow, 'id' | 'store_id' | 'created_by'> & { scopes?: string[] | null },
  input: PublicOrderInput,
): Promise<PublicOrderResult | { error: string; status?: number }> {
  if (!input.items?.length) return { error: 'Aucun article' };
  for (const it of input.items) {
    if (!it.productId || !(Number(it.quantity) > 0)) return { error: 'Article invalide (productId, quantity > 0)' };
  }
  const canOverridePrice = (apiKey.scopes ?? []).includes(PRICE_OVERRIDE_SCOPE);

  // L'acteur de la commande = le créateur de la clé (un gérant/admin). Sans lui,
  // on retombe sur n'importe quel admin (orders.user_id est obligatoire).
  let userId = apiKey.created_by;
  if (!userId) {
    userId = (await db.query(`SELECT id FROM users WHERE role = 'admin' AND is_active IS NOT FALSE ORDER BY created_at LIMIT 1`)).rows[0]?.id ?? null;
  }
  if (!userId) return { error: 'Aucun utilisateur pour porter la commande' };

  const customer = input.customerId
    ? (await db.query(`SELECT id, customer_type, tva_exonere, fn_customer_on_account(customer_type) AS on_account FROM customers WHERE id = $1`, [input.customerId])).rows[0] ?? null
    : null;
  if (input.customerId && !customer) return { error: 'Client introuvable' };
  const isPro = !!customer && customer.on_account === true;

  const ctx = await priceContextForCustomer(db, input.customerId ?? null, null);
  // TVA par ligne : même défaut que la prise de commande interne (professionnels).
  const defaults = isPro
    ? await deliveryNoteRepository.lineDefaults(customer.id as string, input.items.map(i => i.productId))
    : {};

  const lines: { productId: string; quantity: number; unitPrice: number; subtotal: number; tvaRate: number | null; listPrice: number }[] = [];
  const payloadItems: { productId: string; name: string; quantity: number; unitPrice: number }[] = [];
  let subtotal = 0;

  for (const it of input.items) {
    const prod = (await db.query(
      `SELECT id, name, price, floor_price FROM products WHERE id = $1 AND COALESCE(is_available, true)`, [it.productId])).rows[0];
    if (!prod) return { error: `Article introuvable : ${it.productId}` };
    const resolved = await resolveSalePrice(db, it.productId, it.quantity, ctx);
    // Sans liste de prix : professionnel = prix HT remisé (défaut interne), sinon catalogue.
    const listPrice = resolved?.unitPrice
      ?? (isPro ? defaults[it.productId]?.unitPrice : undefined)
      ?? (Number(prod.price) || 0);
    let unitPrice = listPrice;
    if (canOverridePrice && it.unitPrice != null) {
      const given = Number(it.unitPrice);
      if (!Number.isFinite(given) || given < 0) return { error: `Prix invalide pour « ${prod.name} »` };
      const floor = prod.floor_price != null ? Number(prod.floor_price) : null;
      if (floor != null && Number.isFinite(floor) && given < floor - 0.005) {
        return { error: `Prix de « ${prod.name} » (${given.toFixed(2)}) sous le prix plancher (${floor.toFixed(2)})` };
      }
      unitPrice = given;
    }
    const lineTotal = round2(unitPrice * it.quantity);
    subtotal += lineTotal;
    const tvaRate = isPro ? (customer.tva_exonere ? 0 : defaults[it.productId]?.tvaRate ?? null) : null;
    lines.push({ productId: it.productId, quantity: it.quantity, unitPrice, subtotal: lineTotal, tvaRate, listPrice: round2(listPrice) });
    payloadItems.push({ productId: it.productId, name: prod.name, quantity: it.quantity, unitPrice });
  }
  subtotal = round2(subtotal);
  const taxAmount = round2(lines.reduce((s, l) => s + (l.tvaRate ? Math.round(l.subtotal * l.tvaRate) / 100 : 0), 0));
  const total = round2(subtotal + taxAmount);

  // Contrôle de crédit : client bloqué (relance, direction) ou plafond bloquant.
  if (customer) {
    const d = await checkCredit(db, { customerId: customer.id as string, amount: total, checkpoint: 'create', documentType: 'order', documentId: null });
    if (d.decision === 'block') return { error: d.message ?? 'Commande refusée par le contrôle de crédit', status: 409 };
  }

  const orderNumber = await orderRepository.generateOrderNumber();

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const order = await orderRepository.create({
      orderNumber,
      customerId: input.customerId ?? undefined,
      customerName: input.customerName ?? undefined,
      customerPhone: input.customerPhone ?? undefined,
      userId,
      // Commande issue d'un canal externe : type dédié, repérable des commandes internes.
      type: 'online',
      subtotal,
      taxAmount,
      discountAmount: 0,
      total,
      paymentMethod: isPro ? 'deferred' : 'pending',
      notes: input.notes ?? `Commande API — clé ${apiKey.id}`,
      pickupDate: input.pickupDate,
      // Magasin de la clé, jamais celui de la requête : sourcing et réservation internes.
      storeId: apiKey.store_id ?? undefined,
      items: lines,
    }, client);

    const orderId = (order as { id: string }).id;
    await webhookRepository.enqueue('order.created', {
      event: 'order.created',
      order: { id: orderId, orderNumber, total, customerName: input.customerName ?? null, items: payloadItems },
    }, client);

    await client.query('COMMIT');
    return { id: orderId, orderNumber, subtotal, taxAmount, total };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
