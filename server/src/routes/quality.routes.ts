import { Router } from 'express';
import { qualityController } from '../controllers/quality.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

// Contrôle qualité paramétrable (mig 384) : admin / gérant.
const router = Router();
const AM = [authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER)];

router.get('/templates', ...AM, qualityController.listTemplates);
router.post('/templates', ...AM, qualityController.createTemplate);
router.put('/templates/:id', ...AM, qualityController.updateTemplate);
router.post('/templates/:id/active', ...AM, qualityController.setTemplateActive);
router.get('/inspections', ...AM, qualityController.listInspections);
router.post('/inspections', ...AM, qualityController.createInspection);
router.get('/inspections/:id', ...AM, qualityController.getInspection);
router.get('/users', ...AM, qualityController.users);
router.get('/nonconformities', ...AM, qualityController.listNonConformities);
router.post('/nonconformities', ...AM, qualityController.createNonConformity);
router.put('/nonconformities/:id', ...AM, qualityController.updateNonConformity);

export default router;
