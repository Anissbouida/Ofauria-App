import { conversionHandlers, createConversionSchema, updateConversionSchema } from '../controllers/item-conversions.controller.js';
import { Router, json as expressJson } from 'express';
import multer from 'multer';
import path from 'path';
import { productController } from '../controllers/product.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { productLabelFieldsSchema } from '../validators/product.validator.js';
import {
  createProductSchema,
  updateProductSchema,
  replaceRecycleDestinationsSchema,
  bulkDeleteProductsSchema,
  importProductsSchema,
} from '../validators/product.validator.js';

// G0-04 : image reçue en mémoire puis écrite dans le stockage objet (table files).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (_req, file, cb) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
  cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
}});

const router = Router();
const productConversions = conversionHandlers('product');

router.get('/', authenticate, productController.list);
router.get('/top-selling', authenticate, productController.topSelling);
router.get('/alerts/low-stock', authenticate, productController.lowStock);
router.get('/:id/effective-deadline', authenticate, productController.effectiveDeadline);
// G2-09 — étiquette réglementaire : données composées et mentions du produit.
router.get('/:id/label-data', authenticate, validateUuidParams('id'), asyncHandler(productController.labelData));
router.put('/:id/label-fields', authenticate, can('products.label_fields'), validateUuidParams('id'), validate(productLabelFieldsSchema), asyncHandler(productController.saveLabelFields));
// Conversions propres au produit (M3-02).
router.get('/:id/conversions', authenticate, validateUuidParams('id'), asyncHandler(productConversions.list));
router.post('/:id/conversions', authenticate, validateUuidParams('id'), can('products.edit'), validate(createConversionSchema), asyncHandler(productConversions.create));
router.put('/:id/conversions/:convId', authenticate, validateUuidParams('id', 'convId'), can('products.edit'), validate(updateConversionSchema), asyncHandler(productConversions.update));
router.delete('/:id/conversions/:convId', authenticate, validateUuidParams('id', 'convId'), can('products.edit'), asyncHandler(productConversions.remove));
router.get('/:id', authenticate, productController.getById);
router.post('/', authenticate, can('products.create'), validate(createProductSchema), productController.create);
// Import CSV (export Loyverse) + suppression en masse.
// Parser local elargi : ces deux routes sont exclues du parser global 10 Ko
// (app.ts ROUTES_WITH_LOCAL_JSON_PARSER) car elles recoivent des centaines de
// lignes/UUID d'un coup.
const batchJsonParser = expressJson({ limit: '512kb' });
router.post('/import', batchJsonParser, authenticate, can('products.import'), validate(importProductsSchema), productController.importProducts);
router.post('/bulk-delete', batchJsonParser, authenticate, can('products.bulk_delete'), validate(bulkDeleteProductsSchema), productController.bulkDelete);
router.put('/:id', authenticate, can('products.edit'), validate(updateProductSchema), productController.update);
router.delete('/:id', authenticate, can('products.delete'), productController.remove);
router.patch('/:id/toggle-availability', authenticate, can('products.toggle_availability'), productController.toggleAvailability);
// G0-08 (V5) : même droit que la modification d'un article.
router.post('/:id/image', authenticate, can('products.image'), upload.single('image'), productController.uploadImage);
router.post('/:id/stock', authenticate, can('products.stock'), productController.adjustStock);
router.get('/:id/stock-history', authenticate, productController.stockHistory);
// Paliers tarifaires (mig 171)
router.get('/:id/pricing-tiers', authenticate, productController.listPricingTiers);
router.put('/:id/pricing-tiers', authenticate, can('products.pricing_tiers'), productController.replacePricingTiers);
// Overrides prix par canal (mig 173)
router.get('/:id/channel-pricing', authenticate, productController.listChannelPricing);
router.put('/:id/channel-pricing', authenticate, can('products.channel_pricing'), productController.replaceChannelPricing);
// Destinations de recyclage (audit P1.3, mig 106)
router.get('/:id/recycle-destinations', authenticate, productController.listRecycleDestinations);
router.put('/:id/recycle-destinations', authenticate, can('products.recycle_destinations'), validate(replaceRecycleDestinationsSchema), productController.replaceRecycleDestinations);

export default router;
