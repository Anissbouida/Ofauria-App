import { Router } from 'express';
import express from 'express';
import { settingsController } from '../controllers/settings.controller.js';
import { auditLogController } from '../controllers/audit-log.controller.js';
import { documentSequenceController } from '../controllers/document-sequence.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorizeSettings, authorizeSettingsUpdate } from '../middleware/settings-access.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// Parser local elargi : le PUT peut embarquer le logo en data URI base64
// (company_settings.logo_url), au-dela de la limite globale de 10 Ko.
// Ces routes sont exclues du parser global dans app.ts.
const jsonParser = express.json({ limit: '3mb' });

// Journal des modifications (mig 328) et des connexions : section « audit ».
router.get('/audit-log', authenticate, authorizeSettings('audit'), asyncHandler(auditLogController.list));
router.get('/audit-log/tables', authenticate, authorizeSettings('audit'), asyncHandler(auditLogController.tables));
router.get('/auth-events', authenticate, authorizeSettings('audit'), asyncHandler(auditLogController.authEvents));

// Series de numeros des pieces (mig 329) : section « numbering ». Le parser
// local est requis (route exclue du parser global, cf. app.ts).
router.get('/document-sequences', authenticate, authorizeSettings('numbering'), asyncHandler(documentSequenceController.list));
router.post('/document-sequences/preview', authenticate, jsonParser, authorizeSettings('numbering'), asyncHandler(documentSequenceController.preview));
router.put('/document-sequences/:docType', authenticate, jsonParser, authorizeSettings('numbering', 'edit'), asyncHandler(documentSequenceController.update));

// Lecture ouverte a tout utilisateur connecte (theme, ticket, identite sur les PDF).
router.get('/', authenticate, jsonParser, settingsController.get);
// Droit « Parametres » (modifier) ; chaque champ envoye doit relever d'une section autorisee.
router.put('/', authenticate, jsonParser, authorizeSettingsUpdate, settingsController.update);

export default router;
