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
    // C11 — Si la generation ledger a echoue, on repond 207 Multi-Status pour
    // que l'UI puisse signaler la desynchronisation sans considerer l'appel OK.
    if (row?.ledger_status === 'failed') {
      res.status(207).json({
        success: true,
        data: row,
        warning: {
          code: 'LEDGER_SYNC_FAILED',
          message: `Saisie enregistree mais ecriture comptable en echec : ${row.ledger_error}`,
        },
      });
      return;
    }
    res.json({ success: true, data: row });
  },

  // C12 — Route DELETE : avant, la seule facon de "supprimer" une saisie sur
  // un mauvais jour etait de l'ecraser via PUT. Le repo.delete() etait
  // exhaustif (reverse ledger + re-comptabilisation POS) mais inutilise.
  async remove(req: AuthRequest, res: Response) {
    if (!req.user!.storeId) {
      res.status(400).json({ success: false, error: { message: 'Utilisateur non rattache a un magasin' } });
      return;
    }
    const { entryDate } = req.params;
    if (!entryDate || !DATE_RE.test(entryDate)) {
      res.status(400).json({ success: false, error: { message: 'Date invalide (format attendu YYYY-MM-DD)' } });
      return;
    }
    await manualShiftEntryRepository.delete(req.user!.storeId, entryDate);
    res.json({ success: true, data: null });
  },
};
