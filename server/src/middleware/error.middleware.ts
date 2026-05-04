import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

// Erreurs metier peuvent porter statusCode + code (ex: stock insuffisant -> 409).
type AppError = Error & { statusCode?: number; status?: number; code?: string };

const IS_PROD = (process.env.NODE_ENV || 'development') === 'production';

export function errorHandler(err: AppError, req: Request, res: Response, _next: NextFunction) {
  const status = err.statusCode ?? err.status ?? 500;
  const isClientError = status >= 400 && status < 500;

  // OWASP A09 : log structure avec redaction automatique (voir logger.ts).
  // 5xx = probleme serveur, log avec stack. 4xx = erreur client, log info.
  const context = {
    err: { message: err.message, name: err.name, code: err.code, stack: err.stack },
    req: { method: req.method, url: req.originalUrl },
    status,
  };
  if (!isClientError) {
    logger.error(context, 'Server error');
  } else {
    logger.warn(context, 'Client error');
  }

  res.status(status).json({
    success: false,
    error: {
      // Pour les erreurs metier (4xx), on renvoie le message (informatif, non-sensible).
      // Pour les 5xx en prod, message generique pour eviter la fuite d'info (CWE-209).
      message: isClientError
        ? err.message
        : (IS_PROD ? 'Erreur interne du serveur' : err.message),
      ...(err.code ? { code: err.code } : {}),
      // Stack trace JAMAIS exposee au client.
    },
  });
}
