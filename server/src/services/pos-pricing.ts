import { pricingTierRepository } from '../repositories/product-pricing-tier.repository.js';
import { channelPricingRepository } from '../repositories/product-channel-pricing.repository.js';

/**
 * Prix d'une ligne de caisse (repris du checkout, partagé avec l'aperçu des promotions) :
 *   1) prix du canal (product_channel_pricing) s'il existe ;
 *   2) palier tarifaire pour un produit au poids ;
 *   3) products.price / price_per_kg.
 * Produit au poids : quantity = grammes, unitPrice = prix au kg.
 */
export async function posLinePrice(product: Record<string, any>, quantity: number, channelId: string | null) {
  const channelOverride = await channelPricingRepository.findOverride(product.id, channelId);
  let unitPrice: number;
  let subtotal: number;
  let unit: 'unit' | 'g' = 'unit';
  if (product.sale_unit === 'weight') {
    if (channelOverride?.price_per_kg_override) {
      unitPrice = parseFloat(channelOverride.price_per_kg_override);
    } else {
      const tier = await pricingTierRepository.findMatchingTier(product.id, quantity);
      unitPrice = tier ? parseFloat(tier.prix_per_kg) : parseFloat(product.price_per_kg ?? product.price);
    }
    subtotal = (quantity / 1000) * unitPrice;
    unit = 'g';
  } else {
    unitPrice = channelOverride?.price_override ? parseFloat(channelOverride.price_override) : parseFloat(product.price);
    subtotal = unitPrice * quantity;
  }
  // Arrondi à 2 décimales (centimes) pour éviter les écarts d'arrondi
  return { unitPrice, subtotal: Math.round(subtotal * 100) / 100, unit };
}
