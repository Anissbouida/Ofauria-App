import crypto from 'crypto';
import { db } from '../config/database.js';

/**
 * Phase 10.3 — jetons d'accès au portail client.
 *
 * Un jeton est rattaché à un client. Comme les clés d'API : seul le hash est
 * stocké, le jeton en clair n'est renvoyé qu'à l'émission, la vérification
 * compare en temps constant. Un seul jeton actif par client (l'émission révoque
 * le précédent).
 *
 * G0-03 (mig 520) : le jeton expire (30, 90 ou 365 jours, 90 par défaut) ; un
 * jeton expiré est refusé comme un jeton révoqué.
 */

const PREFIX = 'kptl_';
const PREFIX_LEN = PREFIX.length + 8;

/** Durées de validité proposées à l'émission, en jours. */
export const PORTAL_EXPIRY_CHOICES = [30, 90, 365] as const;
export const DEFAULT_EXPIRY_DAYS = 90;

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export const customerPortalRepository = {
  /** Émet un jeton pour un client (révoque l'actif précédent). Renvoie le jeton en clair. */
  async issue(customerId: string, createdBy?: string | null, expiresInDays: number = DEFAULT_EXPIRY_DAYS): Promise<{ token: string; id: string; expiresAt: string }> {
    const days = (PORTAL_EXPIRY_CHOICES as readonly number[]).includes(expiresInDays) ? expiresInDays : DEFAULT_EXPIRY_DAYS;
    const raw = `${PREFIX}${crypto.randomBytes(24).toString('hex')}`;
    const prefix = raw.slice(0, PREFIX_LEN);
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE customer_portal_tokens SET revoked_at = now() WHERE customer_id = $1 AND revoked_at IS NULL`, [customerId]);
      const row = (await client.query(
        `INSERT INTO customer_portal_tokens (customer_id, token_prefix, token_hash, created_by, expires_at)
         VALUES ($1, $2, $3, $4, now() + make_interval(days => $5::int)) RETURNING id, expires_at`,
        [customerId, prefix, sha256(raw), createdBy ?? null, days])).rows[0];
      await client.query('COMMIT');
      return { token: raw, id: row.id, expiresAt: new Date(row.expires_at).toISOString() };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /** Vérifie un jeton Bearer : préfixe connu, non révoqué, non expiré, hash identique. Renvoie le customer_id. */
  async verify(raw: string): Promise<{ customerId: string; tokenId: string } | null> {
    if (!raw || !raw.startsWith(PREFIX) || raw.length < PREFIX_LEN + 8) return null;
    const prefix = raw.slice(0, PREFIX_LEN);
    const row = (await db.query(
      `SELECT *, (expires_at <= now()) AS expired FROM customer_portal_tokens WHERE token_prefix = $1`, [prefix])).rows[0];
    if (!row || row.revoked_at) return null;
    const a = Buffer.from(sha256(raw), 'hex');
    const b = Buffer.from(row.token_hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    if (row.expired) return null;
    await db.query(`UPDATE customer_portal_tokens SET last_login_at = now(), last_used_at = now() WHERE id = $1`, [row.id]);
    return { customerId: row.customer_id, tokenId: row.id };
  },

  /** État du jeton actif d'un client (sans la valeur en clair), ou null. */
  async statusFor(customerId: string) {
    return (await db.query(
      `SELECT id, token_prefix, last_login_at, last_used_at, created_at, expires_at, (expires_at <= now()) AS expired
         FROM customer_portal_tokens
        WHERE customer_id = $1 AND revoked_at IS NULL
        ORDER BY created_at DESC LIMIT 1`, [customerId])).rows[0] ?? null;
  },

  async revoke(customerId: string) {
    await db.query(`UPDATE customer_portal_tokens SET revoked_at = now() WHERE customer_id = $1 AND revoked_at IS NULL`, [customerId]);
  },
};
