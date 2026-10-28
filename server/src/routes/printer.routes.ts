import { Router } from 'express';
import { printerController } from '../controllers/printer.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { authorizeSettings } from '../middleware/settings-access.middleware.js';
import { ROLES, ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

// Lecture ouverte au groupe SALES : le POS liste les imprimantes du magasin
// pour le selecteur "imprimante du poste" (parametres locaux du terminal).
// Les mutations restent admin/manager.
// Détection sur la machine du serveur (mig 376) : files CUPS et imprimantes USB.
router.get('/system', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), printerController.system);
router.post('/system/attach', authenticate, authorizeSettings('print', 'create'), printerController.attachSystem);
router.get('/', authenticate, authorize(...ROLE_GROUPS.SALES), printerController.list);
router.post('/', authenticate, authorizeSettings('print', 'create'), printerController.create);
router.put('/:id', authenticate, authorizeSettings('print', 'edit'), printerController.update);
router.delete('/:id', authenticate, authorizeSettings('print', 'delete'), printerController.remove);

// Actions
router.post('/:id/test', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), printerController.test);
router.post('/:id/open-drawer', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), printerController.openDrawer);

export default router;
