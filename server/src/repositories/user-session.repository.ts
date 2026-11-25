import { db } from '../config/database.js';

/**
 * Sessions et appareils (refonte Utilisateurs, lot 8, mig 708) : une ligne par jeton émis.
 * Une session est active tant qu'elle n'est pas fermée, pas expirée, et que la version de jeton du
 * compte n'a pas changé (fermeture de toutes les sessions, changement de droits).
 */
export interface SessionRow {
  jti: string;
  method: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  store_name: string | null;
}

export const userSessionRepository = {
  async open(s: {
    jti: string; userId: string; tokenVersion: number; storeId: string | null; method: string;
    ip: string | null; userAgent: string | null; expiresAt: Date; createdAt?: Date | null;
  }): Promise<void> {
    await db.query(
      `INSERT INTO user_sessions (jti, user_id, token_version, store_id, method, ip, user_agent, created_at, last_seen_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, now()), now(), $9)
       ON CONFLICT (jti) DO NOTHING`,
      [s.jti, s.userId, s.tokenVersion, s.storeId, s.method.slice(0, 20), s.ip?.slice(0, 64) ?? null,
        s.userAgent?.slice(0, 400) ?? null, s.createdAt ?? null, s.expiresAt]);
  },

  async touch(jti: string): Promise<void> {
    await db.query(`UPDATE user_sessions SET last_seen_at = now() WHERE jti = $1 AND revoked_at IS NULL`, [jti]);
  },

  async find(jti: string): Promise<{ jti: string; user_id: string; method: string | null; expires_at: Date; created_at: Date; revoked_at: Date | null } | null> {
    return (await db.query(`SELECT jti, user_id, method, expires_at, created_at, revoked_at FROM user_sessions WHERE jti = $1`, [jti])).rows[0] ?? null;
  },

  async revoke(jti: string, reason: string): Promise<void> {
    await db.query(`UPDATE user_sessions SET revoked_at = now(), revoked_reason = $2 WHERE jti = $1 AND revoked_at IS NULL`, [jti, reason.slice(0, 30)]);
  },

  async revokeAllForUser(userId: string, reason: string): Promise<void> {
    await db.query(`UPDATE user_sessions SET revoked_at = now(), revoked_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL`, [userId, reason.slice(0, 30)]);
  },

  /** Sessions encore actives du compte, la plus récente d'abord. */
  async listActive(userId: string): Promise<SessionRow[]> {
    return (await db.query(
      `SELECT s.jti, s.method, s.ip, s.user_agent, s.created_at, s.last_seen_at, s.expires_at, st.name AS store_name
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN stores st ON st.id = s.store_id
        WHERE s.user_id = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
          AND s.token_version = COALESCE(u.token_version, 0)
        ORDER BY s.last_seen_at DESC`, [userId])).rows;
  },
};
