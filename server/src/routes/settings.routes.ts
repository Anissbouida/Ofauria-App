import { Router } from 'express';
import { auditTrailRepository } from '../repositories/audit-trail.repository.js';
import express from 'express';
import { settingsController } from '../controllers/settings.controller.js';
import { auditLogController } from '../controllers/audit-log.controller.js';
import { documentSequenceController } from '../controllers/document-sequence.controller.js';
import { parametersController } from '../controllers/parameters.controller.js';
import { companyController } from '../controllers/company.controller.js';
import { vocabularyController, vocabularySchema } from '../controllers/vocabulary.controller.js';
import { profileStatus } from '../services/profile-status.js';
import { documentsNotificationsController as docs } from '../controllers/documents-notifications.controller.js';
import { dataController } from '../controllers/data.controller.js';
import { approvalRulesController } from '../controllers/approval-rules.controller.js';
import { setupController } from '../controllers/setup.controller.js';
import { apiSettingsController } from '../controllers/api-settings.controller.js';
import multer from 'multer';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorizeSettings, authorizeSettingsUpdate } from '../middleware/settings-access.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import { legalEntityController, legalEntityCreateSchema, legalEntityUpdateSchema, legalEntityStoreSchema } from '../controllers/legal-entity.controller.js';
import { unitsRepository } from '../repositories/units.repository.js';
import { emptyBody } from '../validators/common.validator.js';
import { addTaxRateSchema, bankAccountSchema, configAssistantSchema, configModelPreviewSchema, createApiKeySchema, createApprovalRuleSchema, createSectorSchema, createWebhookSchema, specializationSchema, dataImportSchema, documentSequenceSchema, documentTemplateSchema, moduleAdjustmentsSchema, moduleRolloutSchema, notificationRuleSchema, parameterValueSchema, setSectorSchema, updateApprovalRuleSchema, updateCompanySettingsSchema, updateTaxCodeSchema, webhookActiveSchema } from '../validators/settings.validator.js';

const router = Router();

// Parser local elargi : le PUT peut embarquer le logo en data URI base64
// (company_settings.logo_url), au-dela de la limite globale de 10 Ko.
// Ces routes sont exclues du parser global dans app.ts.
const jsonParser = express.json({ limit: '3mb' });
// Import guide (lot 7) : fichier Excel ou CSV en memoire, 5 Mo maximum.
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Référentiel des unités (M3-01) : lecture pour tout utilisateur connecté (écrans de saisie).
router.get('/units', authenticate, asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await unitsRepository.overview() });
}));

// Accueil de la configuration (refonte lot B) : points filtres par section visible.
router.get('/setup', authenticate, asyncHandler(setupController.status));

// Journal des modifications (mig 328) et des connexions : section « audit ».
router.get('/audit-log', authenticate, authorizeSettings('audit'), asyncHandler(auditLogController.list));
// G6-07 : historique d'une fiche (piste d'audit générique) — tables suivies seulement.
router.get('/audit-trail/:table/:id', authenticate, authorizeSettings('audit'), asyncHandler(async (req, res) => {
  const table = String(req.params.table);
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(table) || !(await auditTrailRepository.isTracked(table))) {
    res.status(404).json({ success: false, error: { message: 'Table non suivie' } }); return;
  }
  res.json({ success: true, data: await auditTrailRepository.history(table, String(req.params.id)) });
}));
router.get('/audit-log/tables', authenticate, authorizeSettings('audit'), asyncHandler(auditLogController.tables));
router.get('/auth-events', authenticate, authorizeSettings('audit'), asyncHandler(auditLogController.authEvents));

// Series de numeros des pieces (mig 329) : section « numbering ». Le parser
// local est requis (route exclue du parser global, cf. app.ts).
router.get('/document-sequences', authenticate, authorizeSettings('numbering'), asyncHandler(documentSequenceController.list));
router.post('/document-sequences/preview', authenticate, jsonParser, authorizeSettings('numbering'), validate(documentSequenceSchema), asyncHandler(documentSequenceController.preview));
router.put('/document-sequences/:docType', authenticate, jsonParser, authorizeSettings('numbering', 'edit'), validate(documentSequenceSchema), asyncHandler(documentSequenceController.update));

