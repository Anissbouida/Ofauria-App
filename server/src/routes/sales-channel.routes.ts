import { Router } from 'express';
import { salesChannelController } from '../controllers/sales-channel.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorizeSettings } from '../middleware/settings-access.middleware.js';

const router = Router();

// Lecture : tous les utilisateurs authentifies (POS / Settings)
router.get('/', authenticate, salesChannelController.list);
router.get('/active', authenticate, salesChannelController.listActive);

// Ecriture : admin uniquement
router.post('/', authenticate, authorizeSettings('production', 'create'), salesChannelController.create);
router.put('/:id', authenticate, authorizeSettings('production', 'edit'), salesChannelController.update);
router.delete('/:id', authenticate, authorizeSettings('production', 'delete'), salesChannelController.deactivate);

export default router;
