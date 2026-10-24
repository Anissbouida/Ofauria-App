import { db } from '../config/database.js';
import { createNotification } from '../utils/notify.js';
import { setAuditUser } from '../utils/audit-context.js';
import { resolveRole } from './access-rights.js';
import {
  APPROVAL_DOC_TYPES, approvalConditionMatches, describeApprovalCondition,
  type ApprovalCondition, type ApprovalDocType,
} from '@ofauria/shared';

/**
 * Moteur d'approbation (lot 8 Paramètres, mig 347).
 *
 * Un module soumet une pièce avec ses valeurs (montant, écart…) ; la première
 * règle active dont la condition correspond crée une demande et ses étapes.
 * Les approbateurs décident depuis la boîte « À approuver » ; à la dernière
 * étape, le gestionnaire du type de pièce (approval-handlers.ts) applique
 * l'effet (envoyer le BC, annuler la facture, valider le contrôle).
 *
 * Règles de décision :
 *   - le demandeur ne peut jamais approuver sa propre demande ;
 *   - une étape se décide par la personne désignée, par toute personne du
 *     rôle désigné, par un délégué actif de l'un ou l'autre, ou par un
 *     administrateur ;
 *   - un refus clôt la demande, les étapes restantes passent « sans objet ».
 */

export interface ApprovalActor { userId: string; role: string; storeId?: string | null }

export interface SubmitInput {
  docType: ApprovalDocType;
  docId: string;
  docLabel: string;
  amount?: number | null;
  values: Record<string, number | string | boolean | null>;
  storeId?: string | null;
  requestedBy: string;
}

export type SubmitResult =
  | { outcome: 'not_required' }
  | { outcome: 'submitted'; request: ApprovalRequestRow }
  | { outcome: 'already_pending'; request: ApprovalRequestRow };

export interface ApprovalRequestRow {
  id: string; rule_id: string | null; rule_code: string; rule_label?: string;
  doc_type: ApprovalDocType; doc_id: string; doc_label: string;
  amount: string | null; summary: Record<string, unknown>; store_id: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requested_by: string; requested_at: string;
  decided_by: string | null; decided_at: string | null; decision_reason: string | null;
  applied_at: string | null; apply_error: string | null;
  steps?: ApprovalStepRow[];
}

export interface ApprovalStepRow {
  id: string; request_id: string; step_order: number;
  approver_role: string | null; approver_user_id: string | null;
  status: 'waiting' | 'pending' | 'approved' | 'rejected' | 'skipped';
  due_at: string | null; decided_by: string | null; decided_at: string | null; reason: string | null;
  escalated_at: string | null;
  approver_name?: string | null; decided_by_name?: string | null;
}

export interface ApprovalHandler {
  /** Effet de l'approbation finale (lance une erreur si la pièce n'est plus dans l'état attendu). */
  onApproved: (request: ApprovalRequestRow, actorId: string) => Promise<void>;
  /** Effet d'un refus (optionnel : la plupart des pièces restent simplement en place). */
  onRejected?: (request: ApprovalRequestRow, actorId: string, reason: string) => Promise<void>;
}

type Runner = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

const handlers = new Map<string, ApprovalHandler>();
export function registerApprovalHandler(docType: ApprovalDocType, handler: ApprovalHandler) {
  handlers.set(docType, handler);
}

const httpError = (status: number, message: string) => Object.assign(new Error(message), { statusCode: status });

async function tablesReady(): Promise<boolean> {
  const r = await db.query(`SELECT to_regclass('public.approval_rules') AS t`);
  return !!r.rows[0]?.t;
}

async function isAdmin(role: string): Promise<boolean> {
  try { return (await resolveRole(role)).baseRole === 'admin'; } catch { return role === 'admin'; }
}

const STEP_SELECT = `
  SELECT s.*,
         CASE WHEN s.approver_user_id IS NOT NULL THEN au.first_name || ' ' || au.last_name ELSE rl.label END AS approver_name,
         du.first_name || ' ' || du.last_name AS decided_by_name
    FROM approval_steps s
    LEFT JOIN users au ON au.id = s.approver_user_id
    LEFT JOIN roles rl ON rl.code = s.approver_role
    LEFT JOIN users du ON du.id = s.decided_by`;

