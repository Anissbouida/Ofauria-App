import crypto from 'crypto';
import type { PoolClient } from 'pg';
import { db } from '../config/database.js';

/**
 * Phase 10.2 — notifications sortantes (webhooks).
 *
 * Un point de terminaison s'abonne à des événements (ex. order.created). Quand
 * l'événement survient, `enqueue` met une livraison en file par point abonné,
 * signée en HMAC-SHA256 avec le secret du point. La tâche planifiée poste et
 * retente. Un échec n'interrompt jamais l'action métier (même esprit que
 * email_outbox, mig 364).
 */

type Runner = Pick<PoolClient, 'query'> | typeof db;

/** Signature d'une charge utile pour un point donné. Le récepteur recalcule la
 *  même valeur à partir du corps brut et du secret partagé (X-Kalum-Signature). */
export function signPayload(secret: string, payload: unknown): string {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
}

const MAX_ATTEMPTS = 6;

export const webhookRepository = {
  async listEndpoints() {
    return (await db.query(
      `SELECT id, label, url, events, is_active, created_at
         FROM webhook_endpoints ORDER BY created_at DESC`)).rows;
  },

  /** Crée un point. Le secret est généré ici et renvoyé une fois pour que le
   *  site marchand puisse configurer sa vérification de signature. */
  async createEndpoint(input: { label: string; url: string; events: string[]; createdBy?: string | null }) {
    const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
    const row = (await db.query(
      `INSERT INTO webhook_endpoints (label, url, secret, events, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, label, url, events, is_active, created_at`,
      [input.label, input.url, secret, input.events ?? [], input.createdBy ?? null],
    )).rows[0];
    return { ...row, secret };
  },

  async setActive(id: string, active: boolean) {
    await db.query(`UPDATE webhook_endpoints SET is_active = $2 WHERE id = $1`, [id, active]);
  },

  async removeEndpoint(id: string) {
    await db.query(`DELETE FROM webhook_endpoints WHERE id = $1`, [id]);
  },

  /**
   * Met en file une livraison pour chaque point ACTIF abonné à l'événement.
   * Honore la transaction de l'appelant (runner) pour que la notification soit
   * atomique avec l'action qui l'a produite. Renvoie le nombre de livraisons.
   */
  async enqueue(event: string, payload: unknown, runner: Runner = db): Promise<number> {
    const eps = (await runner.query(
      `SELECT id, secret FROM webhook_endpoints WHERE is_active AND $1 = ANY(events)`, [event])).rows;
    for (const ep of eps) {
      await runner.query(
        `INSERT INTO webhook_deliveries (endpoint_id, event, payload, signature)
         VALUES ($1, $2, $3, $4)`,
        [ep.id, event, JSON.stringify(payload), signPayload(ep.secret, payload)],
      );
    }
    return eps.length;
  },

  /**
   * Poste les livraisons en attente (tâche planifiée). Recalcule la signature
   * sur le corps réellement envoyé pour qu'elle corresponde bit à bit. Retente
   * avec un recul croissant, abandonne après MAX_ATTEMPTS.
   */
  async deliverPending(limit = 20): Promise<{ sent: number; failed: number }> {
    const rows = (await db.query(
      `SELECT d.id, d.event, d.payload, e.url, e.secret
         FROM webhook_deliveries d
         JOIN webhook_endpoints e ON e.id = d.endpoint_id
        WHERE d.status = 'queued' AND d.next_attempt_at <= now()
        ORDER BY d.created_at ASC
        LIMIT $1`, [limit])).rows;
    let sent = 0, failed = 0;
    for (const d of rows) {
      const body = JSON.stringify(d.payload);
      const sig = crypto.createHmac('sha256', d.secret).update(body).digest('hex');
      try {
        const resp = await fetch(d.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Kalum-Event': d.event,
            'X-Kalum-Signature': sig,
          },
          body,
          signal: AbortSignal.timeout(10000),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        await db.query(
          `UPDATE webhook_deliveries SET status = 'sent', delivered_at = now(),
                  attempts = attempts + 1, signature = $2, last_error = NULL WHERE id = $1`,
          [d.id, sig]);
        sent++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await db.query(
          `UPDATE webhook_deliveries
             SET attempts = attempts + 1,
                 last_error = $2,
                 status = CASE WHEN attempts + 1 >= $3 THEN 'failed' ELSE 'queued' END,
                 next_attempt_at = now() + (power(2, attempts + 1) * interval '1 minute')
           WHERE id = $1`,
          [d.id, msg, MAX_ATTEMPTS]);
        failed++;
      }
    }
    return { sent, failed };
  },
};
