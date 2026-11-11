import { pricingTierRepository } from '../repositories/product-pricing-tier.repository.js';
import { channelPricingRepository } from '../repositories/product-channel-pricing.repository.js';
import { db } from '../config/database.js';
import { resolveSalePrice, priceContextForCustomer } from './pricing.service.js';

/**
 * Prix d'une ligne de caisse (repris du checkout, partagé avec l'aperçu des promotions) :
 *   0) liste de prix applicable (phase 6, canal/groupe/client + palier) si elle existe ;
 *   1) prix du canal (product_channel_pricing) s'il existe ;
 *   2) palier tarifaire pour un produit au poids ;
 *   3) products.price / price_per_kg.
 * Produit au poids : quantity = grammes, unitPrice = prix au kg.
 * `customerId` (phase 6) permet un prix négocié / de groupe ; null = prix public.
 */
export async function posLinePrice(product: Record<string, any>, quantity: number, channelId: string | null, customerId?: string | null) {
  // Phase 6 : une liste de prix en vigueur prime sur la surcharge canal et les paliers.
  // Le palier de quantité des listes est exprimé dans l'unité de vente (pièces/kg/personnes) ;
  // pour un produit au poids, quantity est en grammes → on convertit en kg pour le palier.
  const listQty = product.sale_unit === 'weight' ? quantity / 1000 : quantity;
  const ctx = await priceContextForCustomer(db, customerId ?? null, channelId);
  const listed = await resolveSalePrice(db, product.id, listQty, ctx);
  if (listed) {
    const up = listed.unitPrice;
    if (product.sale_unit === 'weight') return { unitPrice: up, subtotal: Math.round((quantity / 1000) * up * 100) / 100, unit: 'g' as const };
    if (product.sale_unit === 'person') return { unitPrice: up, subtotal: Math.round(quantity * up * 100) / 100, unit: 'person' as const };
    return { unitPrice: up, subtotal: Math.round(up * quantity * 100) / 100, unit: 'unit' as const };
  }

  const channelOverride = await channelPricingRepository.findOverride(product.id, channelId);
  let unitPrice: number;
  let subtotal: number;
  let unit: 'unit' | 'g' | 'person' = 'unit';
  if (product.sale_unit === 'weight') {
    if (channelOverride?.price_per_kg_override) {
      unitPrice = parseFloat(channelOverride.price_per_kg_override);
    } else {
      const tier = await pricingTierRepository.findMatchingTier(product.id, quantity);
      unitPrice = tier ? parseFloat(tier.prix_per_kg) : parseFloat(product.price_per_kg ?? product.price);
    }
    subtotal = (quantity / 1000) * unitPrice;
    unit = 'g';
  } else if (product.sale_unit === 'person') {
    // Vente au nombre de personnes (entremets) : quantity = nombre de personnes,
    // prix = prix par personne (surchargeable par canal). Ex. 30 DH × 8 = 240 DH.
    unitPrice = channelOverride?.price_override ? parseFloat(channelOverride.price_override) : parseFloat(product.price_per_person ?? product.price);
    subtotal = quantity * unitPrice;
    unit = 'person';
  } else {
    unitPrice = channelOverride?.price_override ? parseFloat(channelOverride.price_override) : parseFloat(product.price);
    subtotal = unitPrice * quantity;
  }
  // Arrondi à 2 décimales (centimes) pour éviter les écarts d'arrondi
  return { unitPrice, subtotal: Math.round(subtotal * 100) / 100, unit };
}
