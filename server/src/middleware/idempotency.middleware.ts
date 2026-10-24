import type { Response, NextFunction } from 'express';
import type { AuthRequest } from './auth.middleware.js';
import { db } from '../config/database.js';

/**
 * Idempotence HTTP (refonte Achats D4, G-D4-19, mig 307).
 *
 * Le client envoie un en-tête `Idempotency-Key` (un uuid par soumission de formulaire).
 * Première requête : la clé est réservée, la réponse 2xx est mémorisée.
 * Requête rejouée (double clic, reprise réseau) : la réponse mémorisée est renvoyée telle
 * quelle, sans réexécuter l'action ; si la première est encore en cours, 409.
 * Sans en-tête, la route se comporte comme avant.
 */
export function idempotent() {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const key = req.header('Idempotency-Key');
    if (!key || !req.user) return next();
    if (!/^[A-Za-z0-9-]{8,80}$/.test(key)) {
      res.status(400).json({ success: false, error: { message: 'En-tête Idempotency-Key invalide' } });
      return;
    }
    const route = `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`;
    try {
      const ins = await db.query(
        `INSERT INTO idempotency_keys (key, user_id, route) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, key) DO NOTHING RETURNING key`,
        [key, req.user.userId, route],
      );
      if (!ins.rowCount) {
        const prev = await db.query(
          `SELECT route, response_status, response_body FROM idempotency_keys WHERE user_id = $1 AND key = $2`,
          [req.user.userId, key],
        );
        const row = prev.rows[0];
        if (row?.route !== route) {
          res.status(422).json({ success: false, error: { message: 'Clé d\'idempotence déjà utilisée pour une autre action' } });
          return;
        }
        if (row.response_status == null) {
          res.status(409).json({ success: false, error: { message: 'La même demande est déjà en cours de traitement' } });
          return;
        }
        res.status(row.response_status).json(row.response_body);
        return;
      }
    } catch (err) {
      return next(err);
    }

    // Mémorise la réponse finale ; une erreur libère la clé pour permettre une nouvelle tentative.
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      const status = res.statusCode;
      const save = status >= 200 && status < 300
        ? db.query(`UPDATE idempotency_keys SET response_status = $3, response_body = $4 WHERE user_id = $1 AND key = $2`,
            [req.user!.userId, key, status, JSON.stringify(body)])
        : db.query(`DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2`, [req.user!.userId, key]);
      save.catch(() => { /* la mémorisation ne doit jamais casser la réponse */ });
      return originalJson(body);
    };
    next();
  };
}
