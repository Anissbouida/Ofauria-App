import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { productController } from '../controllers/product.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const storage = multer.diskStorage({
  destination: path.resolve(__dirname, '../../../uploads'),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (_req, file, cb) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
  cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
}});

const router = Router();

router.get('/', authenticate, productController.list);
router.get('/:id', authenticate, productController.getById);
router.post('/', authenticate, authorize('admin', 'manager'), productController.create);
router.put('/:id', authenticate, authorize('admin', 'manager'), productController.update);
router.delete('/:id', authenticate, authorize('admin'), productController.remove);
router.post('/:id/image', authenticate, authorize('admin', 'manager'), upload.single('image'), productController.uploadImage);

export default router;
