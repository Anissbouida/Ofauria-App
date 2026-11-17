import { Router } from 'express';
import { printerController } from '../controllers/printer.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { authorizeSettings } from '../middleware/settings-access.middleware.js';

const router = Router();

// Lecture ouverte au groupe SALES : le POS liste les imprimantes du magasin
// pour le selecteur "imprimante du poste" (parametres locaux du terminal).
// Les mutations restent admin/manager.
// Détection sur la machine du serveur (mig 376) : files CUPS et imprimantes USB.
router.get('/system', authenticate, can('settings.printers.system.view'), printerController.system);
router.post('/system/attach', authenticate, authorizeSettings('print', 'create'), printerController.attachSystem);
router.get('/', authenticate, can('settings.printers.view'), printerController.list);
router.post('/', authenticate, authorizeSettings('print', 'create'), printerController.create);
router.put('/:id', authenticate, authorizeSettings('print', 'edit'), printerController.update);
router.delete('/:id', authenticate, authorizeSettings('print', 'delete'), printerController.remove);

// Actions
router.post('/:id/test', authenticate, can('settings.printers.test'), printerController.test);
router.post('/:id/open-drawer', authenticate, can('settings.printers.open_drawer'), printerController.openDrawer);

export default router;