// Parametres metier (lot 4) : le droit est controle parametre par parametre
// (section de chacun) ; la liste ne contient que ceux que l'utilisateur peut voir.
router.get('/parameters', authenticate, asyncHandler(parametersController.list));
router.put('/parameters/:key', authenticate, jsonParser, validate(parameterValueSchema), asyncHandler(parametersController.update));

// Fiche societe (lot 5, mig 331) : comptes bancaires (section Entreprise), TVA (section TVA).
// Secteur d'activité (mig 468) : GET lisible par tout utilisateur (masquage des modules
// hors secteur côté client) ; PUT réservé à la direction (droit « Société »).
router.get('/sector', authenticate, asyncHandler(companyController.sector));
router.put('/sector', authenticate, jsonParser, authorizeSettings('company', 'edit'), validate(setSectorSchema), asyncHandler(companyController.setSector));
router.get('/specializations', authenticate, authorizeSettings('company', 'view'), asyncHandler(companyController.specializations));
router.get('/modules/versions-compare', authenticate, authorizeSettings('company', 'view'), asyncHandler(companyController.compareVersions));
router.put('/specializations/:code', authenticate, jsonParser, authorizeSettings('company', 'edit'), validate(specializationSchema), asyncHandler(companyController.setSpecialization));
// M8-03 — vocabulaire : termes du secteur renommés par la société (mig 583).
// C-03 — état de configuration du profil d'industrie (une tuile par couche).
router.get('/profile-status', authenticate, authorizeSettings('company', 'view'), asyncHandler(async (_req, res) => { res.json({ success: true, data: await profileStatus() }); }));
router.get('/vocabulary', authenticate, authorizeSettings('company', 'view'), asyncHandler(vocabularyController.list));
router.put('/vocabulary/:key', authenticate, jsonParser, authorizeSettings('company', 'edit'), validate(vocabularySchema), asyncHandler(vocabularyController.set));
router.delete('/vocabulary/:key', authenticate, authorizeSettings('company', 'edit'), asyncHandler(vocabularyController.reset));
// Activation des modules et options (mig 507) : secteur = préréglage + ajustements.
router.get('/modules', authenticate, authorizeSettings('company', 'view'), asyncHandler(companyController.modules));
router.put('/modules', authenticate, jsonParser, authorizeSettings('company', 'edit'), validate(moduleAdjustmentsSchema), asyncHandler(companyController.saveModules));
router.post('/modules/reset', authenticate, authorizeSettings('company', 'edit'), validate(emptyBody), asyncHandler(companyController.resetModules));
// Aperçu d'impact et configuration versionnée (mig 508, lot P0b).
router.post('/modules/preview', authenticate, jsonParser, authorizeSettings('company', 'view'), validate(moduleAdjustmentsSchema), asyncHandler(companyController.previewModules));
router.get('/modules/versions', authenticate, authorizeSettings('company', 'view'), asyncHandler(companyController.moduleVersions));
// Bilan de santé (P8) : propositions calculées sur les données ; écarter = 90 jours (mig 516).
router.get('/modules/health', authenticate, authorizeSettings('company', 'view'), asyncHandler(companyController.moduleHealth));
router.post('/modules/health/restore', authenticate, authorizeSettings('company', 'edit'), validate(emptyBody), asyncHandler(companyController.restoreHealth));
// Modèles de configuration (P10, mig 517) : export JSON, aperçu d'un modèle importé,
// enregistrement comme secteur personnalisé, suppression d'un secteur personnalisé.
router.get('/modules/export', authenticate, authorizeSettings('company', 'view'), asyncHandler(companyController.exportConfig));
router.post('/modules/import/preview', authenticate, jsonParser, authorizeSettings('company', 'view'), validate(configModelPreviewSchema), asyncHandler(companyController.previewConfigModel));
// Configuration en langage naturel (P11) : l'IA propose un modèle, revu avant tout enregistrement.
router.get('/modules/assistant', authenticate, authorizeSettings('company', 'view'), asyncHandler(companyController.assistantStatus));
router.post('/modules/assistant', authenticate, jsonParser, authorizeSettings('company', 'edit'), validate(configAssistantSchema), asyncHandler(companyController.suggestConfig));
router.post('/sectors', authenticate, jsonParser, authorizeSettings('company', 'edit'), validate(createSectorSchema), asyncHandler(companyController.createSector));
router.delete('/sectors/:code', authenticate, authorizeSettings('company', 'edit'), asyncHandler(companyController.deleteSector));
// Mise en route guidée (P9) : listes de tâches par module ; masquer = jusqu'à « Réafficher ».
router.get('/modules/onboarding', authenticate, authorizeSettings('company', 'view'), asyncHandler(companyController.moduleOnboarding));
router.post('/modules/onboarding/show', authenticate, authorizeSettings('company', 'edit'), validate(emptyBody), asyncHandler(companyController.showOnboarding));
router.post('/modules/onboarding/:module/hide', authenticate, authorizeSettings('company', 'edit'), validate(emptyBody), asyncHandler(companyController.hideOnboarding));
router.post('/modules/health/:key/dismiss', authenticate, authorizeSettings('company', 'edit'), validate(emptyBody), asyncHandler(companyController.dismissHealth));
router.post('/modules/versions/:id/restore', authenticate, authorizeSettings('company', 'edit'), validate(emptyBody), asyncHandler(companyController.restoreModuleVersion));
// Diffusion d'un module : pilote et établissements (mig 509, lot P0c).
router.put('/modules/:key/rollout', authenticate, jsonParser, authorizeSettings('company', 'edit'), validate(moduleRolloutSchema), asyncHandler(companyController.saveModuleRollout));
// Données de départ par secteur (phase 9.3) : aperçu + chargement à la demande (direction).
router.get('/sector/starter', authenticate, asyncHandler(companyController.sectorStarter));
router.post('/sector/starter', authenticate, jsonParser, authorizeSettings('company', 'edit'), validate(emptyBody), asyncHandler(companyController.loadSectorStarter));
// Entités juridiques (G6-03, mig 608) : section « Société » ; une seule entité au départ (miroir de la fiche société).
router.get('/legal-entities', authenticate, authorizeSettings('company'), asyncHandler(legalEntityController.list));
router.post('/legal-entities', authenticate, jsonParser, authorizeSettings('company', 'create'), validate(legalEntityCreateSchema), asyncHandler(legalEntityController.create));
router.put('/legal-entities/stores/:storeId', authenticate, jsonParser, authorizeSettings('company', 'edit'), validateUuidParams('storeId'), validate(legalEntityStoreSchema), asyncHandler(legalEntityController.assignStore));
router.put('/legal-entities/:id', authenticate, jsonParser, authorizeSettings('company', 'edit'), validateUuidParams('id'), validate(legalEntityUpdateSchema), asyncHandler(legalEntityController.update));
router.get('/bank-accounts', authenticate, authorizeSettings('company'), asyncHandler(companyController.bankAccounts));
router.post('/bank-accounts', authenticate, jsonParser, authorizeSettings('company', 'create'), validate(bankAccountSchema), asyncHandler(companyController.saveBankAccount));
router.put('/bank-accounts/:id', authenticate, jsonParser, authorizeSettings('company', 'edit'), validate(bankAccountSchema), asyncHandler(companyController.saveBankAccount));
router.get('/tax-codes', authenticate, authorizeSettings('tax'), asyncHandler(companyController.taxCodes));
// Pack pays (G6-06) : paramètres légaux de la paie et de la fiscalité, en lecture seule.
router.get('/country-pack', authenticate, authorizeSettings('tax'), asyncHandler(companyController.countryPack));
router.post('/tax-codes', authenticate, jsonParser, authorizeSettings('tax', 'create'), validate(addTaxRateSchema), asyncHandler(companyController.addTaxRate));
router.put('/tax-codes/:id', authenticate, jsonParser, authorizeSettings('tax', 'edit'), validate(updateTaxCodeSchema), asyncHandler(companyController.updateTaxCode));

