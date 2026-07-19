import { Router } from 'express';
import { manualShiftEntryController } from '../controllers/manual-shift-entry.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

router.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), manualShiftEntryController.list);
router.put('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), manualShiftEntryController.upsert);
// C12 — DELETE d'une saisie manuelle : reverse ledger + re-comptabilisation
// des ventes POS du jour (le repo.delete etait deja pret, la route manquait).
router.delete('/:entryDate', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), manualShiftEntryController.remove);

export default router;
