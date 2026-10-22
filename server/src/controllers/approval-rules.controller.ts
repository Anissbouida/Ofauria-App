import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { db } from '../config/database.js';
import { setAuditUser } from '../utils/audit-context.js';
import { APPROVAL_DOC_TYPES, APPROVAL_OPS, type ApprovalDocTypeDef } from '@ofauria/shared';

/**
 * Paramètres › Circuits d'approbation (lot 8, mig 333) : règles, conditions,
 * étapes. Les demandes en cours gardent leurs étapes copiées : modifier une
 * règle n'affecte que les soumissions suivantes.
 */

const bad = (res: Response, message: string, status = 400) => res.status(status).json({ success: false, error: { message } });
const DOC_TYPES = APPROVAL_DOC_TYPES as Record<string, ApprovalDocTypeDef>;

async function ready(): Promise<boolean> {
  return !!(await db.query(`SELECT to_regclass('public.approval_rules') AS t`)).rows[0]?.t;
}

type StepInput = { approverRole?: string | null; approverUserId?: string | null };

/** Condition : champ connu du type de pièce, opérateur connu, valeur du bon type. Vide = toujours. */
function validateCondition(docType: string, cond: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  if (cond === null || cond === undefined) return { ok: true, value: {} };
  if (typeof cond !== 'object' || Array.isArray(cond)) return { ok: false, message: 'Condition invalide' };
  const c = cond as { field?: unknown; op?: unknown; value?: unknown };
  if (!c.field) return { ok: true, value: {} };
  const field = DOC_TYPES[docType]?.fields[String(c.field)];
  if (!field) return { ok: false, message: `Champ inconnu pour ce type de pièce : ${String(c.field)}` };
  if (!c.op || !(String(c.op) in APPROVAL_OPS)) return { ok: false, message: 'Opérateur invalide' };
  if (field.kind === 'number') {
    const n = Number(c.value);
    if (c.value === '' || c.value === null || c.value === undefined || !Number.isFinite(n) || n < 0) return { ok: false, message: 'La valeur doit être un nombre positif' };
    return { ok: true, value: { field: c.field, op: c.op, value: n } };
  }
  const allowed = (field.options ?? []).map(o => o.value);
  if (!allowed.includes(String(c.value))) return { ok: false, message: 'Valeur hors liste' };
  if (!['eq', 'neq'].includes(String(c.op))) return { ok: false, message: 'Une liste se compare avec = ou ≠' };
  return { ok: true, value: { field: c.field, op: c.op, value: String(c.value) } };
}

async function validateSteps(steps: unknown): Promise<{ ok: true; value: { role: string | null; userId: string | null }[] } | { ok: false; message: string }> {
  if (!Array.isArray(steps) || steps.length === 0) return { ok: false, message: 'Au moins un approbateur est requis' };
  if (steps.length > 10) return { ok: false, message: 'Dix étapes au maximum' };
  const out: { role: string | null; userId: string | null }[] = [];
  for (const s of steps as StepInput[]) {
    if (s?.approverUserId) {
      const u = await db.query(`SELECT 1 FROM users WHERE id = $1 AND is_active`, [s.approverUserId]);
      if (!u.rows.length) return { ok: false, message: 'Approbateur introuvable ou inactif' };
      out.push({ role: null, userId: s.approverUserId });
    } else if (s?.approverRole) {
      const r = await db.query(`SELECT 1 FROM roles WHERE code = $1 AND is_active`, [s.approverRole]);
      if (!r.rows.length) return { ok: false, message: `Rôle inconnu : ${s.approverRole}` };
      out.push({ role: s.approverRole, userId: null });
    } else {
      return { ok: false, message: 'Chaque étape désigne un rôle ou une personne' };
    }
  }
  return { ok: true, value: out };
}

async function listRules() {
  const rules = await db.query(
    `SELECT r.*, u.first_name || ' ' || u.last_name AS updated_by_name,
            (SELECT count(*) FROM approval_requests q WHERE q.rule_id = r.id AND q.status = 'pending') AS pending_count,
            (SELECT count(*) FROM approval_requests q WHERE q.rule_id = r.id AND q.requested_at > now() - interval '30 days') AS requests_30d,
            (SELECT count(*) FROM approval_requests q WHERE q.rule_id = r.id AND q.status = 'rejected' AND q.requested_at > now() - interval '30 days') AS rejected_30d
       FROM approval_rules r LEFT JOIN users u ON u.id = r.updated_by
      ORDER BY r.display_order, r.code`);
  const steps = await db.query(
    `SELECT s.*, CASE WHEN s.approver_user_id IS NOT NULL THEN au.first_name || ' ' || au.last_name ELSE rl.label END AS approver_name
       FROM approval_rule_steps s LEFT JOIN users au ON au.id = s.approver_user_id LEFT JOIN roles rl ON rl.code = s.approver_role
      ORDER BY s.rule_id, s.step_order`);
  return rules.rows.map(r => ({
    ...r,
    pending_count: Number(r.pending_count), requests_30d: Number(r.requests_30d), rejected_30d: Number(r.rejected_30d),
    steps: steps.rows.filter(s => s.rule_id === r.id),
  }));
}

async function saveSteps(client: { query: (t: string, p?: unknown[]) => Promise<unknown> }, ruleId: string, steps: { role: string | null; userId: string | null }[]) {
  await client.query(`DELETE FROM approval_rule_steps WHERE rule_id = $1`, [ruleId]);
  for (const [i, s] of steps.entries()) {
    await client.query(`INSERT INTO approval_rule_steps (rule_id, step_order, approver_role, approver_user_id) VALUES ($1, $2, $3, $4)`,
      [ruleId, i + 1, s.role, s.userId]);
  }
}

