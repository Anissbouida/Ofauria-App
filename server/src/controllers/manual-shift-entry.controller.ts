import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { manualShiftEntryRepository } from '../repositories/manual-shift-entry.repository.js';

/** Lecture seule (mig 415) : l'historique des saisies manuelles de caisse. */
export const manualShiftEntryController = {
  async list(req: AuthRequest, res: Response) {
    if (!req.user!.storeId) {
      res.status(400).json({ success: false, error: { message: 'Utilisateur non rattache a un magasin' } });
      return;
    }
    const { dateFrom, dateTo } = req.query as Record<string, string>;
    const rows = await manualShiftEntryRepository.findByDateRange({
      storeId: req.user!.storeId, dateFrom, dateTo,
    });
    res.json({ success: true, data: rows });
  },
};
