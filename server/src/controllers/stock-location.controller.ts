import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { stockLocationRepository } from '../repositories/stock-location.repository.js';
import { createStockLocationSchema, updateStockLocationSchema } from '../validators/stock-location.validator.js';

const badRequest = (res: Response, msg: string) =>
  res.status(400).json({ success: false, error: { message: msg } });

export const stockLocationController = {
  async list(req: AuthRequest, res: Response) {
    const storeId = (req.query.storeId as string) || null;
    const includeInactive = req.query.includeInactive === 'true';
    const rows = await stockLocationRepository.list(storeId, includeInactive);
    res.json({ success: true, data: rows });
  },

  async create(req: AuthRequest, res: Response) {
    const parsed = createStockLocationSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.issues.map(i => i.message).join(', '));
    try {
      const row = await stockLocationRepository.create(parsed.data);
      res.status(201).json({ success: true, data: row });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return res.status(409).json({ success: false, error: { message: 'Ce code d\'emplacement existe déjà pour ce magasin.' } });
      throw e;
    }
  },

  async update(req: AuthRequest, res: Response) {
    const parsed = updateStockLocationSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.issues.map(i => i.message).join(', '));
    try {
      const row = await stockLocationRepository.update(req.params.id as string, parsed.data);
      if (!row) return res.status(404).json({ success: false, error: { message: 'Emplacement non trouvé' } });
      res.json({ success: true, data: row });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return res.status(409).json({ success: false, error: { message: 'Ce code d\'emplacement existe déjà pour ce magasin.' } });
      throw e;
    }
  },

  async deactivate(req: AuthRequest, res: Response) {
    const row = await stockLocationRepository.deactivate(req.params.id as string);
    if (!row) return res.status(404).json({ success: false, error: { message: 'Emplacement non trouvé' } });
    res.json({ success: true, data: row });
  },
};
