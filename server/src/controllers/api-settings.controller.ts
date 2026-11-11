import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { apiKeyRepository } from '../repositories/api-key.repository.js';
import { webhookRepository } from '../repositories/webhook.repository.js';

/**
 * Phase 10.2 — gestion (direction) des clés d'API et des webhooks, dans les
 * Paramètres. La clé et le secret ne sont renvoyés EN CLAIR qu'à la création.
 */
export const apiSettingsController = {
  async listKeys(_req: AuthRequest, res: Response): Promise<void> {
    res.json({ success: true, data: await apiKeyRepository.list() });
  },

  async createKey(req: AuthRequest, res: Response): Promise<void> {
    const { label, scopes, storeId } = (req.body ?? {}) as { label?: string; scopes?: unknown; storeId?: string };
    if (!label) { res.status(400).json({ success: false, error: 'Libellé requis' }); return; }
    const data = await apiKeyRepository.create({
      label,
      scopes: Array.isArray(scopes) ? (scopes as string[]) : [],
      storeId: storeId ?? null,
      createdBy: req.user?.userId ?? null,
    });
    res.status(201).json({ success: true, data }); // `data.key` : la clé en clair, une seule fois.
  },

  async revokeKey(req: AuthRequest, res: Response): Promise<void> {
    await apiKeyRepository.revoke(req.params.id);
    res.json({ success: true });
  },

  async listWebhooks(_req: AuthRequest, res: Response): Promise<void> {
    res.json({ success: true, data: await webhookRepository.listEndpoints() });
  },

  async createWebhook(req: AuthRequest, res: Response): Promise<void> {
    const { label, url, events } = (req.body ?? {}) as { label?: string; url?: string; events?: unknown };
    if (!label || !url) { res.status(400).json({ success: false, error: 'Libellé et URL requis' }); return; }
    const data = await webhookRepository.createEndpoint({
      label, url,
      events: Array.isArray(events) ? (events as string[]) : [],
      createdBy: req.user?.userId ?? null,
    });
    res.status(201).json({ success: true, data }); // `data.secret` : le secret HMAC, une seule fois.
  },

  async setWebhookActive(req: AuthRequest, res: Response): Promise<void> {
    await webhookRepository.setActive(req.params.id, (req.body as { active?: boolean })?.active !== false);
    res.json({ success: true });
  },

  async removeWebhook(req: AuthRequest, res: Response): Promise<void> {
    await webhookRepository.removeEndpoint(req.params.id);
    res.json({ success: true });
  },
};
