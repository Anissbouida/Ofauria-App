import crypto from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

/**
 * G0-02 (plan d'action 2026-11) — limiteurs de débit des surfaces exposées.
 *
 *  - API publique  : par CLÉ D'API (repli sur l'IP sans clé), 120 requêtes / minute ;
 *  - portail client : par adresse IP, 60 / minute ;
 *  - /api/v1        : dernier recours par IP, seuil large (1 200 / minute).
 *
 * Seuils réglables par variable d'environnement ; 0 désactive le limiteur.
 *   RATE_LIMIT_PUBLIC_PER_MIN, RATE_LIMIT_PORTAL_PER_MIN, RATE_LIMIT_GLOBAL_PER_MIN
 */
const WINDOW_MS = 60 * 1000;

function threshold(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const passThrough: RequestHandler = (_req, _res, next) => next();
const byIp = (req: Request) => ipKeyGenerator(req.ip ?? '');

/** Clé d'API hachée (jamais la clé en clair en mémoire du limiteur) ; sans clé : l'IP. */
export function apiKeyOrIp(req: Request): string {
  const header = req.headers.authorization || '';
  const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!raw) return `ip:${byIp(req)}`;
  return `key:${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32)}`;
}

export function makeLimiter(max: number, keyGenerator: (req: Request) => string, message: string): RequestHandler {
  if (max <= 0) return passThrough;
  return rateLimit({
    windowMs: WINDOW_MS,
    max,
    keyGenerator,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { message } },
  });
}

export const publicApiLimiter = makeLimiter(
  threshold('RATE_LIMIT_PUBLIC_PER_MIN', 120), apiKeyOrIp,
  'Trop de requêtes pour cette clé d\'API. Réessayez dans une minute.');

export const portalLimiter = makeLimiter(
  threshold('RATE_LIMIT_PORTAL_PER_MIN', 60), byIp,
  'Trop de requêtes. Réessayez dans une minute.');

export const globalApiLimiter = makeLimiter(
  threshold('RATE_LIMIT_GLOBAL_PER_MIN', 1200), byIp,
  'Trop de requêtes. Réessayez dans une minute.');
