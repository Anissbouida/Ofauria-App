import type { Request, Response, NextFunction } from 'express';
import { apiKeyRepository, type ApiKeyRow } from '../repositories/api-key.repository.js';

/**
 * Phase 10.2 — authentification de l'API publique par clé Bearer.
 *
 * Distincte de l'app interne (cookie + JWT) : aucune session, aucun cookie,
 * donc ces routes sont montées AVANT le contrôle anti-CSRF (comme /cron/tick).
 * La portée (`scopes`) est vérifiée ici, route par route.
 */

export interface PublicApiRequest extends Request {
  apiKey?: ApiKeyRow;
}

export function requireApiKey(...scopes: string[]) {
  return async (req: PublicApiRequest, res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization || '';
    const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const key = await apiKeyRepository.verify(raw);
    if (!key) {
      res.status(401).json({ success: false, error: 'Clé API invalide ou révoquée' });
      return;
    }
    const granted = key.scopes || [];
    if (!scopes.every(s => granted.includes(s))) {
      res.status(403).json({ success: false, error: 'Portée insuffisante pour cette opération' });
      return;
    }
    req.apiKey = key;
    next();
  };
}
