import crypto from 'crypto';
import { db, withTransaction } from '../config/database.js';

/**
 * Invitations à choisir son mot de passe (refonte Utilisateurs, lot 3, mig 700).
 * Le jeton n'est rendu qu'une fois, à la création ; seule son empreinte SHA-256 est gardée.
 */
export const INVITATION_HOURS = 72;
const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export interface InvitationPeek {
  status: 'valid' | 'expired' | 'used' | 'revoked' | 'unknown';
  email?: string; firstName?: string; expiresAt?: string;
}

export const invitationRepository = {
  async tableExists(): Promise<boolean> {
    return !!(await db.query(`SELECT to_regclass('public.user_invitations') IS NOT NULL AS ok`)).rows[0]?.ok;
  },

  /** Nouvelle invitation : la précédente encore ouverte est annulée. */
  async create(userId: string, createdBy?: string | null, hours = INVITATION_HOURS): Promise<{ token: string; expiresAt: string }> {
    const token = crypto.randomBytes(32).toString('base64url');
    return withTransaction(async () => {
      await db.query(`UPDATE user_invitations SET revoked_at = now() WHERE user_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL`, [userId]);
      const r = await db.query(
        `INSERT INTO user_invitations (user_id, token_hash, created_by, expires_at)
         VALUES ($1, $2, $3, now() + make_interval(hours => $4::int)) RETURNING expires_at`,
        [userId, hash(token), createdBy ?? null, hours]);
      return { token, expiresAt: new Date(r.rows[0].expires_at).toISOString() };
    });
  },

  async peek(token: string): Promise<InvitationPeek> {
    const r = await db.query(
      `SELECT i.expires_at, i.accepted_at, i.revoked_at, u.email, u.first_name, u.is_active
         FROM user_invitations i JOIN users u ON u.id = i.user_id WHERE i.token_hash = $1`, [hash(token)]);
    const row = r.rows[0];
    if (!row || !row.is_active) return { status: 'unknown' };
    if (row.accepted_at) return { status: 'used' };
    if (row.revoked_at) return { status: 'revoked' };
    if (new Date(row.expires_at).getTime() <= Date.now()) return { status: 'expired' };
    return { status: 'valid', email: row.email, firstName: row.first_name, expiresAt: new Date(row.expires_at).toISOString() };
  },

  /**
   * Acceptation : le mot de passe choisi remplace le mot de passe aléatoire posé à la création ;
   * l'invitation est close, le verrouillage levé et les sessions éventuelles fermées.
   * Rend l'identifiant du compte, ou null si le lien n'est plus valable.
   */
  async accept(token: string, passwordHash: string): Promise<{ userId: string; email: string } | null> {
    return withTransaction(async () => {
      const r = await db.query(
        `SELECT i.id, i.user_id, u.email FROM user_invitations i JOIN users u ON u.id = i.user_id
          WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now() AND u.is_active
          FOR UPDATE OF i`, [hash(token)]);
      const row = r.rows[0];
      if (!row) return null;
      await db.query(
        `UPDATE users SET password_hash = $2, must_change_password = false, failed_login_count = 0, locked_until = NULL,
                token_version = token_version + 1, updated_at = now() WHERE id = $1`, [row.user_id, passwordHash]);
      await db.query(`UPDATE user_invitations SET accepted_at = now() WHERE id = $1`, [row.id]);
      return { userId: row.user_id as string, email: row.email as string };
    });
  },

  /** Invitations encore ouvertes (expirées comprises), par compte : liste Comptes et Vue d'ensemble. */
  async openByUser(): Promise<Map<string, string>> {
    if (!(await this.tableExists())) return new Map();
    const r = await db.query(`SELECT user_id, expires_at FROM user_invitations WHERE accepted_at IS NULL AND revoked_at IS NULL`);
    return new Map(r.rows.map(x => [x.user_id as string, new Date(x.expires_at).toISOString()]));
  },

  async revokeOpen(userId: string): Promise<void> {
    await db.query(`UPDATE user_invitations SET revoked_at = now() WHERE user_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL`, [userId]);
  },
};
