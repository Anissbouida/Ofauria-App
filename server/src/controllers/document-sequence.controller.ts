import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { documentSequenceRepository, validatePattern, type ResetPeriod } from '../repositories/document-sequence.repository.js';

const RESETS: ResetPeriod[] = ['never', 'year', 'month', 'day'];

function readBody(body: Record<string, unknown>) {
  const pattern = typeof body.pattern === 'string' ? body.pattern.trim() : '';
  const padding = Number(body.padding);
  const resetPeriod = (RESETS as string[]).includes(String(body.resetPeriod)) ? body.resetPeriod as ResetPeriod : null;
  return { pattern, padding, resetPeriod };
}

/** Séries de numéros des pièces (Paramètres › Numérotation, mig 329). */
export const documentSequenceController = {
  async list(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: await documentSequenceRepository.list() });
  },

  /** Aperçu d'un modèle avant enregistrement. */
  async preview(req: AuthRequest, res: Response) {
    const { pattern, padding, resetPeriod } = readBody(req.body ?? {});
    const error = resetPeriod ? validatePattern(pattern, padding, resetPeriod) : 'Remise à zéro invalide.';
    if (error) { res.json({ success: true, data: { valid: false, error } }); return; }
    res.json({ success: true, data: { valid: true, sample: await documentSequenceRepository.sample(pattern, padding) } });
  },

  async update(req: AuthRequest, res: Response) {
    if (!(await documentSequenceRepository.exists(req.params.docType))) {
      res.status(404).json({ success: false, error: { message: 'Série inconnue' } });
      return;
    }
    const { pattern, padding, resetPeriod } = readBody(req.body ?? {});
    if (!resetPeriod) { res.status(400).json({ success: false, error: { message: 'Remise à zéro invalide.' } }); return; }
    const error = validatePattern(pattern, padding, resetPeriod);
    if (error) { res.status(400).json({ success: false, error: { message: error } }); return; }
    const row = await documentSequenceRepository.update(req.params.docType, { pattern, padding, resetPeriod }, req.user?.userId);
    res.json({ success: true, data: row });
  },
};
