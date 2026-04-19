import type { Request, Response, NextFunction } from 'express';

// Erreurs metier peuvent porter statusCode + code (ex: stock insuffisant -> 409).
type AppError = Error & { statusCode?: number; status?: number; code?: string };

const IS_PROD = (process.env.NODE_ENV || 'development') === 'production';

export function errorHandler(err: AppError, _req: Request, res: Response, _next: NextFunction) {
  const status = err.statusCode ?? err.status ?? 500;
  const isClientError = status >= 400 && status < 500;

  // Log interne (stdout), jamais expose au client.
  if (!isClientError) {
    console.error('Error:', err.message, err.stack);
  } else {
    console.warn('Client error:', status, err.message);
  }

  res.status(status).json({
    success: false,
    error: {
      // Pour les erreurs metier (4xx), on renvoie le message (informatif, non-sensible).
      // Pour les 5xx en prod, message generique pour eviter la fuite d'info (A05/A09).
      message: isClientError
        ? err.message
        : (IS_PROD ? 'Erreur interne du serveur' : err.message),
      ...(err.code ? { code: err.code } : {}),
      // Stack trace uniquement en dev.
      ...(!IS_PROD && !isClientError ? { stack: err.stack } : {}),
    },
  });
}
