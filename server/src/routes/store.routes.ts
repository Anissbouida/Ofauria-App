import { Router } from 'express';
import { storeController } from '../controllers/store.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = Router();

router.get('/', authenticate, storeController.list);
router.get('/:id', authenticate, storeController.getById);
router.post('/', authenticate, storeController.create);
router.put('/:id', authenticate, storeController.update);
router.delete('/:id', authenticate, storeController.remove);

export default router;
