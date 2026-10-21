import type { PoolClient } from 'pg';
import { db } from '../config/database.js';

/**
 * Auteur des modifications tracées par les triggers d'audit (config_audit_log,
 * mig 328, et journaux achats) : le trigger lit current_setting('app.user_id').
 * La valeur est posée en local à la transaction (set_config(..., true)) pour ne
 * jamais fuiter vers une autre requête qui réutiliserait la connexion du pool.
 */
export async function setAuditUser(client: Pick<PoolClient, 'query'>, userId?: string | null): Promise<void> {
  if (userId) await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
}

/**
 * Exécute une requête d'écriture isolée en indiquant son auteur. Sans auteur,
 * équivaut à db.query (pas de transaction ouverte pour rien).
 */
export async function auditedQuery(userId: string | null | undefined, text: string, params?: unknown[]) {
  if (!userId) return db.query(text, params);
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await setAuditUser(client, userId);
    const result = await client.query(text, params);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