// Modeles de documents et regles de notification (lot 6, mig 332).
router.get('/documents', authenticate, authorizeSettings('documents'), asyncHandler(docs.documents));
router.get('/documents/:docType/preview', authenticate, authorizeSettings('documents'), asyncHandler(docs.preview));
router.put('/documents/:docType', authenticate, jsonParser, authorizeSettings('documents', 'edit'), validate(documentTemplateSchema), asyncHandler(docs.updateDocument));
router.get('/notification-rules', authenticate, authorizeSettings('notifications'), asyncHandler(docs.notificationRules));
router.put('/notification-rules/:type', authenticate, jsonParser, authorizeSettings('notifications', 'edit'), validate(notificationRuleSchema), asyncHandler(docs.updateNotificationRule));

// Donnees (lot 7) : import guide, exports de la configuration et des donnees de base.
// Circuits d'approbation (lot 8, mig 350) : section « approvals ».
router.get('/approval-rules', authenticate, authorizeSettings('approvals'), asyncHandler(approvalRulesController.list));
router.post('/approval-rules', authenticate, jsonParser, authorizeSettings('approvals', 'create'), validate(createApprovalRuleSchema), asyncHandler(approvalRulesController.create));
router.put('/approval-rules/:code', authenticate, jsonParser, authorizeSettings('approvals', 'edit'), validate(updateApprovalRuleSchema), asyncHandler(approvalRulesController.update));
router.delete('/approval-rules/:code', authenticate, authorizeSettings('approvals', 'delete'), asyncHandler(approvalRulesController.remove));

