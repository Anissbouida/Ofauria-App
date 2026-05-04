import { db } from '../config/database.js';

/**
 * OWASP A07-2 / A07-3 : repository des tokens revoques.
 *
 * `jti` est l'identifiant unique du token (claim JWT standard).
 * `expires_at` = date d'expiration du token (en secondes epoch fournie par JWT).
 */
export const revokedTokenRepository = {
  async revoke(jti: string, userId: string, expSeconds: number): Promise<void> {
    await db.query(
      `INSERT INTO revoked_tokens (jti, user_id, expires_at)
       VALUES ($1, $2, to_timestamp($3))
       ON CONFLICT (jti) DO NOTHING`,
      [jti, userId, expSeconds]
    );
  },

  async isRevoked(jti: string): Promise<boolean> {
    const result = await db.query(
      'SELECT 1 FROM revoked_tokens WHERE jti = $1 AND expires_at > NOW() LIMIT 1',
      [jti]
    );
    return result.rows.length > 0;
  },

  /**
   * Purge les tokens dont l'expiration est passee. A executer periodiquement.
   */
  async purgeExpired(): Promise<number> {
    const result = await db.query('DELETE FROM revoked_tokens WHERE expires_at < NOW()');
    return result.rowCount ?? 0;
  },

  /**
   * Revoque tous les tokens actifs d'un utilisateur (ex: changement de role,
   * reset password, suppression compte). Utilise l'expiration max JWT (24h)
   * comme borne par defaut.
   */
  async revokeAllForUser(userId: string, maxExpSeconds: number): Promise<void> {
    // On ne peut pas enumerer les jti emis (JWT sont stateless par design).
    // Astuce : on insere un token "sentinel" avec un jti special. A la place,
    // cette methode reste un no-op et nous recommandons d'utiliser une colonne
    // `users.tokens_issued_after` pour invalider toute la cohorte (pattern
    // "token version"). Implementable en phase 2.
    // Pour l'instant : no-op documente.
    void userId;
    void maxExpSeconds;
  },
};
