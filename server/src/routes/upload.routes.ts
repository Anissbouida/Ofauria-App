import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const storage = multer.diskStorage({
  destination: path.resolve(__dirname, '../../../uploads/logos'),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `logo-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.svg', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Format non supporte. Utilisez PNG, JPG, SVG ou WebP.'));
    }
  },
});

const router = Router();

router.post('/logo', authenticate, authorize('admin'), upload.single('logo'), (req: AuthRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ success: false, error: { message: 'Aucun fichier envoye' } });
    return;
  }
  const url = `/uploads/logos/${req.file.filename}`;
  res.json({ success: true, data: { url } });
});

export default router;
