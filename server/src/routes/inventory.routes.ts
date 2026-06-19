import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { inventoryController, ingredientController } from '../controllers/inventory.controller.js';
import { ingredientImportController } from '../controllers/ingredient-import.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

router.get('/', authenticate, inventoryController.list);
router.get('/alerts', authenticate, inventoryController.alerts);
router.post('/restock', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), inventoryController.restock);
router.post('/adjust', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), inventoryController.adjust);
router.put('/threshold', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), inventoryController.updateThreshold);
router.get('/transactions', authenticate, inventoryController.transactions);
// Consommation matieres par periode (admin/gerant, utilise par Comptabilite)
router.get('/consumption', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), inventoryController.consumption);
// Achats / approvisionnement matieres par periode (entrees de stock, BC + achat direct)
router.get('/purchases', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), inventoryController.purchases);

export default router;

// Upload xlsx ingredients (in-memory, 5MB max, .xlsx/.xls)
const ingredientImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ext === '.xlsx' || ext === '.xls');
  },
});

export const ingredientsRouter = Router();

// Routes specifiques (import/export/template) — declarees AVANT /:id pour eviter
// que Express ne capture "import" comme un id.
ingredientsRouter.get('/export', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), ingredientImportController.export);
ingredientsRouter.get('/import/template', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), ingredientImportController.template);
ingredientsRouter.post(
  '/import/preview',
  authenticate,
  authorize(...ROLE_GROUPS.ADMIN_MANAGER),
  ingredientImportUpload.single('file'),
  ingredientImportController.preview
);
ingredientsRouter.post(
  '/import/commit',
  authenticate,
  authorize(...ROLE_GROUPS.ADMIN_MANAGER),
  ingredientImportUpload.single('file'),
  ingredientImportController.commit
);

ingredientsRouter.get('/', authenticate, ingredientController.list);
ingredientsRouter.get('/:id', authenticate, ingredientController.getById);
ingredientsRouter.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), ingredientController.create);
ingredientsRouter.put('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), ingredientController.update);
// Convertit un ingredient mal range en consommable (packaging_items)
ingredientsRouter.post('/:id/convert-to-consumable', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), ingredientController.convertToConsumable);
// Suppression : admin + gerant (cf demande utilisateur — flexibilite mise en place)
ingredientsRouter.delete('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), ingredientController.remove);
