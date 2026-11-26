import type { Request, Response, NextFunction } from 'express';
import { sectorRepository } from '../repositories/sector.repository.js';

/**
 * Audit des profils (R3) : garde d'activation pour les routeurs montés AVANT la garde générale
 * (API publique, portail client). Une commande publique ne crée plus de commande ni de plan de
 * production pour une société qui n'a pas le module ; le portail ne montre pas de commandes.
 */
export function requireModule(module: string) {
  return async (_req: Request, res: Response, next: NextFunction) => {
    try {
      if (await sectorRepository.moduleOn(module)) { next(); return; }
      res.status(403).json({ success: false, error: { code: 'MODULE_DISABLED', message: 'Ce module est désactivé pour la société' } });
    } catch (err) { next(err); }
  };
}
