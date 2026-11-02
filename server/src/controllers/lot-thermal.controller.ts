import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { lotThermalRepository } from '../repositories/lot-thermal.repository.js';

export const lotThermalController = {
  async freeze(req: AuthRequest, res: Response) {
    const lot = await lotThermalRepository.freeze(req.params.kind as string, req.params.id as string);
    if (!lot) { res.status(404).json({ success: false, error: { message: 'Lot non trouvé' } }); return; }
    res.json({ success: true, data: lot });
  },

  async thaw(req: AuthRequest, res: Response) {
    const h = req.body?.dureeVieHeures;
    const dureeVieHeures = typeof h === 'number' && Number.isFinite(h) ? h : null;
    const lot = await lotThermalRepository.thaw(req.params.kind as string, req.params.id as string, dureeVieHeures);
    if (!lot) { res.status(404).json({ success: false, error: { message: 'Lot non trouvé' } }); return; }
    res.json({ success: true, data: lot });
  },
};
