import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

/**
 * OWASP A08 CSRF Origin/Referer check.
 *
 * Avec SameSite=Strict sur le cookie d'auth, la plupart des CSRF sont deja
 * bloques par le navigateur. Ce middleware est une defense en profondeur :
 * pour toute requete mutante (POST/PUT/PATCH/DELETE), on exige que l'Origin
 * (ou Referer si Origin absent) soit dans la liste d'origines autorisees.
 *
 * Les requetes mobiles Capacitor envoient Origin=capacitor://localhost,
 * qui est dans allowedOrigins. Les requetes serveur-a-serveur sans Origin
 * sont refusees (sauf GET, deja exemptes).
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function originCheck(allowedOrigins: string[]) {
  const allowedSet = new Set(allowedOrigins);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    // Source primaire : Origin header (envoye par les navigateurs modernes
    // sur toute requete cross-origin + tous les POSTs).
    const origin = req.headers.origin;
    if (origin && allowedSet.has(origin)) {
      next();
      return;
    }

    // Fallback : Referer (certains clients/proxy stripent Origin).
    const referer = req.headers.referer;
    if (referer) {
      try {
        const refOrigin = new URL(referer).origin;
        if (allowedSet.has(refOrigin)) {
          next();
          return;
        }
      } catch {
        // URL invalide, on rejette.
      }
    }

    // Pas d'Origin ni de Referer acceptables : CSRF probable.
    logger.warn(
      { method: req.method, url: req.originalUrl, origin, referer, ip: req.ip },
      'CSRF: Origin/Referer check failed',
    );
    res.status(403).json({
      success: false,
      error: { message: 'Origine requete non autorisee' },
    });
  };
}
