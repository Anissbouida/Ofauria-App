import { Router } from 'express';
import type { Response } from 'express';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validateUuidParams } from '../middleware/validate.middleware.js';
import { findFile, readFile, canReadFile } from '../services/storage.service.js';

/**
 * G0-04 — lecture d'un fichier téléversé. Authentifiée, contrôle du droit sur
 * l'objet propriétaire, contenu renvoyé en flux : aucune URL publique.
 */
const router = Router();

router.get('/:id', authenticate, validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const file = await findFile(req.params.id);
  if (!file) { res.status(404).json({ success: false, error: { message: 'Fichier introuvable' } }); return; }
  if (!canReadFile(req.user!, file)) { res.status(403).json({ success: false, error: { message: 'Accès refusé à ce fichier' } }); return; }
  const data = await readFile(file);
  if (!data) {
    res.status(404).json({ success: false, error: { message: 'Fichier absent du stockage : à téléverser à nouveau' } });
    return;
  }
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Content-Length', String(data.length));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.original_name)}`);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.end(data);
}));

export default router;
