import { Router } from 'express';
import { salesChannelController } from '../controllers/sales-channel.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLES } from '@ofauria/shared';

const router = Router();

// Lecture : tous les utilisateurs authentifies (POS / Settings)
router.get('/', authenticate, salesChannelController.list);
router.get('/active', authenticate, salesChannelController.listActive);

// Ecriture : admin uniquement
router.post('/', authenticate, authorize(ROLES.ADMIN), salesChannelController.create);
router.put('/:id', authenticate, authorize(ROLES.ADMIN), salesChannelController.update);
router.delete('/:id', authenticate, authorize(ROLES.ADMIN), salesChannelController.deactivate);

export default router;
