import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { storeRepository } from '../repositories/store.repository.js';

export const storeController = {
  async list(_req: AuthRequest, res: Response) {
    const stores = await storeRepository.findAll();
    res.json({ success: true, data: stores });
  },

  async getById(req: AuthRequest, res: Response) {
    const store = await storeRepository.findById(req.params.id);
    if (!store) { res.status(404).json({ success: false, error: { message: 'Point de vente non trouve' } }); return; }
    res.json({ success: true, data: store });
  },

  async create(req: AuthRequest, res: Response) {
    const { name, city, address, phone } = req.body;
    if (!name) { res.status(400).json({ success: false, error: { message: 'Nom requis' } }); return; }
    const store = await storeRepository.create({ name, city, address, phone });
    res.status(201).json({ success: true, data: store });
  },

  async update(req: AuthRequest, res: Response) {
    const { name, city, address, phone, isActive } = req.body;
    const store = await storeRepository.update(req.params.id, { name, city, address, phone, isActive });
    if (!store) { res.status(404).json({ success: false, error: { message: 'Point de vente non trouve' } }); return; }
    res.json({ success: true, data: store });
  },

  async remove(req: AuthRequest, res: Response) {
    await storeRepository.remove(req.params.id);
    res.json({ success: true, data: null });
  },
};
