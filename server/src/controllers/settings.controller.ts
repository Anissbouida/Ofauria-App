import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { settingsRepository } from '../repositories/settings.repository.js';

function toApi(row: Record<string, unknown>) {
  return {
    companyName: row.company_name,
    subtitle: row.subtitle,
    primaryColor: row.primary_color,
    secondaryColor: row.secondary_color,
    logoUrl: row.logo_url,
  };
}

export const settingsController = {
  async get(_req: AuthRequest, res: Response) {
    const settings = await settingsRepository.get();
    res.json({ success: true, data: toApi(settings) });
  },

  async update(req: AuthRequest, res: Response) {
    const { companyName, subtitle, primaryColor, secondaryColor, logoUrl } = req.body;
    if (primaryColor && !/^#[0-9a-fA-F]{6}$/.test(primaryColor)) {
      res.status(400).json({ success: false, error: { message: 'Couleur primaire invalide (format #RRGGBB)' } });
      return;
    }
    if (secondaryColor && !/^#[0-9a-fA-F]{6}$/.test(secondaryColor)) {
      res.status(400).json({ success: false, error: { message: 'Couleur secondaire invalide (format #RRGGBB)' } });
      return;
    }
    const settings = await settingsRepository.update({ companyName, subtitle, primaryColor, secondaryColor, logoUrl });
    res.json({ success: true, data: toApi(settings) });
  },
};
