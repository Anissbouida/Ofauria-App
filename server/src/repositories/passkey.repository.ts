import { db } from '../config/database.js';

/** Passkey telle que stockée (mig 705) : clé publique seule, la clé privée reste sur l'appareil. */
export interface PasskeyRow {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: Buffer;
  counter: string | number;
  transports: string[];
  rp_id: string;
  device_type: string | null;
  backed_up: boolean;
  label: string;
  created_at: Date;
  last_used_at: Date | null;
}

/** Vue renvoyée à l'écran « Mes passkeys » (jamais la clé publique). */
export const passkeyView = (p: PasskeyRow) => ({
  id: p.id, label: p.label, createdAt: p.created_at, lastUsedAt: p.last_used_at,
  synced: p.backed_up, rpId: p.rp_id,
});

export const passkeyRepository = {
  async listForUser(userId: string): Promise<PasskeyRow[]> {
    return (await db.query(`SELECT * FROM user_passkeys WHERE user_id = $1 ORDER BY created_at`, [userId])).rows;
  },

  async countForUser(userId: string): Promise<number> {
    return Number((await db.query(`SELECT count(*)::int AS n FROM user_passkeys WHERE user_id = $1`, [userId])).rows[0]?.n ?? 0);
  },

  /** Nombre de passkeys par compte (liste des utilisateurs). */
  async countsByUser(): Promise<Map<string, number>> {
    const r = await db.query(`SELECT user_id, count(*)::int AS n FROM user_passkeys GROUP BY user_id`);
    return new Map(r.rows.map((x: { user_id: string; n: number }) => [x.user_id, x.n]));
  },

  async findByCredentialId(credentialId: string): Promise<PasskeyRow | null> {
    return (await db.query(`SELECT * FROM user_passkeys WHERE credential_id = $1`, [credentialId])).rows[0] ?? null;
  },

  async insert(p: {
    userId: string; credentialId: string; publicKey: Uint8Array; counter: number; transports: string[];
    rpId: string; deviceType: string | null; backedUp: boolean; label: string;
  }): Promise<PasskeyRow> {
    return (await db.query(
      `INSERT INTO user_passkeys (user_id, credential_id, public_key, counter, transports, rp_id, device_type, backed_up, label)
       VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8, $9) RETURNING *`,
      [p.userId, p.credentialId, Buffer.from(p.publicKey), p.counter, p.transports, p.rpId, p.deviceType, p.backedUp, p.label.slice(0, 80)],
    )).rows[0];
  },

  /** Après une connexion : compteur à jour et date de dernière utilisation. */
  async touch(id: string, counter: number): Promise<void> {
    await db.query(`UPDATE user_passkeys SET counter = $2, last_used_at = now() WHERE id = $1`, [id, counter]);
  },

  async rename(userId: string, id: string, label: string): Promise<PasskeyRow | null> {
    return (await db.query(
      `UPDATE user_passkeys SET label = $3 WHERE id = $2 AND user_id = $1 RETURNING *`, [userId, id, label.slice(0, 80)],
    )).rows[0] ?? null;
  },

  async remove(userId: string, id: string): Promise<boolean> {
    return ((await db.query(`DELETE FROM user_passkeys WHERE id = $2 AND user_id = $1`, [userId, id])).rowCount ?? 0) > 0;
  },

  async removeAllForUser(userId: string): Promise<number> {
    return (await db.query(`DELETE FROM user_passkeys WHERE user_id = $1`, [userId])).rowCount ?? 0;
  },
};
