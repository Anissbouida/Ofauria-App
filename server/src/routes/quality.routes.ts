import { Router } from 'express';
import { qualityController } from '../controllers/quality.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';

// Contrôle qualité paramétrable (mig 384) : admin / gérant.
const router = Router();

router.get('/templates', authenticate, can('controle.quality.view'), qualityController.listTemplates);
router.post('/templates', authenticate, can('controle.quality.templates'), qualityController.createTemplate);
router.put('/templates/:id', authenticate, can('controle.quality.templates'), qualityController.updateTemplate);
router.post('/templates/:id/active', authenticate, can('controle.quality.active'), qualityController.setTemplateActive);
router.get('/inspections', authenticate, can('controle.quality.view'), qualityController.listInspections);
router.post('/inspections', authenticate, can('controle.quality.inspections'), qualityController.createInspection);
router.get('/inspections/:id', authenticate, can('controle.quality.view'), qualityController.getInspection);
router.get('/users', authenticate, can('controle.quality.view'), qualityController.users);
router.get('/nonconformities', authenticate, can('controle.quality.view'), qualityController.listNonConformities);
router.post('/nonconformities', authenticate, can('controle.quality.nonconformities'), qualityController.createNonConformity);
router.put('/nonconformities/:id', authenticate, can('controle.quality.nonconformities'), qualityController.updateNonConformity);

export default router;
