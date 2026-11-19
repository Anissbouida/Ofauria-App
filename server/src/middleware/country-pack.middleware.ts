import type { Request, Response, NextFunction } from 'express';
import { declarativeFormatAvailable, declarativeFormatRefusal } from '../services/country-pack.js';

/**
 * Formats déclaratifs propres à un pays (G6-06) : e-BDS Damancom, EDI SIMPL de la DGI,
 * liasse fiscale… restent marocains. Si le pack du pays actif de la société ne porte pas
 * le format, la route répond 400 avec un message explicite au lieu de produire un fichier
 * marocain pour une société d'un autre pays.
 */
export function requireDeclarativeFormat(format: string, label: string) {
  return async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { ok, country } = await declarativeFormatAvailable(format);
      if (!ok) {
        res.status(400).json({ success: false, error: { message: declarativeFormatRefusal(label, country), code: 'COUNTRY_FORMAT_UNAVAILABLE' } });
        return;
      }
      next();
    } catch (err) { next(err); }
  };
}
