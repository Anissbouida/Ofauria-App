import type { Response } from 'express';
import type { PublicApiRequest } from '../middleware/api-key.middleware.js';
import { db } from '../config/database.js';
import { createPublicOrder } from '../services/public-order.service.js';

/**
 * Phase 10.2 — contrôleur de l'API publique (site marchand).
 * Surface minimale : vérifier l'accès, lister les articles vendables, créer une
 * commande. Tout est porté par la clé Bearer (req.apiKey), jamais une session.
 */
export const publicApiController = {
  async ping(req: PublicApiRequest, res: Response): Promise<void> {
    res.json({ success: true, data: { ok: true, key: req.apiKey?.label, scopes: req.apiKey?.scopes ?? [] } });
  },

  async listProducts(_req: PublicApiRequest, res: Response): Promise<void> {
    const rows = (await db.query(
      `SELECT id, name, price, item_kind FROM products
        WHERE COALESCE(is_active, true) ORDER BY name LIMIT 500`)).rows;
    res.json({ success: true, data: rows });
  },

  async createOrder(req: PublicApiRequest, res: Response): Promise<void> {
    const r = await createPublicOrder(req.apiKey!, req.body ?? {});
    if ('error' in r) { res.status(400).json({ success: false, error: r.error }); return; }
    res.status(201).json({ success: true, data: r });
  },
};
