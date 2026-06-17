import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { salesChannelRepository } from '../repositories/sales-channel.repository.js';

export const salesChannelController = {
  async list(_req: AuthRequest, res: Response) {
    const channels = await salesChannelRepository.list(true); // inclut inactifs pour admin
    res.json({ success: true, data: channels });
  },

  async listActive(_req: AuthRequest, res: Response) {
    const channels = await salesChannelRepository.list(false);
    res.json({ success: true, data: channels });
  },

  async create(req: AuthRequest, res: Response) {
    const { code, label, color, displayOrder, isDefault } = req.body || {};
    if (!code || !label) {
      res.status(400).json({ success: false, error: { message: 'code et label requis' } });
      return;
    }
    try {
      const channel = await salesChannelRepository.create({ code, label, color, displayOrder, isDefault });
      res.status(201).json({ success: true, data: channel });
    } catch (err: unknown) {
      const msg = (err as Error)?.message || 'Erreur';
      // unique violation sur code
      if (msg.includes('sales_channels_code_key') || msg.includes('duplicate')) {
        res.status(409).json({ success: false, error: { message: `Code "${code}" deja utilise` } });
        return;
      }
      throw err;
    }
  },

  async update(req: AuthRequest, res: Response) {
    const { label, color, displayOrder, isDefault, isActive } = req.body || {};
    const channel = await salesChannelRepository.update(req.params.id, { label, color, displayOrder, isDefault, isActive });
    if (!channel) {
      res.status(404).json({ success: false, error: { message: 'Canal non trouve' } });
      return;
    }
    res.json({ success: true, data: channel });
  },

  async deactivate(req: AuthRequest, res: Response) {
    try {
      await salesChannelRepository.deactivate(req.params.id);
      res.json({ success: true, data: null });
    } catch (err: unknown) {
      const msg = (err as Error)?.message || 'Erreur';
      if (msg.includes('defaut')) {
        res.status(400).json({ success: false, error: { message: msg } });
        return;
      }
      throw err;
    }
  },
};