const REQUEST_SELECT = `
  SELECT r.*, COALESCE(ar.label, r.rule_code) AS rule_label,
         ru.first_name || ' ' || ru.last_name AS requested_by_name,
         dcu.first_name || ' ' || dcu.last_name AS decided_by_name,
         st.name AS store_name
    FROM approval_requests r
    LEFT JOIN approval_rules ar ON ar.id = r.rule_id
    LEFT JOIN users ru ON ru.id = r.requested_by
    LEFT JOIN users dcu ON dcu.id = r.decided_by
    LEFT JOIN stores st ON st.id = r.store_id`;

async function attachSteps(rows: ApprovalRequestRow[]): Promise<ApprovalRequestRow[]> {
  if (!rows.length) return rows;
  const ids = rows.map(r => r.id);
  const steps = await db.query(`${STEP_SELECT} WHERE s.request_id = ANY($1::uuid[]) ORDER BY s.step_order`, [ids]);
  const byReq = new Map<string, ApprovalStepRow[]>();
  for (const s of steps.rows as ApprovalStepRow[]) byReq.set(s.request_id, [...(byReq.get(s.request_id) ?? []), s]);
  return rows.map(r => ({ ...r, steps: byReq.get(r.id) ?? [] }));
}

async function notifyStepApprovers(client: Runner, request: ApprovalRequestRow, step: ApprovalStepRow, requesterName: string) {
  const def = APPROVAL_DOC_TYPES[request.doc_type];
  const amount = request.amount ? ` · ${Number(request.amount).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH` : '';
  const base = {
    type: 'approval_requested',
    title: `À approuver : ${request.doc_label}`,
    message: `${def?.label ?? request.doc_type}${amount} · demandé par ${requesterName}`,
    referenceType: 'approval_request',
    referenceId: request.id,
    createdBy: request.requested_by,
  };
  if (step.approver_user_id) {
    const u = await client.query(`SELECT role FROM users WHERE id = $1`, [step.approver_user_id]);
    if (u.rows[0]) await createNotification({ ...base, targetRole: u.rows[0].role, targetUserId: step.approver_user_id });
  } else if (step.approver_role) {
    await createNotification({ ...base, targetRole: step.approver_role });
  }
}

async function notifyRequester(request: ApprovalRequestRow, type: 'approval_approved' | 'approval_rejected', message: string, actorId: string) {
  const u = await db.query(`SELECT role FROM users WHERE id = $1`, [request.requested_by]);
  if (!u.rows[0]) return;
  await createNotification({
    targetRole: u.rows[0].role, targetUserId: request.requested_by, type,
    title: `${type === 'approval_approved' ? 'Approuvé' : 'Refusé'} : ${request.doc_label}`,
    message, referenceType: 'approval_request', referenceId: request.id, createdBy: actorId,
  });
}

