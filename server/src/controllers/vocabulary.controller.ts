import type { Response } from 'express';
import { z } from 'zod';
import { VOCABULARY_KEYS, VOCABULARY_KEY_SET } from '@ofauria/shared';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { sectorRepository } from '../repositories/sector.repository.js';

/**
 * Paramètres › Secteur et modules › Vocabulaire (M8-03, mig 583).
 * Pour chaque terme du catalogue : valeur du secteur, renommage de la société, valeur effective.
 */
export const vocabularySchema = z.object({ value: z.string().trim().min(1, 'Terme vide').max(80) });

const bad = (res: Response, message: string, status = 400) => res.status(status).json({ success: false, error: { message } });

export const vocabularyController = {
  async list(_req: AuthRequest, res: Response) {
    const act = await sectorRepository.activation();
    const [sector, overrides] = await Promise.all([sectorRepository.sectorLabels(act.sector.code), sectorRepository.labelOverrides()]);
    const byKey = new Map(overrides.map(o => [o.label_key, o]));
    res.json({
      success: true,
      data: {
        sector: { code: act.sector.code, label: act.sector.label },
        items: VOCABULARY_KEYS.map(k => {
          const o = byKey.get(k.key);
          const sectorValue = sector[k.key] ?? null;
          return {
            ...k, sectorValue, override: o?.label_value ?? null,
            effective: o?.label_value ?? sectorValue ?? k.fallback,
            updatedAt: o?.updated_at ?? null, updatedBy: o?.updated_by_name ?? null,
          };
        }),
      },
    });
  },

  async set(req: AuthRequest, res: Response) {
    const key = req.params.key as string;
    if (!VOCABULARY_KEY_SET.has(key)) { bad(res, 'Terme inconnu', 404); return; }
    res.json({ success: true, data: await sectorRepository.setLabelOverride(key, req.body.value, req.user!.userId) });
  },

  async reset(req: AuthRequest, res: Response) {
    const key = req.params.key as string;
    if (!VOCABULARY_KEY_SET.has(key)) { bad(res, 'Terme inconnu', 404); return; }
    await sectorRepository.resetLabelOverride(key);
    res.json({ success: true, data: { key } });
  },
};
