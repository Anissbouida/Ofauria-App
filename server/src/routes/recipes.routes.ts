import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { recipeController } from '../controllers/recipe.controller.js';
import { recipeImportController } from '../controllers/recipe-import.controller.js';
import { recipeComponentController } from '../controllers/recipe-component.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { createRecipeSchema, updateRecipeSchema } from '../validators/recipe.validator.js';
import { replaceComponentsSchema, replaceCompositionSchema, financeSchema, createFormatSchema, duplicateFormatSchema, updateFormatSchema } from '../validators/recipe-component.validator.js';
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
router.get('/:recipeId/composition', authenticate, recipeComponentController.getComposition);
router.put('/:recipeId/composition', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), validate(replaceCompositionSchema), recipeComponentController.saveComposition);
router.patch('/:recipeId/finance', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), validate(financeSchema), recipeComponentController.saveFinance);
router.get('/:recipeId/children', authenticate, recipeComponentController.children);
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
router.post('/', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), validate(createRecipeSchema), recipeController.create);
router.put('/:id', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), validate(updateRecipeSchema), recipeController.update);
router.delete('/:id', authenticate, authorize(ROLES.ADMIN), recipeController.remove);

export default router;
