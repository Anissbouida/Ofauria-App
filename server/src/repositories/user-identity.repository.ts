import { db } from '../config/database.js';

/**
 * Identités externes (G6-02). Une identité déjà connue désigne son compte ; sinon elle se
 * rattache, par l'e-mail vérifié du fournisseur, à un compte existant et ACTIF (jamais de
 * création automatique). Rend null si aucun compte ne correspond.
 */
export const userIdentityRepository = {
  async resolve(provider: 'google' | 'microsoft', subject: string, email: string) {
    const known = (await db.query(
      `SELECT u.* FROM user_identities i JOIN users u ON u.id = i.user_id WHERE i.provider = $1 AND i.subject = $2`, [provider, subject])).rows[0];
    if (known) {
      if (!known.is_active) return null;
      await db.query(`UPDATE user_identities SET last_login_at = NOW(), email = $3 WHERE provider = $1 AND subject = $2`, [provider, subject, email]);
      return known;
    }
    const user = (await db.query(`SELECT * FROM users WHERE lower(email) = lower($1) AND is_active`, [email])).rows[0];
    if (!user) return null;
    await db.query(
      `INSERT INTO user_identities (user_id, provider, subject, email, last_login_at) VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (provider, subject) DO NOTHING`, [user.id, provider, subject, email]);
    return user;
  },
};
