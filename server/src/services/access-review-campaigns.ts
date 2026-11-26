import { db } from '../config/database.js';
import { effectiveRights, userRoleContext, resolveRole } from './access-rights.js';
import { evaluateSod } from './access-rules.js';
import { activeSodRules } from './governance.js';
import { securityPolicy } from './security-policy.js';
import { userRepository } from '../repositories/user.repository.js';
import { userExceptionRepository } from '../repositories/user-exception.repository.js';

/**
 * Revue des accès en campagnes (refonte Utilisateurs, lot 9, mig 709). Une campagne reprend les
 * comptes actifs à son ouverture ; chacun reçoit une décision datée et signée : confirmé, corrigé
 * (avec ce qui a été changé) ou désactivé. Une seule campagne ouverte à la fois ; la clôture exige
 * que tous les comptes aient une décision. Signaux : conflit de séparation des tâches, compte
 * dormant (seuil de la politique de sécurité), délégation en cours, exceptions individuelles.
 */

export class ReviewError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export type Decision = 'confirmed' | 'corrected' | 'deactivated';
export interface AccountSignals {
  conflicts: string[];
  /** Jours sans connexion au-delà du seuil (ou depuis la création si jamais connecté) ; null = actif. */
  dormantDays: number | null;
  delegated: string[];
  exceptions: number;
}
export const hasSignal = (s: AccountSignals) => s.conflicts.length > 0 || s.dormantDays !== null || s.delegated.length > 0 || s.exceptions > 0;

const DAY = 86_400_000;

/** Signaux et photo des droits de chaque compte (actifs ou listés). */
async function accountFacts(userIds?: string[]) {
  const [policy, rules, lastLogins, exceptions, storeIds] = await Promise.all([
    securityPolicy(), activeSodRules(), userRepository.lastLogins(), userExceptionRepository.activeCounts(), userRepository.storeIdsByUser(),
  ]);
  const users = (await db.query(
    `SELECT id, first_name, last_name, email, is_active, created_at, store_id FROM users
      WHERE NOT is_system AND ${userIds ? 'id = ANY($1::uuid[])' : 'is_active'}`, userIds ? [userIds] : [])).rows;
  const stores = new Map((await db.query(`SELECT id::text, name FROM stores`)).rows.map(r => [r.id as string, r.name as string]));
  const out = new Map<string, {
    name: string; email: string; isActive: boolean; lastLoginAt: Date | null;
    roles: { code: string; label: string; delegated: boolean }[]; stores: string[]; signals: AccountSignals;
  }>();
  for (const u of users) {
    const [rights, ctx] = await Promise.all([effectiveRights(u.id), userRoleContext(u.id)]);
    const roles = await Promise.all(ctx.roleCodes.map(async c => ({ code: c, label: (await resolveRole(c)).label, delegated: ctx.delegated.includes(c) })));
    const last = lastLogins.get(u.id) ?? null;
    const idle = Math.floor((Date.now() - new Date(last ?? u.created_at).getTime()) / DAY);
    out.set(u.id, {
      name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email, email: u.email, isActive: u.is_active, lastLoginAt: last,
      roles,
      stores: (storeIds.get(u.id) ?? (u.store_id ? [u.store_id] : [])).map((id: string) => stores.get(id) ?? id),
      signals: {
        conflicts: evaluateSod(rights, rules).map(v => v.label),
        dormantDays: idle >= policy.dormantDays ? idle : null,
        delegated: roles.filter(r => r.delegated).map(r => r.label),
        exceptions: exceptions.get(u.id) ?? 0,
      },
    });
  }
  return { facts: out, dormantThreshold: policy.dormantDays };
}

const campaignSelect = `
  SELECT c.id, c.label, c.status, c.due_on::text AS due_on, c.opened_at, c.closed_at,
         NULLIF(concat_ws(' ', o.first_name, o.last_name), '') AS opened_by_name,
         NULLIF(concat_ws(' ', cl.first_name, cl.last_name), '') AS closed_by_name,
         (SELECT count(*)::int FROM access_review_items i WHERE i.campaign_id = c.id) AS total,
         (SELECT count(*)::int FROM access_review_items i WHERE i.campaign_id = c.id AND i.decision = 'confirmed') AS confirmed,
         (SELECT count(*)::int FROM access_review_items i WHERE i.campaign_id = c.id AND i.decision IN ('corrected', 'deactivated')) AS corrected
    FROM access_review_campaigns c
    LEFT JOIN users o ON o.id = c.opened_by
    LEFT JOIN users cl ON cl.id = c.closed_by`;

export async function listCampaigns() {
  return (await db.query(`${campaignSelect} ORDER BY c.opened_at DESC LIMIT 40`)).rows;
}

export async function openCampaign(label: string, dueOn: string | null, actorId: string): Promise<string> {
  const { facts } = await accountFacts();
  try {
    const id = (await db.query(
      `INSERT INTO access_review_campaigns (label, due_on, opened_by) VALUES ($1, $2, $3) RETURNING id`,
      [label.trim().slice(0, 120), dueOn, actorId])).rows[0].id as string;
    const rows = [...facts.entries()].map(([userId, f]) => ({
      user_id: userId,
      snapshot: { roles: f.roles, stores: f.stores, signals: f.signals, lastLoginAt: f.lastLoginAt },
    }));
    await db.query(
      `INSERT INTO access_review_items (campaign_id, user_id, snapshot)
       SELECT $1, x.user_id, x.snapshot FROM jsonb_to_recordset($2::jsonb) AS x(user_id uuid, snapshot jsonb)`,
      [id, JSON.stringify(rows)]);
    return id;
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new ReviewError('Une revue est déjà en cours : clôturez-la avant d\'en ouvrir une autre.', 409);
    throw e;
  }
}