export const approvalRulesController = {
  async list(_req: AuthRequest, res: Response) {
    if (!(await ready())) { res.json({ success: true, data: [] }); return; }
    res.json({ success: true, data: await listRules() });
  },

  async create(req: AuthRequest, res: Response) {
    if (!(await ready())) { bad(res, 'Approbations non disponibles sur cette base (migration 333)', 409); return; }
    const b = req.body ?? {};
    const code = String(b.code ?? '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(code)) { bad(res, 'Code : lettres minuscules, chiffres et _ (2 à 40 caractères)'); return; }
    const label = String(b.label ?? '').trim();
    if (!label || label.length > 120) { bad(res, 'Libellé requis (120 caractères au plus)'); return; }
    const docType = String(b.docType ?? '');
    if (!DOC_TYPES[docType]) { bad(res, 'Type de pièce inconnu'); return; }
    const cond = validateCondition(docType, b.condition);
    if (!cond.ok) { bad(res, cond.message); return; }
    const steps = await validateSteps(b.steps);
    if (!steps.ok) { bad(res, steps.message); return; }
    const mode = b.mode === 'parallel' ? 'parallel' : 'serial';
    const esc = b.escalateAfterHours === null || b.escalateAfterHours === undefined || b.escalateAfterHours === '' ? null : Number(b.escalateAfterHours);
    if (esc !== null && (!Number.isInteger(esc) || esc < 1 || esc > 720)) { bad(res, 'Délai d\'escalade : entre 1 et 720 heures'); return; }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setAuditUser(client, req.user?.userId);
      const order = (await client.query(`SELECT COALESCE(MAX(display_order), 0) + 10 AS o FROM approval_rules`)).rows[0].o;
      const r = await client.query(
        `INSERT INTO approval_rules (code, label, doc_type, enabled, condition, mode, escalate_after_hours, display_order, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [code, label, docType, b.enabled === undefined ? true : !!b.enabled, JSON.stringify(cond.value), mode, esc, order, req.user?.userId ?? null]);
      await saveSteps(client, r.rows[0].id, steps.value);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      if ((err as { code?: string }).code === '23505') { bad(res, 'Ce code existe déjà', 409); return; }
      throw err;
    } finally {
      client.release();
    }
    res.status(201).json({ success: true, data: (await listRules()).find(r => r.code === code) });
  },

  async update(req: AuthRequest, res: Response) {
    if (!(await ready())) { bad(res, 'Approbations non disponibles sur cette base (migration 333)', 409); return; }
    const existing = (await db.query(`SELECT * FROM approval_rules WHERE code = $1`, [req.params.code])).rows[0];
    if (!existing) { bad(res, 'Règle inconnue', 404); return; }
    const b = req.body ?? {};
    const sets: string[] = []; const vals: unknown[] = [existing.id];
    const push = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if (b.label !== undefined) {
      const label = String(b.label).trim();
      if (!label || label.length > 120) { bad(res, 'Libellé requis (120 caractères au plus)'); return; }
      push('label', label);
    }
    if (b.enabled !== undefined) push('enabled', !!b.enabled);
    if (b.condition !== undefined) {
      const cond = validateCondition(existing.doc_type, b.condition);
      if (!cond.ok) { bad(res, cond.message); return; }
      push('condition', JSON.stringify(cond.value));
    }
    if (b.mode !== undefined) {
      if (!['serial', 'parallel'].includes(b.mode)) { bad(res, 'Mode : série ou parallèle'); return; }
      push('mode', b.mode);
    }
    if (b.escalateAfterHours !== undefined) {
      const esc = b.escalateAfterHours === null || b.escalateAfterHours === '' ? null : Number(b.escalateAfterHours);
      if (esc !== null && (!Number.isInteger(esc) || esc < 1 || esc > 720)) { bad(res, 'Délai d\'escalade : entre 1 et 720 heures'); return; }
      push('escalate_after_hours', esc);
    }
    let steps: { role: string | null; userId: string | null }[] | null = null;
    if (b.steps !== undefined) {
      const v = await validateSteps(b.steps);
      if (!v.ok) { bad(res, v.message); return; }
      steps = v.value;
    }
    if (!sets.length && !steps) { bad(res, 'Rien à modifier'); return; }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setAuditUser(client, req.user?.userId);
      vals.push(req.user?.userId ?? null);
      await client.query(`UPDATE approval_rules SET ${[...sets, `updated_by = $${vals.length}`, 'updated_at = now()'].join(', ')} WHERE id = $1`, vals);
      if (steps) await saveSteps(client, existing.id, steps);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    res.json({ success: true, data: (await listRules()).find(r => r.code === req.params.code) });
  },

  async remove(req: AuthRequest, res: Response) {
    if (!(await ready())) { bad(res, 'Approbations non disponibles sur cette base (migration 333)', 409); return; }
    const existing = (await db.query(`SELECT id FROM approval_rules WHERE code = $1`, [req.params.code])).rows[0];
    if (!existing) { bad(res, 'Règle inconnue', 404); return; }
    const pending = (await db.query(`SELECT count(*) FROM approval_requests WHERE rule_id = $1 AND status = 'pending'`, [existing.id])).rows[0].count;
    if (Number(pending) > 0) { bad(res, `${pending} demande(s) en attente sur cette règle : désactivez-la plutôt`, 409); return; }
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setAuditUser(client, req.user?.userId);
      await client.query(`DELETE FROM approval_rules WHERE id = $1`, [existing.id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    res.json({ success: true });
  },
};
