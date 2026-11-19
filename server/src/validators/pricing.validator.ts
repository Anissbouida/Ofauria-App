import { z } from 'zod';
import { body, txt, numish, bool } from './route-body.validator.js';

/**
 * G0-07 — Listes de prix (pricing.routes). pricing.controller garde ses messages (nom requis,
 * article et prix requis, mode et valeur de la mise à jour en masse) ; types seulement.
 * Volontairement NON imposé : signe ou plafond de la valeur en masse (« set » ou « increase_pct »
 * négatif = baisse : décision métier).
 */
const ref = z.string().max(60).nullish();
export const priceListSchema = body({
  name: txt(200), currency: txt(3), channelId: ref, customerId: ref, customerType: txt(30), priceGroup: txt(60),
  validFrom: txt(40), validTo: txt(40), priority: numish, isActive: bool,
});
export const priceListItemSchema = body({ productId: ref, unitPrice: numish, minQuantity: numish });
/** Catégorie = entier (table categories). */
export const bulkPriceUpdateSchema = body({
  mode: txt(30), value: numish, reason: txt(500),
  categoryId: z.union([z.number().int(), z.string().max(20)]).nullish(), family: txt(120),
  productIds: z.array(z.string().max(60)).max(5000).optional(),
});
