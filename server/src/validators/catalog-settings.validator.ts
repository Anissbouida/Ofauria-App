import { z } from 'zod';
import { body, obj, txt, numish, bool } from './route-body.validator.js';

/**
 * G0-07 — Paramétrage du catalogue et des points de vente : sachets (sachet-config.routes),
 * majoration de production (production-markup.routes), canaux de vente (sales-channel.routes),
 * points de vente (store.routes). Les contrôleurs gardent leurs contrôles détaillés (entiers > 0,
 * pourcentage 0-100, code, e-mail, patente, horaires) ; ces schémas n'imposent que les types.
 */

/* Sachets — sachet-config.controller.update / suggest. */
export const sachetConfigSchema = body({
  defaultArticlesPerSachet: z.unknown(),
  categories: z.array(obj({ id: z.unknown(), articlesPerSachet: z.unknown(), needsSachet: z.unknown() })).max(1000).optional(),
});
export const sachetSuggestSchema = body({
  items: z.array(obj({ productId: z.unknown(), quantity: z.unknown() })).max(5000).optional(),
});

/* Majoration de production — production-markup.controller.update. */
export const productionMarkupSchema = body({
  globalPercent: numish,
  categories: z.array(obj({ categoryId: z.union([z.number(), z.string().max(20)]).nullish(), percent: numish })).max(1000).optional(),
});

/* Canaux de vente — sales-channel.controller (code et libellé requis à la création). */
const channelFields = { label: txt(120), color: txt(40), displayOrder: numish, isDefault: bool, isActive: bool };
export const createSalesChannelSchema = body({ ...channelFields, code: txt(40) });
export const updateSalesChannelSchema = body(channelFields);

/* Points de vente — readStore. */
const textish = z.union([z.string().max(300), z.number()]).nullish();
export const storeSchema = body({
  name: txt(200), city: txt(200), address: txt(600), phone: txt(80), isActive: bool, code: textish,
  kind: txt(40), managerUserId: z.string().max(60).nullish(), email: txt(255), patente: textish,
  openingHours: z.record(z.unknown()).nullish(),
});
