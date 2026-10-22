import { Router } from 'express';
import { storeController } from '../controllers/store.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorizeSettings } from '../middleware/settings-access.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.get('/', authenticate, storeController.list);
router.get('/:id', authenticate, storeController.getById);
router.post('/', authenticate, authorizeSettings('stores', 'create'), asyncHandler(storeController.create));
router.put('/:id', authenticate, authorizeSettings('stores', 'edit'), asyncHandler(storeController.update));
router.delete('/:id', authenticate, authorizeSettings('stores', 'delete'), storeController.remove);

export default router;
