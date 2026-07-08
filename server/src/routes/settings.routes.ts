import { Router } from 'express';
import express from 'express';
import { settingsController } from '../controllers/settings.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';

const router = Router();

// Parser local elargi : le PUT peut embarquer le logo en data URI base64
// (company_settings.logo_url), au-dela de la limite globale de 10 Ko.
// Ces routes sont exclues du parser global dans app.ts.
const jsonParser = express.json({ limit: '3mb' });

router.get('/', authenticate, jsonParser, settingsController.get);
router.put('/', authenticate, authorize('admin'), jsonParser, settingsController.update);

export default router;
