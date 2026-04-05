import { Router } from 'express';
import { returnController } from '../controllers/return.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = Router();

router.get('/', authenticate, returnController.list);
router.get('/search', authenticate, returnController.searchSale);
router.post('/', authenticate, returnController.create);

export default router;
