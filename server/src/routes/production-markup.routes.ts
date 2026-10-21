import { Router } from 'express';
import { productionMarkupController } from '../controllers/production-markup.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorizeSettings } from '../middleware/settings-access.middleware.js';

const router = Router();

// Lecture : tout utilisateur authentifie (le POS a besoin du taux pour la suggestion).
router.get('/', authenticate, productionMarkupController.get);
// Modification (taux global + overrides categorie) : admin uniquement.
router.put('/', authenticate, authorizeSettings('production', 'edit'), productionMarkupController.update);

export default router;
