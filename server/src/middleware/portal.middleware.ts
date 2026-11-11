import type { Request, Response, NextFunction } from 'express';
import { customerPortalRepository } from '../repositories/customer-portal.repository.js';

/**
 * Phase 10.3 — authentification du portail client par jeton Bearer.
 * Comme l'API publique : pas de cookie, monté avant le contrôle anti-CSRF.
 * Attache l'identifiant du client au périmètre duquel tout est limité.
 */
export interface PortalRequest extends Request {
  portalCustomerId?: string;
}

export async function requirePortalToken(req: PortalRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization || '';
  const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const r = await customerPortalRepository.verify(raw);
  if (!r) {
    res.status(401).json({ success: false, error: 'Jeton de portail invalide ou révoqué' });
    return;
  }
  req.portalCustomerId = r.customerId;
  next();
}
