import { Router } from 'express';
import { routingController } from '../controllers/routing.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import { createRoutingSchema, updateRoutingSchema, calendarSchema, closureSchema } from '../validators/routing.validator.js';

// Postes de travail & gammes (mig 388) : admin / gérant.
const router = Router();

router.get('/work-centers', authenticate, can('production.routings.view'), routingController.listWorkCenters);
router.post('/work-centers', authenticate, can('production.routings.work_centers'), routingController.createWorkCenter);
router.put('/work-centers/:id', authenticate, can('production.routings.work_centers'), routingController.updateWorkCenter);
router.post('/work-centers/:id/active', authenticate, can('production.routings.active'), routingController.setWorkCenterActive);
// Statut & arrêts machine / TRS (mig 402) — roadmap lot 7
router.post('/work-centers/:id/status', authenticate, can('production.routings.status'), routingController.setWorkCenterStatus);
router.post('/work-centers/:id/downtime', authenticate, can('production.routings.downtime'), routingController.recordDowntime);
router.get('/work-centers/:id/downtime', authenticate, can('production.routings.view'), routingController.listDowntime);
router.get('/work-centers/:id/oee', authenticate, can('production.routings.view'), routingController.getOee);
// Calendrier des postes (M5-04)
router.get('/work-centers/:id/calendar', authenticate, validateUuidParams('id'), can('production.routings.view'), routingController.getCalendar);
router.put('/work-centers/:id/calendar', authenticate, validateUuidParams('id'), can('production.routings.work_centers'), validate(calendarSchema), routingController.setCalendar);
router.post('/work-centers/:id/closures', authenticate, validateUuidParams('id'), can('production.routings.work_centers'), validate(closureSchema), routingController.addClosure);
router.delete('/work-centers/closures/:closureId', authenticate, validateUuidParams('closureId'), can('production.routings.work_centers'), routingController.removeClosure);
router.get('/', authenticate, can('production.routings.view'), routingController.listRoutings);
router.get('/for-recipe/:recipeId', authenticate, validateUuidParams('recipeId'), can('production.routings.view'), routingController.getRoutingForRecipe);
router.post('/', authenticate, can('production.routings.create'), validate(createRoutingSchema), routingController.createRouting);
router.get('/:id', authenticate, can('production.routings.view'), routingController.getRouting);
router.put('/:id', authenticate, can('production.routings.edit'), validate(updateRoutingSchema), routingController.updateRouting);
router.post('/:id/active', authenticate, can('production.routings.active'), routingController.setRoutingActive);
router.delete('/:id', authenticate, can('production.routings.delete'), routingController.deleteRouting);

export default router;