/** Applique l'effet d'une décision finale, hors transaction, et le consigne sur la demande. */
async function applyDecision(request: ApprovalRequestRow, actorId: string, decision: 'approve' | 'reject', reason?: string) {
  const handler = handlers.get(request.doc_type);
  try {
    if (decision === 'approve') await handler?.onApproved(request, actorId);
    else if (handler?.onRejected) await handler.onRejected(request, actorId, reason ?? '');
    await db.query(`UPDATE approval_requests SET applied_at = now(), apply_error = NULL WHERE id = $1`, [request.id]);
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[approvals] effet non appliqué sur ${request.doc_type}/${request.doc_id}:`, message);
    await db.query(`UPDATE approval_requests SET apply_error = $2 WHERE id = $1`, [request.id, message.slice(0, 500)]);
    return message;
  }
}

export const approvalService = {
  /**
   * Cherche une règle active applicable et, s'il y en a une, crée la demande.
   * Sans table (migration 347 absente) ou sans règle applicable : not_required.
   */
  async submit(input: SubmitInput): Promise<SubmitResult> {
    if (!(await tablesReady())) return { outcome: 'not_required' };
    const existing = await db.query(
      `${REQUEST_SELECT} WHERE r.doc_type = $1 AND r.doc_id = $2 AND r.status = 'pending'`, [input.docType, input.docId]);
    if (existing.rows[0]) return { outcome: 'already_pending', request: (await attachSteps(existing.rows))[0] };

    const rules = await db.query(
      `SELECT * FROM approval_rules WHERE doc_type = $1 AND enabled ORDER BY display_order, code`, [input.docType]);
    const rule = rules.rows.find((r: { condition: ApprovalCondition }) => approvalConditionMatches(r.condition, input.values));
    if (!rule) return { outcome: 'not_required' };
    const ruleSteps = await db.query(`SELECT * FROM approval_rule_steps WHERE rule_id = $1 ORDER BY step_order`, [rule.id]);
    if (!ruleSteps.rows.length) return { outcome: 'not_required' };

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setAuditUser(client, input.requestedBy);
      const summary = {
        values: input.values,
        condition: describeApprovalCondition(input.docType, rule.condition),
        mode: rule.mode,
      };
      const ins = await client.query(
        `INSERT INTO approval_requests (rule_id, rule_code, doc_type, doc_id, doc_label, amount, summary, store_id, requested_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [rule.id, rule.code, input.docType, input.docId, input.docLabel.slice(0, 160), input.amount ?? null,
          JSON.stringify(summary), input.storeId ?? null, input.requestedBy]);
      const request = ins.rows[0] as ApprovalRequestRow;
      const due = rule.escalate_after_hours ? `now() + make_interval(hours => ${Number(rule.escalate_after_hours)})` : 'NULL';
      const steps: ApprovalStepRow[] = [];
      for (const [i, rs] of ruleSteps.rows.entries()) {
        const active = rule.mode === 'parallel' || i === 0;
        const st = await client.query(
          `INSERT INTO approval_steps (request_id, step_order, approver_role, approver_user_id, status, due_at)
           VALUES ($1, $2, $3, $4, $5, ${active ? due : 'NULL'}) RETURNING *`,
          [request.id, rs.step_order, rs.approver_role, rs.approver_user_id, active ? 'pending' : 'waiting']);
        steps.push(st.rows[0]);
      }
      const requester = await client.query(`SELECT first_name || ' ' || last_name AS name FROM users WHERE id = $1`, [input.requestedBy]);
      await client.query('COMMIT');
      const name = requester.rows[0]?.name ?? 'un utilisateur';
      for (const s of steps.filter(s => s.status === 'pending')) await notifyStepApprovers(db, request, s, name);
      return { outcome: 'submitted', request: { ...request, rule_label: rule.label, steps } };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },

  /** Demande en attente (ou dernière demande) sur une pièce, pour les bandeaux. */
  async forDocument(docType: string, docId: string): Promise<ApprovalRequestRow | null> {
    if (!(await tablesReady())) return null;
    const r = await db.query(
      `${REQUEST_SELECT} WHERE r.doc_type = $1 AND r.doc_id = $2
        ORDER BY (r.status = 'pending') DESC, r.requested_at DESC LIMIT 1`, [docType, docId]);
    return r.rows[0] ? (await attachSteps(r.rows))[0] : null;
  },

  async hasPending(docType: string, docId: string): Promise<boolean> {
    if (!(await tablesReady())) return false;
    const r = await db.query(`SELECT 1 FROM approval_requests WHERE doc_type = $1 AND doc_id = $2 AND status = 'pending'`, [docType, docId]);
    return r.rows.length > 0;
  },

  /** Annule la demande en attente d'une pièce (pièce modifiée, annulée ou supprimée). */
  async cancelPending(docType: string, docId: string, actorId: string, reason: string): Promise<boolean> {
    if (!(await tablesReady())) return false;
    const r = await db.query(
      `UPDATE approval_requests SET status = 'cancelled', decided_by = $3, decided_at = now(), decision_reason = $4
        WHERE doc_type = $1 AND doc_id = $2 AND status = 'pending' RETURNING id`, [docType, docId, actorId, reason]);
    if (!r.rows.length) return false;
    await db.query(`UPDATE approval_steps SET status = 'skipped' WHERE request_id = $1 AND status IN ('pending', 'waiting')`, [r.rows[0].id]);
    return true;
  },

  /** Annulation par le demandeur (ou un administrateur) depuis l'écran. */
  async cancel(requestId: string, actor: ApprovalActor, reason?: string): Promise<ApprovalRequestRow> {
    const r = await db.query(`SELECT * FROM approval_requests WHERE id = $1`, [requestId]);
    const req = r.rows[0] as ApprovalRequestRow | undefined;
    if (!req) throw httpError(404, 'Demande introuvable');
    if (req.status !== 'pending') throw httpError(409, 'Cette demande est déjà clôturée');
    if (req.requested_by !== actor.userId && !(await isAdmin(actor.role))) throw httpError(403, 'Seul le demandeur peut retirer sa demande');
    await this.cancelPending(req.doc_type, req.doc_id, actor.userId, reason?.trim() || 'Retirée par le demandeur');
    return (await this.byId(requestId))!;
  },

  async byId(id: string): Promise<ApprovalRequestRow | null> {
    const r = await db.query(`${REQUEST_SELECT} WHERE r.id = $1`, [id]);
    return r.rows[0] ? (await attachSteps(r.rows))[0] : null;
  },

  /**
   * Décision sur l'étape en cours qu'un acteur a le droit de trancher.
   * Les contrôles sont faits en base sous verrou pour éviter deux décisions
   * simultanées sur la même étape.
   */
  async decide(requestId: string, actor: ApprovalActor, decision: 'approve' | 'reject', reason?: string): Promise<ApprovalRequestRow> {
    if (decision === 'reject' && !reason?.trim()) throw httpError(400, 'Un motif est requis pour refuser');
    const admin = await isAdmin(actor.role);
    const client = await db.getClient();
    let finalDecision: 'approve' | 'reject' | null = null;
    let request: ApprovalRequestRow | undefined;
    let requesterMessage = '';
    try {
      await client.query('BEGIN');
      await setAuditUser(client, actor.userId);
      const lock = await client.query(`SELECT * FROM approval_requests WHERE id = $1 FOR UPDATE`, [requestId]);
      request = lock.rows[0];
      if (!request) throw httpError(404, 'Demande introuvable');
      if (request.status !== 'pending') throw httpError(409, 'Cette demande est déjà clôturée');
      if (request.requested_by === actor.userId) throw httpError(403, 'Séparation des tâches : vous ne pouvez pas approuver votre propre demande');
      if (!admin && actor.storeId && request.store_id && request.store_id !== actor.storeId) throw httpError(403, 'Cette pièce relève d\'un autre établissement');

      const steps = (await client.query(`SELECT * FROM approval_steps WHERE request_id = $1 ORDER BY step_order FOR UPDATE`, [requestId])).rows as ApprovalStepRow[];
      const delegations = (await client.query(
        `SELECT d.from_user_id, fu.role AS from_role FROM approval_delegations d JOIN users fu ON fu.id = d.from_user_id
          WHERE d.to_user_id = $1 AND CURRENT_DATE BETWEEN d.starts_on AND d.ends_on`, [actor.userId])).rows as { from_user_id: string; from_role: string }[];
      const canDecide = (s: ApprovalStepRow) =>
        admin || s.approver_user_id === actor.userId || (!!s.approver_role && s.approver_role === actor.role)
        || delegations.some(d => d.from_user_id === s.approver_user_id || (!!s.approver_role && d.from_role === s.approver_role));
      const pending = steps.filter(s => s.status === 'pending');
      const mine = pending.find(canDecide);
      if (!mine) {
        const waitingFor = pending.map(s => s.approver_role ?? 'une personne désignée').join(', ');
        throw httpError(403, `Cette étape attend la décision de : ${waitingFor}`);
      }

      if (decision === 'reject') {
        await client.query(`UPDATE approval_steps SET status = 'rejected', decided_by = $2, decided_at = now(), reason = $3 WHERE id = $1`, [mine.id, actor.userId, reason!.trim()]);
        await client.query(`UPDATE approval_steps SET status = 'skipped' WHERE request_id = $1 AND status IN ('pending', 'waiting')`, [requestId]);
        await client.query(`UPDATE approval_requests SET status = 'rejected', decided_by = $2, decided_at = now(), decision_reason = $3 WHERE id = $1`, [requestId, actor.userId, reason!.trim()]);
        finalDecision = 'reject';
        requesterMessage = `Motif : ${reason!.trim()}`;
      } else {
        await client.query(`UPDATE approval_steps SET status = 'approved', decided_by = $2, decided_at = now(), reason = $3 WHERE id = $1`, [mine.id, actor.userId, reason?.trim() || null]);
        const stillPending = pending.filter(s => s.id !== mine.id);
        const next = steps.find(s => s.status === 'waiting');
        if (stillPending.length === 0 && next) {
          const rule = (await client.query(`SELECT escalate_after_hours FROM approval_rules WHERE id = $1`, [request.rule_id])).rows[0];
          const hours = rule?.escalate_after_hours ? Number(rule.escalate_after_hours) : null;
          await client.query(
            `UPDATE approval_steps SET status = 'pending', due_at = ${hours ? `now() + make_interval(hours => ${hours})` : 'NULL'} WHERE id = $1`, [next.id]);
          const requester = await client.query(`SELECT first_name || ' ' || last_name AS name FROM users WHERE id = $1`, [request.requested_by]);
          await client.query('COMMIT');
          await notifyStepApprovers(db, request, next, requester.rows[0]?.name ?? 'un utilisateur');
          return (await this.byId(requestId))!;
        }
        if (stillPending.length === 0) {
          await client.query(`UPDATE approval_requests SET status = 'approved', decided_by = $2, decided_at = now(), decision_reason = $3 WHERE id = $1`, [requestId, actor.userId, reason?.trim() || null]);
          finalDecision = 'approve';
          requesterMessage = APPROVAL_DOC_TYPES[request.doc_type]?.effect ?? '';
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    if (finalDecision && request) {
      const applyError = await applyDecision(request, actor.userId, finalDecision, reason);
      await notifyRequester(request, finalDecision === 'approve' ? 'approval_approved' : 'approval_rejected',
        applyError ? `${requesterMessage} Effet non appliqué : ${applyError}` : requesterMessage, actor.userId);
    }
    return (await this.byId(requestId))!;
  },

  /** Étapes en attente que l'acteur peut trancher (sa boîte « À approuver »). */
  async inbox(actor: ApprovalActor): Promise<ApprovalRequestRow[]> {
    if (!(await tablesReady())) return [];
    await this.escalateOverdue();
    const admin = await isAdmin(actor.role);
    const r = await db.query(
      `${REQUEST_SELECT}
        WHERE r.status = 'pending' AND r.requested_by <> $1
          AND ($3::boolean OR $4::uuid IS NULL OR r.store_id IS NULL OR r.store_id = $4)
          AND EXISTS (
            SELECT 1 FROM approval_steps s WHERE s.request_id = r.id AND s.status = 'pending' AND (
              $3::boolean OR s.approver_user_id = $1 OR s.approver_role = $2
              OR EXISTS (SELECT 1 FROM approval_delegations d JOIN users fu ON fu.id = d.from_user_id
                          WHERE d.to_user_id = $1 AND CURRENT_DATE BETWEEN d.starts_on AND d.ends_on
                            AND (d.from_user_id = s.approver_user_id OR fu.role = s.approver_role))))
        ORDER BY r.requested_at`,
      [actor.userId, actor.role, admin, actor.storeId ?? null]);
    return attachSteps(r.rows);
  },

  async inboxCount(actor: ApprovalActor): Promise<number> {
    return (await this.inbox(actor)).length;
  },

  /** Demandes faites par l'acteur, les plus récentes d'abord. */
  async mine(userId: string, limit = 50): Promise<ApprovalRequestRow[]> {
    if (!(await tablesReady())) return [];
    const r = await db.query(`${REQUEST_SELECT} WHERE r.requested_by = $1 ORDER BY r.requested_at DESC LIMIT $2`, [userId, limit]);
    return attachSteps(r.rows);
  },

  /** Historique (admin / gérant). */
  async list(filters: { status?: string; docType?: string; limit?: number; offset?: number }): Promise<{ rows: ApprovalRequestRow[]; total: number }> {
    if (!(await tablesReady())) return { rows: [], total: 0 };
    const conds: string[] = []; const vals: unknown[] = [];
    if (filters.status) { vals.push(filters.status); conds.push(`r.status = $${vals.length}`); }
    if (filters.docType) { vals.push(filters.docType); conds.push(`r.doc_type = $${vals.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const total = Number((await db.query(`SELECT count(*) FROM approval_requests r ${where}`, vals)).rows[0].count);
    vals.push(Math.min(filters.limit ?? 50, 200), filters.offset ?? 0);
    const r = await db.query(`${REQUEST_SELECT} ${where} ORDER BY r.requested_at DESC LIMIT $${vals.length - 1} OFFSET $${vals.length}`, vals);
    return { rows: await attachSteps(r.rows), total };
  },

  /** Étapes en retard : une seule alerte par étape, à l'administrateur et au demandeur. */
  async escalateOverdue(): Promise<number> {
    const r = await db.query(
      `UPDATE approval_steps s SET escalated_at = now()
         FROM approval_requests r
        WHERE r.id = s.request_id AND r.status = 'pending' AND s.status = 'pending'
          AND s.due_at IS NOT NULL AND s.due_at < now() AND s.escalated_at IS NULL
        RETURNING r.id, r.doc_label, r.requested_by, s.approver_role, s.approver_user_id, s.due_at`);
    for (const row of r.rows) {
      const who = row.approver_role ?? 'la personne désignée';
      await createNotification({
        targetRole: 'admin', type: 'approval_escalated', title: `Approbation en retard : ${row.doc_label}`,
        message: `En attente de ${who} depuis le ${new Date(row.due_at).toLocaleString('fr-FR')}.`,
        referenceType: 'approval_request', referenceId: row.id,
      });
    }
    return r.rows.length;
  },

  // ── Délégations ───────────────────────────────────────────────────────────
  /** Délégués possibles : administrateurs, gérants et collègues du même rôle (noms seulement). */
  async delegates(actor: ApprovalActor) {
    const r = await db.query(
      `SELECT u.id, u.first_name || ' ' || u.last_name AS name, u.role, rl.label AS role_label
         FROM users u JOIN roles rl ON rl.code = u.role
        WHERE u.is_active AND u.id <> $1 AND (rl.base_role IN ('admin', 'manager') OR u.role = $2)
        ORDER BY rl.base_role = 'admin' DESC, name`, [actor.userId, actor.role]);
    return r.rows;
  },

  async delegations(userId: string) {
    if (!(await tablesReady())) return [];
    const r = await db.query(
      `SELECT d.*, tu.first_name || ' ' || tu.last_name AS to_name, fu.first_name || ' ' || fu.last_name AS from_name
         FROM approval_delegations d JOIN users tu ON tu.id = d.to_user_id JOIN users fu ON fu.id = d.from_user_id
        WHERE (d.from_user_id = $1 OR d.to_user_id = $1) AND d.ends_on >= CURRENT_DATE - 30
        ORDER BY d.starts_on DESC`, [userId]);
    return r.rows;
  },

  async addDelegation(actor: ApprovalActor, data: { toUserId: string; startsOn?: string; endsOn: string }) {
    if (!data.toUserId || !data.endsOn) throw httpError(400, 'Délégué et date de fin requis');
    if (data.toUserId === actor.userId) throw httpError(400, 'On ne se délègue pas à soi-même');
    const to = await db.query(`SELECT id FROM users WHERE id = $1 AND is_active`, [data.toUserId]);
    if (!to.rows[0]) throw httpError(404, 'Délégué introuvable ou inactif');
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setAuditUser(client, actor.userId);
      const r = await client.query(
        `INSERT INTO approval_delegations (from_user_id, to_user_id, starts_on, ends_on, created_by)
         VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4::date, $1) RETURNING *`,
        [actor.userId, data.toUserId, data.startsOn ?? null, data.endsOn]);
      await client.query('COMMIT');
      return r.rows[0];
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      if ((err as { code?: string }).code === '23514') throw httpError(400, 'La date de fin doit suivre la date de début');
      throw err;
    } finally {
      client.release();
    }
  },

  async removeDelegation(actor: ApprovalActor, id: string) {
    const admin = await isAdmin(actor.role);
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setAuditUser(client, actor.userId);
      const r = await client.query(
        `DELETE FROM approval_delegations WHERE id = $1 AND ($3::boolean OR from_user_id = $2) RETURNING id`, [id, actor.userId, admin]);
      await client.query('COMMIT');
      if (!r.rows.length) throw httpError(404, 'Délégation introuvable');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },
};
