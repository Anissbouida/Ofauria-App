import { Router } from 'express';
import express from 'express';
import { settingsController } from '../controllers/settings.controller.js';
import { auditLogController } from '../controllers/audit-log.controller.js';
import { documentSequenceController } from '../controllers/document-sequence.controller.js';
import { parametersController } from '../controllers/parameters.controller.js';
import { companyController } from '../controllers/company.controller.js';
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

// Parametres metier (lot 4) : le droit est controle parametre par parametre
// (section de chacun) ; la liste ne contient que ceux que l'utilisateur peut voir.
router.get('/parameters', authenticate, asyncHandler(parametersController.list));
router.put('/parameters/:key', authenticate, jsonParser, asyncHandler(parametersController.update));

// Fiche societe (lot 5, mig 331) : comptes bancaires (section Entreprise), TVA (section TVA).
router.get('/bank-accounts', authenticate, authorizeSettings('company'), asyncHandler(companyController.bankAccounts));
router.post('/bank-accounts', authenticate, jsonParser, authorizeSettings('company', 'create'), asyncHandler(companyController.saveBankAccount));
router.put('/bank-accounts/:id', authenticate, jsonParser, authorizeSettings('company', 'edit'), asyncHandler(companyController.saveBankAccount));
router.get('/tax-codes', authenticate, authorizeSettings('tax'), asyncHandler(companyController.taxCodes));
router.post('/tax-codes', authenticate, jsonParser, authorizeSettings('tax', 'create'), asyncHandler(companyController.addTaxRate));
router.put('/tax-codes/:id', authenticate, jsonParser, authorizeSettings('tax', 'edit'), asyncHandler(companyController.updateTaxCode));

// Lecture ouverte a tout utilisateur connecte (theme, ticket, identite sur les PDF).
router.get('/', authenticate, jsonParser, settingsController.get);
// Droit « Parametres » (modifier) ; chaque champ envoye doit relever d'une section autorisee.
router.put('/', authenticate, jsonParser, authorizeSettingsUpdate, settingsController.update);

export default router;
