import crypto from 'crypto';
import { db } from '../config/database.js';

/**
 * Phase 10.2 — clés d'accès à l'API publique.
 *
 * La clé en clair n'est renvoyée qu'UNE fois, à la création ; en base on ne
 * garde que son hash SHA-256 et un préfixe lisible. La vérification retrouve la
 * clé par préfixe puis compare le hash en temps constant. Portée par `scopes`.
 */

export interface ApiKeyRow {
  id: string;
  label: string;
  scopes: string[];
  store_id: string | null;
  created_by: string | null;
  revoked_at: string | null;
}

const PREFIX = 'kalum_';
// kalum_ (6) + 8 hex = 14 : lisible, unique, suffisant pour retrouver la clé.
const PREFIX_LEN = PREFIX.length + 8;

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export const apiKeyRepository = {
  /** Crée une clé et renvoie la valeur EN CLAIR une seule fois (jamais restockée). */
  async create(input: { label: string; scopes?: string[]; storeId?: string | null; createdBy?: string | null }) {
    const raw = `${PREFIX}${crypto.randomBytes(24).toString('hex')}`;
    const prefix = raw.slice(0, PREFIX_LEN);
    const row = (await db.query(
      `INSERT INTO api_keys (label, key_prefix, key_hash, scopes, store_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, label, scopes, store_id, created_by, created_at`,
      [input.label, prefix, sha256(raw), input.scopes ?? [], input.storeId ?? null, input.createdBy ?? null],
    )).rows[0];
    return { ...row, key: raw };
  },

  /**
   * Vérifie une clé Bearer : préfixe connu, non révoquée, hash identique en
   * temps constant. Met à jour last_used_at. Renvoie la ligne ou null.
   */
  async verify(raw: string): Promise<ApiKeyRow | null> {
    if (!raw || !raw.startsWith(PREFIX) || raw.length < PREFIX_LEN + 8) return null;
    const prefix = raw.slice(0, PREFIX_LEN);
    const row = (await db.query(`SELECT * FROM api_keys WHERE key_prefix = $1`, [prefix])).rows[0];
    if (!row || row.revoked_at) return null;
    const a = Buffer.from(sha256(raw), 'hex');
    const b = Buffer.from(row.key_hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    await db.query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [row.id]);
    return row;
  },

  async list() {
    return (await db.query(
      `SELECT id, label, key_prefix, scopes, store_id, last_used_at, revoked_at, created_at
         FROM api_keys ORDER BY created_at DESC`)).rows;
  },

  async revoke(id: string) {
    await db.query(`UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [id]);
  },
};
