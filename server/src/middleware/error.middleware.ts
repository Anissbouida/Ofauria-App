import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

// Erreurs metier peuvent porter statusCode + code (ex: stock insuffisant -> 409).
type AppError = Error & { statusCode?: number; status?: number; code?: string };

const IS_PROD = (process.env.NODE_ENV || 'development') === 'production';

export function errorHandler(err: AppError, req: Request, res: Response, _next: NextFunction) {
  // Règles métier levées par la base (RAISE ... USING ERRCODE = 'OF409', mig 305) :
  // conflit d'état, message destiné à l'utilisateur.
  // Contraintes d'unicité métier connues : message clair plutôt qu'une erreur de base (mig 309).
  const constraint = (err as { constraint?: string }).constraint;
  const UNIQUE_MESSAGES: Record<string, string> = {
    uq_invoices_supplier_number: 'Ce numéro de facture est déjà enregistré pour ce fournisseur.',
    uq_invoices_one_active_per_po: 'Ce bon de commande a déjà une facture active.',
    uq_payments_instrument_per_invoice: 'Ce chèque ou cet effet règle déjà cette facture.',
    uq_payments_voids_once: 'Ce paiement est déjà annulé.',
  };
  if (err.code === '23505' && constraint && UNIQUE_MESSAGES[constraint]) {
    err.message = UNIQUE_MESSAGES[constraint];
    err.statusCode = 409;
  }
  const status = err.statusCode ?? err.status ?? (err.code === 'OF409' ? 409 : 500);
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
