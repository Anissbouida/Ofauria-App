import { Router } from 'express';
import { manualShiftEntryController } from '../controllers/manual-shift-entry.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

// Saisie manuelle de caisse retirée (mig 415) : les recettes viennent des
// fermetures de caisse du POS. Seule la lecture de l'historique subsiste.
router.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), manualShiftEntryController.list);

export default router;
