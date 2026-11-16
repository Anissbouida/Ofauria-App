import { Router, json as expressJson } from 'express';
import multer from 'multer';
import path from 'path';
import { productController } from '../controllers/product.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import {
  createProductSchema,
  updateProductSchema,
  replaceRecycleDestinationsSchema,
  bulkDeleteProductsSchema,
  importProductsSchema,
} from '../validators/product.validator.js';
import { ROLES, ROLE_GROUPS } from '@ofauria/shared';

// G0-04 : image reçue en mémoire puis écrite dans le stockage objet (table files).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (_req, file, cb) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
  cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
}});

const router = Router();

router.get('/', authenticate, productController.list);
router.get('/top-selling', authenticate, productController.topSelling);
router.get('/alerts/low-stock', authenticate, productController.lowStock);
router.get('/:id/effective-deadline', authenticate, productController.effectiveDeadline);
router.get('/:id', authenticate, productController.getById);
router.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validate(createProductSchema), productController.create);
// Import CSV (export Loyverse) + suppression en masse.
// Parser local elargi : ces deux routes sont exclues du parser global 10 Ko
// (app.ts ROUTES_WITH_LOCAL_JSON_PARSER) car elles recoivent des centaines de
// lignes/UUID d'un coup.
const batchJsonParser = expressJson({ limit: '512kb' });
router.post('/import', batchJsonParser, authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validate(importProductsSchema), productController.importProducts);
router.post('/bulk-delete', batchJsonParser, authenticate, authorize(ROLES.ADMIN), validate(bulkDeleteProductsSchema), productController.bulkDelete);
router.put('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validate(updateProductSchema), productController.update);
router.delete('/:id', authenticate, authorize(ROLES.ADMIN), productController.remove);
router.patch('/:id/toggle-availability', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), productController.toggleAvailability);
// G0-08 (V5) : même droit que la modification d'un article.
router.post('/:id/image', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), upload.single('image'), productController.uploadImage);
router.post('/:id/stock', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), productController.adjustStock);
router.get('/:id/stock-history', authenticate, productController.stockHistory);
// Paliers tarifaires (mig 171)
router.get('/:id/pricing-tiers', authenticate, productController.listPricingTiers);
router.put('/:id/pricing-tiers', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), productController.replacePricingTiers);
// Overrides prix par canal (mig 173)
router.get('/:id/channel-pricing', authenticate, productController.listChannelPricing);
router.put('/:id/channel-pricing', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), productController.replaceChannelPricing);
// Destinations de recyclage (audit P1.3, mig 106)
router.get('/:id/recycle-destinations', authenticate, productController.listRecycleDestinations);
router.put('/:id/recycle-destinations', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validate(replaceRecycleDestinationsSchema), productController.replaceRecycleDestinations);

export default router;
