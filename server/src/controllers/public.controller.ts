import type { Response } from 'express';
import type { PublicApiRequest } from '../middleware/api-key.middleware.js';
import { db } from '../config/database.js';
import { createPublicOrder } from '../services/public-order.service.js';
import { IDEMPOTENCY_KEY_RE } from '../validators/public-order.validator.js';

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
        WHERE COALESCE(is_available, true) ORDER BY name LIMIT 500`)).rows;
    res.json({ success: true, data: rows });
  },

  /**
   * G0-01 : en-tête Idempotency-Key facultatif. Une clé déjà vue pour cette clé
   * d'API renvoie la réponse enregistrée ; une requête identique encore en cours
   * reçoit 409. Un refus métier (400/409) libère la clé pour une nouvelle tentative.
   */
  async createOrder(req: PublicApiRequest, res: Response): Promise<void> {
    const apiKey = req.apiKey!;
    const idem = req.header('Idempotency-Key')?.trim() || null;
    if (idem && !IDEMPOTENCY_KEY_RE.test(idem)) {
      res.status(400).json({ success: false, error: 'Idempotency-Key invalide (8 à 200 caractères)' });
      return;
    }
    if (idem) {
      const ins = await db.query(
        `INSERT INTO api_idempotency_keys (api_key_id, key) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING key`,
        [apiKey.id, idem]);
      if (!ins.rows.length) {
        const prev = (await db.query(
          `SELECT status_code, response_body FROM api_idempotency_keys WHERE api_key_id = $1 AND key = $2`, [apiKey.id, idem])).rows[0];
        if (prev?.response_body) {
          res.setHeader('Idempotent-Replayed', 'true');
          res.status(prev.status_code ?? 201).json(prev.response_body);
          return;
        }
        res.status(409).json({ success: false, error: 'Une requête avec cette clé d\'idempotence est déjà en cours' });
        return;
      }
    }
    const release = async () => {
      if (!idem) return;
      await db.query(`DELETE FROM api_idempotency_keys WHERE api_key_id = $1 AND key = $2`, [apiKey.id, idem]).catch(() => undefined);
    };
    let r: Awaited<ReturnType<typeof createPublicOrder>>;
    try {
      r = await createPublicOrder(apiKey, req.body ?? {});
    } catch (err) {
      await release();
      throw err;
    }
    if ('error' in r) {
      await release();
      res.status(r.status ?? 400).json({ success: false, error: r.error });
      return;
    }
    const body = { success: true, data: r };
    if (idem) {
      await db.query(
        `UPDATE api_idempotency_keys SET status_code = 201, response_body = $3 WHERE api_key_id = $1 AND key = $2`,
        [apiKey.id, idem, JSON.stringify(body)]);
    }
    res.status(201).json(body);
  },
};
