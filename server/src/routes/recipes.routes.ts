import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { recipeController } from '../controllers/recipe.controller.js';
import { recipeImportController } from '../controllers/recipe-import.controller.js';
import { recipeComponentController } from '../controllers/recipe-component.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { createRecipeSchema, updateRecipeSchema, bulkDeleteRecipesSchema, saveEtapesSchema, identitySchema } from '../validators/recipe.validator.js';
import { replaceComponentsSchema, financeSchema, createFormatSchema, duplicateFormatSchema, updateFormatSchema } from '../validators/recipe-component.validator.js';
import { ROLES, ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

// Upload xlsx recettes (memoire, 5MB max, .xlsx/.xls). Import/export reserve admin.
const recipeImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ext === '.xlsx' || ext === '.xls');
  },
});

// Routes specifiques (import/export/template) — declarees AVANT /:id et /base
// pour eviter qu'Express ne capture "export" ou "import" comme un id.
router.get('/export', authenticate, authorize(ROLES.ADMIN), recipeImportController.export);
router.get('/import/template', authenticate, authorize(ROLES.ADMIN), recipeImportController.template);
router.post(
  '/import/preview',
  authenticate,
  authorize(ROLES.ADMIN),
  recipeImportUpload.single('file'),
  recipeImportController.preview
);
router.post(
  '/import/commit',
  authenticate,
  authorize(ROLES.ADMIN),
  recipeImportUpload.single('file'),
  recipeImportController.commit
);

router.get('/', authenticate, recipeController.list);
router.get('/base', authenticate, recipeController.baseRecipes);
router.get('/categories', authenticate, recipeController.listCategories);
// Nomenclature par format (composants) — chemins génériques déclarés AVANT /:id.
router.get('/component-roles', authenticate, recipeComponentController.listRoles);
router.get('/component-sources', authenticate, recipeComponentController.listSources);
router.patch('/:recipeId/finance', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), validate(financeSchema), recipeComponentController.saveFinance);
router.patch('/:recipeId/identity', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), validate(identitySchema), recipeComponentController.saveIdentity);
router.put('/:recipeId/etapes', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), validate(saveEtapesSchema), recipeComponentController.saveEtapes);
router.get('/:recipeId/children', authenticate, recipeComponentController.children);
// Explosion à plat (mig 400) — roadmap lot 5
router.get('/:id/explosion', authenticate, recipeController.getExplosion);
router.get('/:recipeId/formats', authenticate, recipeComponentController.listFormats);
router.post('/:recipeId/formats', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), validate(createFormatSchema), recipeComponentController.createFormat);
router.post('/:recipeId/formats/:formatId/duplicate', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), validate(duplicateFormatSchema), recipeComponentController.duplicateFormat);
router.put('/:recipeId/formats/:formatId', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), validate(updateFormatSchema), recipeComponentController.updateFormat);
router.delete('/:recipeId/formats/:formatId', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), recipeComponentController.deleteFormat);
router.get('/:recipeId/formats/:formatId/components', authenticate, recipeComponentController.list);
router.put(
  '/:recipeId/formats/:formatId/components',
  authenticate,
  authorize(...ROLE_GROUPS.PRODUCTION),
  validate(replaceComponentsSchema),
  recipeComponentController.replace
);
router.get('/by-product/:productId', authenticate, recipeController.getByProductId);
router.get('/:id', authenticate, recipeController.getById);
router.get('/:id/versions', authenticate, recipeController.versions);
router.post('/:id/versions/:versionNumber/restore', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), recipeController.restoreVersion);
// Fiche technique imprimable (PDF) — lecture seule, ouverte a tout utilisateur
// authentifie : c'est le document que le labo pose sur le plan de travail.
router.get('/:id/fiche-technique', authenticate, recipeController.downloadFiche);
router.post('/', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), validate(createRecipeSchema), recipeController.create);
router.put('/:id', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), validate(updateRecipeSchema), recipeController.update);
// Archivage (mig 275 wip + 346) : DELETE archive, plus de suppression physique ;
// bulk-archive / bulk-restore plus bas, restauration unitaire ici.
router.post('/:id/restore', authenticate, authorize(ROLES.ADMIN), recipeController.restore);
router.delete('/:id', authenticate, authorize(ROLES.ADMIN), recipeController.remove);
// Suppression en masse — même autorisation que la suppression unitaire (admin).
router.post('/bulk-delete', authenticate, authorize(ROLES.ADMIN), validate(bulkDeleteRecipesSchema), recipeController.bulkRemove);
// Archivage/restauration en masse : alternative à la suppression pour les fiches
// retenues par l'historique de production (FK RESTRICT).
router.post('/bulk-archive', authenticate, authorize(ROLES.ADMIN), validate(bulkDeleteRecipesSchema), recipeController.bulkArchive);
router.post('/bulk-restore', authenticate, authorize(ROLES.ADMIN), validate(bulkDeleteRecipesSchema), recipeController.bulkRestore);

// Remplacement de composant en masse A→B, annulable (mig 401) — roadmap lot 6
router.get('/bulk-replace/logs', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), recipeController.bulkReplaceLogs);
router.post('/bulk-replace/preview', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), recipeController.bulkReplacePreview);
router.post('/bulk-replace/apply', authenticate, authorize(ROLES.ADMIN), recipeController.bulkReplaceApply);
router.post('/bulk-replace/:logId/revert', authenticate, authorize(ROLES.ADMIN), recipeController.bulkReplaceRevert);

export default router;
