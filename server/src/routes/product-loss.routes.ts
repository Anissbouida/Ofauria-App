import { Router } from 'express';
import { productLossController } from '../controllers/product-loss.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { createProductLossSchema } from '../validators/product-loss.validator.js';

const router = Router();

router.get('/', authenticate, productLossController.list);
router.get('/stats', authenticate, productLossController.stats);
router.post(
  '/',
  authenticate,
  can('controle.product_losses.create'),
  validate(createProductLossSchema),
  productLossController.create,
);
router.delete('/:id', authenticate, can('controle.product_losses.delete'), productLossController.remove);

export default router;
