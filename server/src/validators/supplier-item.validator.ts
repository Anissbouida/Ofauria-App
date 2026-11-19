import { z } from 'zod';
import { optUuid, emptyBody } from './common.validator.js';
import { body, txt, numish, bool } from './route-body.validator.js';

/**
 * G0-07 — Catalogue fournisseur (supplier-items.routes). supplier-item.controller garde ses
 * messages (fournisseur, nature et article requis ; prix ≥ 0) ; types seulement.
 */
const ref = z.union([z.string().max(60), z.number()]).nullish(); // type de contenant (référentiel)
const itemFields = {
  supplierReference: txt(120), containerTypeId: ref, qtyPerContainer: numish, leadTimeDays: numish, moq: numish,
  isBlocked: bool, notes: txt(2000),
};
export const createSupplierItemSchema = body({ ...itemFields, supplierId: optUuid, purchasableId: optUuid, kind: txt(20) });
export const updateSupplierItemSchema = body(itemFields);
export const supplierItemPriceSchema = body({ price: numish, currency: txt(3), priceUnit: txt(20), validFrom: txt(40) });
export const supplierItemActionSchema = emptyBody;
