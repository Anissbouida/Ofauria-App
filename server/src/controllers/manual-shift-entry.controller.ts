import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { manualShiftEntryRepository } from '../repositories/manual-shift-entry.repository.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

  async upsert(req: AuthRequest, res: Response) {
    if (!req.user!.storeId) {
      res.status(400).json({ success: false, error: { message: 'Utilisateur non rattache a un magasin' } });
      return;
    }
    const { entryDate, ...rest } = req.body || {};
    if (!entryDate || !DATE_RE.test(String(entryDate))) {
      res.status(400).json({ success: false, error: { message: 'Date invalide (format attendu YYYY-MM-DD)' } });
      return;
    }
    const row = await manualShiftEntryRepository.upsert({
      storeId: req.user!.storeId,
      entryDate,
      userId: req.user!.userId,
      data: rest,
    });
    res.json({ success: true, data: row });
  },
};
