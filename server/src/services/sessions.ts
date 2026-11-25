import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import { generateToken, type TokenPayload } from '../utils/jwt.js';
import { userSessionRepository } from '../repositories/user-session.repository.js';
import { clientIp, clientUserAgent } from '../repositories/auth-event.repository.js';
import { logger } from '../utils/logger.js';

/**
 * Émission d'un jeton de connexion et enregistrement de la session (refonte Utilisateurs, lot 8,
 * mig 708). L'enregistrement ne bloque jamais la connexion : une erreur est seulement journalisée.
 * `createdAt` garde l'heure d'ouverture quand un jeton en remplace un autre (bascule d'établissement).
 */
export async function issueToken(req: Request | undefined, payload: TokenPayload, method: string, createdAt?: Date | null): Promise<string> {
  const token = generateToken(payload);
  const decoded = jwt.decode(token) as { jti?: string; exp?: number } | null;
  if (decoded?.jti && decoded.exp) {
    await userSessionRepository.open({
      jti: decoded.jti, userId: payload.userId, tokenVersion: payload.tokenVersion, storeId: payload.storeId ?? null,
      method, ip: req ? clientIp(req) : null, userAgent: req ? clientUserAgent(req) : null,
      expiresAt: new Date(decoded.exp * 1000), createdAt,
    }).catch(err => logger.warn({ err }, '[sessions] enregistrement de la session impossible'));
  }
  return token;
}

// Dernière activité : au plus une écriture par minute et par session.
const lastTouch = new Map<string, number>();
export function touchSession(jti: string | undefined): void {
  if (!jti) return;
  const now = Date.now();
  if ((lastTouch.get(jti) ?? 0) > now - 60_000) return;
  lastTouch.set(jti, now);
  if (lastTouch.size > 5000) for (const [k, t] of lastTouch) if (t < now - 120_000) lastTouch.delete(k);
  userSessionRepository.touch(jti).catch(() => undefined);
}
