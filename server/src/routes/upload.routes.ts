import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorizeSettings } from '../middleware/settings-access.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { storeFile, FileRejectedError, type FileOwnerType } from '../services/storage.service.js';
import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { uploadFileSchema } from '../validators/upload.validator.js';

// G0-04 : plus de SVG (contenu actif possible) ; le type réel est vérifié sur les
// premiers octets par storeFile, l'extension n'est qu'un premier tri.
const imageFilter = (_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowed = ['.png', '.jpg', '.jpeg', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Format non supporte. Utilisez PNG, JPG ou WebP.'));
  }
};

// Le logo est genere sur les PDF (factures, bons de commande) par PDFKit, qui ne
// sait pas rendre le SVG : on limite donc le logo aux formats raster.
const logoFilter = imageFilter;

// Stockage en memoire : le logo n'est pas ecrit sur le disque local (ephemere sur
// Cloud Run) mais renvoye en data URI base64 pour etre persiste en base
// (company_settings.logo_url) et donc disponible a la generation des PDF.
const uploadLogo = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: logoFilter });
// G0-04 : photos de pertes et de réclamations en mémoire, puis dans le stockage
// objet (table files) — plus rien sur le disque du serveur.
const uploadPhoto = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: imageFilter });

const router = Router();

router.post('/logo', authenticate, authorizeSettings('appearance', 'edit'), uploadLogo.single('logo'), validate(uploadFileSchema), (req: AuthRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ success: false, error: { message: 'Aucun fichier envoye' } });
    return;
  }
  const mime = req.file.mimetype || 'image/png';
  const url = `data:${mime};base64,${req.file.buffer.toString('base64')}`;
  res.json({ success: true, data: { url } });
});

const photoHandler = (ownerType: FileOwnerType) => asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ success: false, error: { message: 'Aucune photo envoyee' } });
    return;
  }
  try {
    const stored = await storeFile({
      buffer: req.file.buffer, originalName: req.file.originalname, ownerType,
      storeId: req.user?.storeId ?? null, uploadedBy: req.user?.userId ?? null,
    });
    res.json({ success: true, data: { url: stored.url, fileId: stored.id } });
  } catch (err) {
    if (err instanceof FileRejectedError) { res.status(400).json({ success: false, error: { message: err.message } }); return; }
    throw err;
  }
});

router.post('/loss-photo', authenticate, uploadPhoto.single('photo'), validate(uploadFileSchema), photoHandler('loss'));
router.post('/complaint-photo', authenticate, uploadPhoto.single('photo'), validate(uploadFileSchema), photoHandler('complaint'));

export default router;