/** Campagne et comptes : photo à l'ouverture, situation actuelle et décision. */
export async function campaignDetail(id: string) {
  const campaign = (await db.query(`${campaignSelect} WHERE c.id = $1`, [id])).rows[0];
  if (!campaign) return null;
  const items = (await db.query(
    `SELECT i.user_id, i.snapshot, i.decision, i.comment, i.decided_at,
            NULLIF(concat_ws(' ', d.first_name, d.last_name), '') AS decided_by_name
       FROM access_review_items i LEFT JOIN users d ON d.id = i.decided_by
      WHERE i.campaign_id = $1`, [id])).rows;
  const { facts, dormantThreshold } = await accountFacts(items.map(i => i.user_id as string));
  return {
    campaign,
    dormantThreshold,
    items: items.map(i => {
      const f = facts.get(i.user_id);
      const snap = i.snapshot as { roles?: unknown[]; stores?: string[]; signals?: AccountSignals; lastLoginAt?: string | null };
      return {
        userId: i.user_id, name: f?.name ?? '—', email: f?.email ?? '', isActive: f?.isActive ?? false,
        // En cours de revue : situation actuelle ; décidé ou clôturé : la photo d'ouverture reste au rapport.
        roles: f?.roles ?? snap.roles ?? [], stores: f?.stores ?? snap.stores ?? [],
        signals: f?.signals ?? snap.signals ?? { conflicts: [], dormantDays: null, delegated: [], exceptions: 0 },
        lastLoginAt: f?.lastLoginAt ?? snap.lastLoginAt ?? null,
        snapshot: snap,
        decision: i.decision as Decision | null, comment: i.comment, decidedAt: i.decided_at, decidedBy: i.decided_by_name,
      };
    }).sort((a, b) => Number(!!a.decision) - Number(!!b.decision) || a.name.localeCompare(b.name, 'fr')),
  };
}

async function openCampaignOrThrow(id: string) {
  const c = (await db.query(`SELECT status FROM access_review_campaigns WHERE id = $1`, [id])).rows[0];
  if (!c) throw new ReviewError('Revue introuvable', 404);
  if (c.status !== 'open') throw new ReviewError('Cette revue est clôturée : ses décisions ne changent plus.', 409);
}

export async function decide(id: string, userId: string, decision: Decision, comment: string | null, actorId: string) {
  await openCampaignOrThrow(id);
  if (decision === 'corrected' && !comment?.trim()) throw new ReviewError('Dites ce qui a été corrigé (rôle retiré, exception, établissement…).');
  if (decision === 'deactivated') {
    const u = (await db.query(`SELECT is_active FROM users WHERE id = $1`, [userId])).rows[0];
    if (u?.is_active) throw new ReviewError('Le compte est encore actif : désactivez-le d\'abord.', 409);
  }
  const r = await db.query(
    `UPDATE access_review_items SET decision = $3, comment = $4, decided_by = $5, decided_at = now()
      WHERE campaign_id = $1 AND user_id = $2`, [id, userId, decision, comment?.trim().slice(0, 500) || null, actorId]);
  if (!r.rowCount) throw new ReviewError('Ce compte ne fait pas partie de la revue', 404);
}

export async function resetDecision(id: string, userId: string) {
  await openCampaignOrThrow(id);
  await db.query(
    `UPDATE access_review_items SET decision = NULL, comment = NULL, decided_by = NULL, decided_at = NULL
      WHERE campaign_id = $1 AND user_id = $2`, [id, userId]);
}

/** Confirme d'un coup les comptes encore à examiner qui n'ont aucun signal. Rend le nombre confirmé. */
export async function confirmClean(id: string, actorId: string): Promise<number> {
  await openCampaignOrThrow(id);
  const pending = (await db.query(`SELECT user_id FROM access_review_items WHERE campaign_id = $1 AND decision IS NULL`, [id])).rows.map(r => r.user_id as string);
  if (!pending.length) return 0;
  const { facts } = await accountFacts(pending);
  const clean = pending.filter(u => { const f = facts.get(u); return f && f.isActive && !hasSignal(f.signals); });
  if (!clean.length) return 0;
  await db.query(
    `UPDATE access_review_items SET decision = 'confirmed', decided_by = $3, decided_at = now(), comment = 'Confirmé sans signal'
      WHERE campaign_id = $1 AND user_id = ANY($2::uuid[]) AND decision IS NULL`, [id, clean, actorId]);
  return clean.length;
}

export async function closeCampaign(id: string, actorId: string) {
  await openCampaignOrThrow(id);
  const pending = Number((await db.query(`SELECT count(*) FROM access_review_items WHERE campaign_id = $1 AND decision IS NULL`, [id])).rows[0].count);
  if (pending) throw new ReviewError(`${pending} compte${pending > 1 ? 's restent' : ' reste'} à examiner avant la clôture.`, 409);
  await db.query(`UPDATE access_review_campaigns SET status = 'closed', closed_by = $2, closed_at = now() WHERE id = $1`, [id, actorId]);
}
