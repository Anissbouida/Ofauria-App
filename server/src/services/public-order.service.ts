import { db } from '../config/database.js';
import { orderRepository } from '../repositories/order.repository.js';
import { webhookRepository } from '../repositories/webhook.repository.js';
import { resolveSalePrice, priceContextForCustomer } from './pricing.service.js';
import type { ApiKeyRow } from '../repositories/api-key.repository.js';

/**
 * Phase 10.2 — création d'une commande par l'API publique (site marchand).
 *
 * Réutilise le flux interne : prix résolu par les listes de prix (phase 6) avec
 * repli sur le prix catalogue, numéro de commande de la série habituelle,
 * `orderRepository.create`. La commande entre SANS sourcing automatique (pas de
 * magasin passé) : elle est honorée ensuite par les flux internes (BL, prod).
 * Émet l'événement `order.created` (webhook) dans la MÊME transaction.
 */

export interface PublicOrderItemInput {
  productId: string;
  quantity: number;
  /** Prix imposé par le site (optionnel) ; sinon résolu par les listes de prix. */
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
  total: number;
}

export async function createPublicOrder(
  apiKey: Pick<ApiKeyRow, 'id' | 'store_id' | 'created_by'>,
  input: PublicOrderInput,
): Promise<PublicOrderResult | { error: string }> {
  if (!input.items?.length) return { error: 'Aucun article' };
  for (const it of input.items) {
    if (!it.productId || !(Number(it.quantity) > 0)) return { error: 'Article invalide (productId, quantity > 0)' };
  }

  // L'acteur de la commande = le créateur de la clé (un gérant/admin). Sans lui,
  // on retombe sur n'importe quel admin (orders.user_id est obligatoire).
  let userId = apiKey.created_by;
  if (!userId) {
    userId = (await db.query(`SELECT id FROM users WHERE role = 'admin' AND is_active IS NOT FALSE ORDER BY created_at LIMIT 1`)).rows[0]?.id ?? null;
  }
  if (!userId) return { error: 'Aucun utilisateur pour porter la commande' };

  const ctx = await priceContextForCustomer(db, input.customerId ?? null, null);

  const lines: { productId: string; quantity: number; unitPrice: number; subtotal: number; tvaRate: number | null }[] = [];
  const payloadItems: { productId: string; name: string; quantity: number; unitPrice: number }[] = [];
  let subtotal = 0;

  for (const it of input.items) {
    const prod = (await db.query(`SELECT id, name, price FROM products WHERE id = $1`, [it.productId])).rows[0];
    if (!prod) return { error: `Article introuvable : ${it.productId}` };
    const resolved = it.unitPrice != null ? null : await resolveSalePrice(db, it.productId, it.quantity, ctx);
    const unitPrice = it.unitPrice != null ? Number(it.unitPrice) : (resolved?.unitPrice ?? Number(prod.price) ?? 0);
    const lineTotal = Math.round(unitPrice * it.quantity * 100) / 100;
    subtotal += lineTotal;
    // La TVA par ligne est fixée plus tard par les flux internes (facturation) :
    // la commande entrante reste au prix catalogue, sans ventilation de taxe.
    lines.push({ productId: it.productId, quantity: it.quantity, unitPrice, subtotal: lineTotal, tvaRate: null });
    payloadItems.push({ productId: it.productId, name: prod.name, quantity: it.quantity, unitPrice });
  }
  subtotal = Math.round(subtotal * 100) / 100;

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
      taxAmount: 0,
      discountAmount: 0,
      total: subtotal,
      paymentMethod: 'pending',
      notes: input.notes ?? `Commande API — clé ${apiKey.id}`,
      pickupDate: input.pickupDate,
      items: lines,
    }, client);

    const orderId = (order as { id: string }).id;
    await webhookRepository.enqueue('order.created', {
      event: 'order.created',
      order: { id: orderId, orderNumber, total: subtotal, customerName: input.customerName ?? null, items: payloadItems },
    }, client);

    await client.query('COMMIT');
    return { id: orderId, orderNumber, total: subtotal };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
