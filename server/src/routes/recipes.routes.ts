import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { recipeController } from '../controllers/recipe.controller.js';
import { recipeImportController } from '../controllers/recipe-import.controller.js';
import { recipeComponentController } from '../controllers/recipe-component.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { createRecipeSchema, updateRecipeSchema, bulkDeleteRecipesSchema, saveEtapesSchema, identitySchema } from '../validators/recipe.validator.js';
import { replaceComponentsSchema, financeSchema, createFormatSchema, duplicateFormatSchema, updateFormatSchema, formatWeightsSchema } from '../validators/recipe-component.validator.js';
import { validateUuidParams } from '../middleware/validate.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireStepTypes } from '../services/process-referentials.js';
import { requireUnits } from '../services/unit-referential.js';

// Types d'étape : codes du référentiel production_step_types (mig 513).
const stepTypesOf = requireStepTypes((body: { etapes?: { type?: string | null }[] }) => (body.etapes ?? []).map(e => e.type));
// Unités : codes du référentiel `units` (mig 515), et conversion possible vers l'unité de stock.
type UnitBody = {
  yieldUnit?: string | null;
  ingredients?: { ingredientId?: string; unit?: string | null }[];
  components?: { sourceIngredientId?: string | null; unite?: string | null }[];
};
const unitsOf = requireUnits((body: UnitBody) => [
  { unit: body.yieldUnit },
  ...(body.ingredients ?? []).map(i => ({ unit: i.unit, ingredientId: i.ingredientId })),
  ...(body.components ?? []).map(c => ({ unit: c.unite, ingredientId: c.sourceIngredientId })),
]);

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
router.get('/export', authenticate, can('recipes.export.view'), recipeImportController.export);
router.get('/import/template', authenticate, can('recipes.import_template.view'), recipeImportController.template);
router.post(
  '/import/preview',
  authenticate,
  can('recipes.import.preview'),
  recipeImportUpload.single('file'),
  recipeImportController.preview
);
router.post(
  '/import/commit',
  authenticate,
  can('recipes.commit'),
  recipeImportUpload.single('file'),
  recipeImportController.commit
);

router.get('/', authenticate, recipeController.list);
router.get('/base', authenticate, recipeController.baseRecipes);
router.get('/categories', authenticate, recipeController.listCategories);
// Nomenclature par format (composants) — chemins génériques déclarés AVANT /:id.
// G2-05 — poids cru / cuit des formats, en grille.
router.get('/format-weights', authenticate, can('recipes.format_weights.view'), asyncHandler(recipeComponentController.formatWeights));
router.put('/format-weights/:formatId', authenticate, can('recipes.format_weights'), validateUuidParams('formatId'), validate(formatWeightsSchema), asyncHandler(recipeComponentController.saveFormatWeights));
router.get('/component-roles', authenticate, recipeComponentController.listRoles);
router.get('/component-sources', authenticate, recipeComponentController.listSources);
router.patch('/:recipeId/finance', authenticate, can('recipes.finance'), validate(financeSchema), recipeComponentController.saveFinance);
router.patch('/:recipeId/identity', authenticate, can('recipes.identity'), validate(identitySchema), recipeComponentController.saveIdentity);
router.put('/:recipeId/etapes', authenticate, can('recipes.etapes'), validate(saveEtapesSchema), stepTypesOf, recipeComponentController.saveEtapes);
router.get('/:recipeId/children', authenticate, recipeComponentController.children);
// Explosion à plat (mig 400) — roadmap lot 5
router.get('/:id/explosion', authenticate, recipeController.getExplosion);
router.get('/:recipeId/formats', authenticate, recipeComponentController.listFormats);
router.post('/:recipeId/formats', authenticate, can('recipes.formats'), validate(createFormatSchema), recipeComponentController.createFormat);
router.post('/:recipeId/formats/:formatId/duplicate', authenticate, can('recipes.duplicate'), validate(duplicateFormatSchema), recipeComponentController.duplicateFormat);
router.put('/:recipeId/formats/:formatId', authenticate, can('recipes.formats'), validate(updateFormatSchema), recipeComponentController.updateFormat);
router.delete('/:recipeId/formats/:formatId', authenticate, can('recipes.formats.delete'), recipeComponentController.deleteFormat);
router.get('/:recipeId/formats/:formatId/components', authenticate, recipeComponentController.list);
router.put(
  '/:recipeId/formats/:formatId/components',
  authenticate,
  can('recipes.components'),
  validate(replaceComponentsSchema),
  unitsOf,
  recipeComponentController.replace
);
router.get('/by-product/:productId', authenticate, recipeController.getByProductId);
router.get('/:id', authenticate, recipeController.getById);
router.get('/:id/versions', authenticate, recipeController.versions);
router.post('/:id/versions/:versionNumber/restore', authenticate, can('recipes.versions.restore'), recipeController.restoreVersion);
// Fiche technique imprimable (PDF) — lecture seule, ouverte a tout utilisateur
// authentifie : c'est le document que le labo pose sur le plan de travail.
router.get('/:id/fiche-technique', authenticate, recipeController.downloadFiche);
router.post('/', authenticate, can('recipes.create'), validate(createRecipeSchema), stepTypesOf, unitsOf, recipeController.create);
router.put('/:id', authenticate, can('recipes.edit'), validate(updateRecipeSchema), stepTypesOf, unitsOf, recipeController.update);
// Archivage (mig 275 wip + 346) : DELETE archive, plus de suppression physique ;
// bulk-archive / bulk-restore plus bas, restauration unitaire ici.
router.post('/:id/restore', authenticate, can('recipes.restore'), recipeController.restore);
router.delete('/:id', authenticate, can('recipes.delete'), recipeController.remove);
// Suppression en masse — même autorisation que la suppression unitaire (admin).
router.post('/bulk-delete', authenticate, can('recipes.bulk_delete'), validate(bulkDeleteRecipesSchema), recipeController.bulkRemove);
// Archivage/restauration en masse : alternative à la suppression pour les fiches
// retenues par l'historique de production (FK RESTRICT).
router.post('/bulk-archive', authenticate, can('recipes.bulk_archive'), validate(bulkDeleteRecipesSchema), recipeController.bulkArchive);
router.post('/bulk-restore', authenticate, can('recipes.bulk_restore'), validate(bulkDeleteRecipesSchema), recipeController.bulkRestore);

// Remplacement de composant en masse A→B, annulable (mig 401) — roadmap lot 6
router.get('/bulk-replace/logs', authenticate, can('recipes.bulk_replace_logs.view'), recipeController.bulkReplaceLogs);
router.post('/bulk-replace/preview', authenticate, can('recipes.bulk_replace.preview'), recipeController.bulkReplacePreview);
router.post('/bulk-replace/apply', authenticate, can('recipes.apply'), recipeController.bulkReplaceApply);
router.post('/bulk-replace/:logId/revert', authenticate, can('recipes.revert'), recipeController.bulkReplaceRevert);

export default router;
