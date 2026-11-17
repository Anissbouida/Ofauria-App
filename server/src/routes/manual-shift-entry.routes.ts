import { Router } from 'express';
import { manualShiftEntryController } from '../controllers/manual-shift-entry.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';

const router = Router();

// Saisie manuelle de caisse retirée (mig 415) : les recettes viennent des
// fermetures de caisse du POS. Seule la lecture de l'historique subsiste.
router.get('/', authenticate, can('accounting.manual_shift_entries.view'), manualShiftEntryController.list);

export default router;