// API publique et webhooks (phase 10.2) : section « Entreprise » (direction).
// La clé / le secret ne sont renvoyés en clair qu'à la création.
router.get('/api-keys', authenticate, authorizeSettings('company'), asyncHandler(apiSettingsController.listKeys));
router.post('/api-keys', authenticate, jsonParser, authorizeSettings('company', 'create'), validate(createApiKeySchema), asyncHandler(apiSettingsController.createKey));
router.delete('/api-keys/:id', authenticate, authorizeSettings('company', 'delete'), asyncHandler(apiSettingsController.revokeKey));
router.get('/webhooks', authenticate, authorizeSettings('company'), asyncHandler(apiSettingsController.listWebhooks));
router.post('/webhooks', authenticate, jsonParser, authorizeSettings('company', 'create'), validate(createWebhookSchema), asyncHandler(apiSettingsController.createWebhook));
router.put('/webhooks/:id', authenticate, jsonParser, authorizeSettings('company', 'edit'), validate(webhookActiveSchema), asyncHandler(apiSettingsController.setWebhookActive));
router.delete('/webhooks/:id', authenticate, authorizeSettings('company', 'delete'), asyncHandler(apiSettingsController.removeWebhook));

router.get('/data/status', authenticate, authorizeSettings('data'), asyncHandler(dataController.status));
// G2-02 — qualité des données maîtres (lecture seule).
router.get('/data/quality', authenticate, authorizeSettings('data'), asyncHandler(dataController.quality));
// G3-11 — registre des traitements (loi 09-08).
router.get('/data/processing-register', authenticate, authorizeSettings('data'), asyncHandler(dataController.processingRegister));
router.get('/data/quality/:key', authenticate, authorizeSettings('data'), asyncHandler(dataController.qualityItems));
router.get('/data/import/:entity/template', authenticate, authorizeSettings('data'), asyncHandler(dataController.template));
router.post('/data/import/:entity/preview', authenticate, authorizeSettings('data', 'create'), importUpload.single('file'), validate(dataImportSchema), asyncHandler(dataController.preview));
router.post('/data/import/:entity/commit', authenticate, authorizeSettings('data', 'create'), importUpload.single('file'), validate(dataImportSchema), asyncHandler(dataController.commit));
router.get('/data/imports', authenticate, authorizeSettings('data'), asyncHandler(dataController.imports));
router.post('/data/imports/:id/undo', authenticate, authorizeSettings('data', 'edit'), validate(emptyBody), asyncHandler(dataController.undo));
router.get('/data/export/configuration', authenticate, authorizeSettings('data'), asyncHandler(dataController.exportConfiguration));
router.get('/data/export/base', authenticate, authorizeSettings('data'), asyncHandler(dataController.exportData));

// Lecture ouverte a tout utilisateur connecte (theme, ticket, identite sur les PDF).
router.get('/', authenticate, jsonParser, settingsController.get);
// Droit « Parametres » (modifier) ; chaque champ envoye doit relever d'une section autorisee.
router.put('/', authenticate, jsonParser, authorizeSettingsUpdate, validate(updateCompanySettingsSchema), settingsController.update);

export default router;
