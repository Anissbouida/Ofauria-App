import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const lossPhotoStorage = multer.diskStorage({
  destination: path.resolve(__dirname, '../../../uploads/losses'),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `loss-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});

const imageFilter = (_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowed = ['.png', '.jpg', '.jpeg', '.svg', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Format non supporte. Utilisez PNG, JPG, SVG ou WebP.'));
  }
};

// Le logo est genere sur les PDF (factures, bons de commande) par PDFKit, qui ne
// sait pas rendre le SVG : on limite donc le logo aux formats raster.
const logoFilter = (_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowed = ['.png', '.jpg', '.jpeg', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Format non supporte. Utilisez PNG, JPG ou WebP.'));
  }
};

// Stockage en memoire : le logo n'est pas ecrit sur le disque local (ephemere sur
// Cloud Run) mais renvoye en data URI base64 pour etre persiste en base
// (company_settings.logo_url) et donc disponible a la generation des PDF.
const uploadLogo = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: logoFilter });
const uploadLossPhoto = multer({ storage: lossPhotoStorage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: imageFilter });

const router = Router();

router.post('/logo', authenticate, authorize('admin'), uploadLogo.single('logo'), (req: AuthRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ success: false, error: { message: 'Aucun fichier envoye' } });
    return;
  }
  const mime = req.file.mimetype || 'image/png';
  const url = `data:${mime};base64,${req.file.buffer.toString('base64')}`;
  res.json({ success: true, data: { url } });
});

router.post('/loss-photo', authenticate, uploadLossPhoto.single('photo'), (req: AuthRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ success: false, error: { message: 'Aucune photo envoyee' } });
    return;
  }
  const url = `/uploads/losses/${req.file.filename}`;
  res.json({ success: true, data: { url } });
});

export default router;
