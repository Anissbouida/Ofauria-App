import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { recipeController } from '../controllers/recipe.controller.js';
import { recipeImportController } from '../controllers/recipe-import.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { createRecipeSchema, updateRecipeSchema } from '../validators/recipe.validator.js';
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
router.get('/by-product/:productId', authenticate, recipeController.getByProductId);
router.get('/:id', authenticate, recipeController.getById);
router.get('/:id/versions', authenticate, recipeController.versions);
router.post('/', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), validate(createRecipeSchema), recipeController.create);
router.put('/:id', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), validate(updateRecipeSchema), recipeController.update);
router.delete('/:id', authenticate, authorize(ROLES.ADMIN), recipeController.remove);

export default router;
