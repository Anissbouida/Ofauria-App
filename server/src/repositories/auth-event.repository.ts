import type { Request } from 'express';
import { db } from '../config/database.js';
import { logger } from '../utils/logger.js';

/**
 * OWASP A09-2 : repository d'evenements d'auth pour l'audit trail.
 *
 * Types d'evenements standards :
 *   login_success            -- connexion par email/password
 *   login_failed             -- echec login (user inconnu ou password invalide)
 *   pin_login_success        -- connexion par PIN
 *   pin_login_failed         -- echec PIN
 *   account_locked           -- seuil d'echecs atteint, compte verrouille
 *   logout                   -- revocation volontaire du token
 *   user_created             -- creation de compte (par admin)
 *   user_updated             -- modification compte (role/store/active)
 *   permission_changed       -- modification des permissions fines
 *   token_revoked            -- token revoque par admin (futur)
 */
export type AuthEventType =
  | 'login_success'
  | 'login_failed'
  | 'pin_login_success'
  | 'pin_login_failed'
  | 'account_locked'
  | 'logout'
  | 'user_created'
  | 'user_updated'
  | 'permission_changed'
  | 'token_revoked';

export interface AuthEventInput {
  eventType: AuthEventType;
  userId?: string | null;
  targetUserId?: string | null;
  email?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  success?: boolean;
  details?: Record<string, unknown>;
}

function clientIp(req: Request): string | null {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || null;
}

function clientUserAgent(req: Request): string | null {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, 500) : null;
}

export const authEventRepository = {
  async record(input: AuthEventInput): Promise<void> {
    try {
      await db.query(
        `INSERT INTO auth_events
          (event_type, user_id, target_user_id, email, ip, user_agent, success, details)
         VALUES ($1, $2, $3, $4, $5::inet, $6, $7, $8)`,
        [
          input.eventType,
          input.userId ?? null,
          input.targetUserId ?? null,
          input.email ?? null,
          input.ip ?? null,
          input.userAgent ?? null,
          input.success ?? true,
          input.details ? JSON.stringify(input.details) : null,
        ]
      );
    } catch (err) {
      // Un echec d'audit ne doit JAMAIS casser un flow metier.
      // On log au logger structure pour ne pas perdre l'event.
      logger.error({ err, event: input }, 'auth_event insert failed');
    }
  },

  /**
   * Helper pour enregistrer un evenement en extrayant automatiquement
   * IP et user-agent de la requete Express.
   */
  async recordFromRequest(req: Request, input: Omit<AuthEventInput, 'ip' | 'userAgent'>): Promise<void> {
    return this.record({ ...input, ip: clientIp(req), userAgent: clientUserAgent(req) });
  },
};
