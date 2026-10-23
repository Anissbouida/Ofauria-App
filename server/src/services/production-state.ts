import type { PoolClient } from 'pg';
import { db } from '../config/database.js';

/**
 * Machine à états du module Production — côté serveur.
 *
 * La table des transitions est LA MÊME que celle de la base
 * (fn_production_transition_allowed, mig 299) : la base refuse toute transition
 * absente (trigger) et journalise chaque changement dans production_plan_events.
 * Ici on l'applique en amont pour produire des erreurs lisibles, et on pose
 * l'acteur / le motif de la transaction pour que le journal les enregistre.
 *
 * Règle d'usage : tout changement de statut d'un plan ou d'un bon passe par
 * transitionPlan / transitionBon, dans une transaction où setActor a été appelé.
 */

export type PlanStatus = 'draft' | 'confirmed' | 'awaiting_ingredients' | 'ready_to_produce' | 'in_progress' | 'completed' | 'cancelled';
export type BonStatus = 'genere' | 'preparation' | 'preparation_partielle' | 'pret' | 'prelevement' | 'verifie' | 'cloture' | 'annule';

export const PLAN_TRANSITIONS: Record<PlanStatus, PlanStatus[]> = {
  draft:                ['confirmed', 'cancelled'],
  confirmed:            ['awaiting_ingredients', 'in_progress', 'draft', 'cancelled'],
  awaiting_ingredients: ['ready_to_produce', 'in_progress', 'confirmed', 'draft', 'cancelled'],
  ready_to_produce:     ['awaiting_ingredients', 'in_progress', 'confirmed', 'draft', 'cancelled'],
  in_progress:          ['completed', 'cancelled', 'confirmed', 'awaiting_ingredients', 'ready_to_produce'],
  completed:            ['in_progress', 'confirmed', 'awaiting_ingredients', 'ready_to_produce'],
  cancelled:            ['draft', 'confirmed', 'awaiting_ingredients', 'ready_to_produce', 'in_progress'],
};

export const BON_TRANSITIONS: Record<BonStatus, BonStatus[]> = {
  genere:                ['preparation', 'prelevement', 'annule'],
  preparation:           ['pret', 'preparation_partielle', 'annule'],
  preparation_partielle: ['preparation', 'annule'],
  pret:                  ['prelevement', 'preparation', 'annule'],
  prelevement:           ['verifie'],
  verifie:               ['cloture'],
  cloture:               [],
  annule:                [],
};

export class TransitionError extends Error {
  readonly entity: 'plan' | 'bon';
  readonly from: string;
  readonly to: string;
  constructor(entity: 'plan' | 'bon', from: string, to: string, detail?: string) {
    super(`Transition invalide : ${entity === 'plan' ? 'plan' : 'bon de sortie'} ${from} → ${to}${detail ? ` (${detail})` : ''}`);
    this.name = 'TransitionError';
    this.entity = entity; this.from = from; this.to = to;
  }
}

/** Vrai si l'erreur vient de la machine à états (TS ou trigger SQL). */
export function isTransitionError(err: unknown): boolean {
  if (err instanceof TransitionError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('TRANSITION_INVALIDE');
}

export function allowedFrom(entity: 'plan', to: PlanStatus): PlanStatus[];
export function allowedFrom(entity: 'bon', to: BonStatus): BonStatus[];
export function allowedFrom(entity: 'plan' | 'bon', to: string): string[] {
  const table: Record<string, string[]> = entity === 'plan' ? PLAN_TRANSITIONS : BON_TRANSITIONS;
  return Object.entries(table).filter(([, tos]) => tos.includes(to)).map(([from]) => from);
}

/** Pose l'acteur (et le motif) de la transaction courante pour le journal (SET LOCAL). */
export async function setActor(client: PoolClient, userId?: string | null, reason?: string | null) {
  await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId || '']);
  await client.query(`SELECT set_config('app.transition_reason', $1, true)`, [reason || '']);
}

/** Change le motif journalisé pour la suite de la transaction. */
export async function setReason(client: PoolClient, reason?: string | null) {
  await client.query(`SELECT set_config('app.transition_reason', $1, true)`, [reason || '']);
}

/**
 * Fait passer le plan à `to`, uniquement depuis un statut qui l'autorise.
 * `extraSet` : fragment SQL supplémentaire (ex. "confirmed_at = NOW(), warnings = $2")
 * dont les paramètres commencent à $2 ($1 = planId).
 */
export async function transitionPlan(
  client: PoolClient, planId: string, to: PlanStatus,
  opts: { extraSet?: string; params?: unknown[]; reason?: string | null } = {},
): Promise<Record<string, any>> {
  const from = allowedFrom('plan', to);
  if (opts.reason !== undefined) await setReason(client, opts.reason);
  const params = [planId, ...(opts.params || [])];
  const idx = params.length + 1;
  const r = await client.query(
    `UPDATE production_plans
        SET status = $${idx}, updated_at = NOW()${opts.extraSet ? `, ${opts.extraSet}` : ''}
      WHERE id = $1 AND status = ANY($${idx + 1}::text[])
      RETURNING *`,
    [...params, to, from],
  );
  if (r.rows[0]) return r.rows[0];
  const cur = await client.query(`SELECT status FROM production_plans WHERE id = $1`, [planId]);
  if (!cur.rows[0]) throw new Error('Plan introuvable');
  throw new TransitionError('plan', cur.rows[0].status, to);
}

/** Même chose pour un bon de sortie. */
export async function transitionBon(
  client: PoolClient, bonId: string, to: BonStatus,
  opts: { extraSet?: string; params?: unknown[]; reason?: string | null } = {},
): Promise<Record<string, any>> {
  const from = allowedFrom('bon', to);
  if (opts.reason !== undefined) await setReason(client, opts.reason);
  const params = [bonId, ...(opts.params || [])];
  const idx = params.length + 1;
  const r = await client.query(
    `UPDATE production_bons_sortie
        SET status = $${idx}, updated_at = NOW()${opts.extraSet ? `, ${opts.extraSet}` : ''}
      WHERE id = $1 AND status = ANY($${idx + 1}::text[])
      RETURNING *`,
    [...params, to, from],
  );
  if (r.rows[0]) return r.rows[0];
  const cur = await client.query(`SELECT status FROM production_bons_sortie WHERE id = $1`, [bonId]);
  if (!cur.rows[0]) throw new Error('Bon de sortie introuvable');
  throw new TransitionError('bon', cur.rows[0].status, to);
}

/** Ouvre une transaction avec acteur posé, exécute, commit/rollback. */
export async function withActor<T>(userId: string | null | undefined, fn: (client: PoolClient) => Promise<T>, reason?: string | null): Promise<T> {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await setActor(client, userId, reason);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Journal d'un plan (plan + bons), du plus ancien au plus récent. */
export async function listPlanEvents(planId: string) {
  const r = await db.query(
    `SELECT e.id, e.entity, e.bon_id, b.numero AS bon_numero, e.from_status, e.to_status, e.reason, e.created_at,
            u.first_name || ' ' || u.last_name AS actor_name
       FROM production_plan_events e
       LEFT JOIN users u ON u.id = e.actor_id
       LEFT JOIN production_bons_sortie b ON b.id = e.bon_id
      WHERE e.plan_id = $1
      ORDER BY e.created_at ASC, e.id ASC`,
    [planId],
  );
  return r.rows;
}
