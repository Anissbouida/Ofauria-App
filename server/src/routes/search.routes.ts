import { Router } from 'express';
import { searchController } from '../controllers/search.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

// Recherche globale : accessible à tout utilisateur connecté.
const router = Router();
router.get('/', authenticate, searchController.global);
export default router;
