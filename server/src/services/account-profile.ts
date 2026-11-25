import { db } from '../config/database.js';

/**
 * Fiche d'un compte (refonte Utilisateurs, lot 2) : ce qui le rattache au reste de Kalum, réglé
 * dans d'autres modules et réuni ici pour lecture — ateliers de production, modules en essai,
 * étapes de circuits d'approbation, délégations données et reçues, connexions externes.
 * « via » dit si le rattachement passe par un rôle du compte ou par le compte lui-même.
 */

export interface AccountAttachments {
  workshops: { code: string; label: string; via: 'user' | 'role'; roleCode: string | null }[];
  pilots: { moduleKey: string; via: 'user' | 'role'; roleCode: string | null }[];
  approvalSteps: { ruleCode: string; ruleLabel: string; docType: string; enabled: boolean; stepOrder: number; via: 'user' | 'role'; roleCode: string | null }[];
  delegations: { id: string; kind: 'role' | 'approvals'; direction: 'given' | 'received'; otherName: string; roleCode: string | null; startsAt: string; endsAt: string; reason: string | null; active: boolean }[];
  identities: { provider: string; email: string | null; lastLoginAt: string | null; createdAt: string }[];
}

async function tableExists(name: string): Promise<boolean> {
  return !!(await db.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${name}`])).rows[0]?.ok;
}

async function roleCodesOf(userId: string): Promise<string[]> {
  const r = await db.query(
    `SELECT role FROM users WHERE id = $1
     UNION SELECT role_code FROM user_roles WHERE user_id = $1`, [userId]);
  return r.rows.map(x => x.role as string).filter(Boolean);
}

export async function accountAttachments(userId: string): Promise<AccountAttachments> {
  const roles = await roleCodesOf(userId);
  const out: AccountAttachments = { workshops: [], pilots: [], approvalSteps: [], delegations: [], identities: [] };

  if (await tableExists('production_workshop_members')) {
    out.workshops = (await db.query(
      `SELECT w.code, w.label, CASE WHEN m.user_id = $1 THEN 'user' ELSE 'role' END AS via, m.role_code
         FROM production_workshop_members m JOIN production_workshops w ON w.code = m.workshop_code
        WHERE m.user_id = $1 OR m.role_code = ANY($2::text[])
        ORDER BY w.sort_order NULLS LAST, w.label`, [userId, roles])).rows
      .map(r => ({ code: r.code, label: r.label, via: r.via, roleCode: r.role_code ?? null }));
  }
  if (await tableExists('module_pilot_members')) {
    out.pilots = (await db.query(
      `SELECT module_key, CASE WHEN user_id = $1 THEN 'user' ELSE 'role' END AS via, role_code
         FROM module_pilot_members WHERE user_id = $1 OR role_code = ANY($2::text[]) ORDER BY module_key`, [userId, roles])).rows
      .map(r => ({ moduleKey: r.module_key, via: r.via, roleCode: r.role_code ?? null }));
  }
  if (await tableExists('approval_rule_steps')) {
    out.approvalSteps = (await db.query(
      `SELECT r.code, r.label, r.doc_type, r.enabled, s.step_order,
              CASE WHEN s.approver_user_id = $1 THEN 'user' ELSE 'role' END AS via, s.approver_role
         FROM approval_rule_steps s JOIN approval_rules r ON r.id = s.rule_id
        WHERE s.approver_user_id = $1 OR s.approver_role = ANY($2::text[])
        ORDER BY r.display_order NULLS LAST, r.label, s.step_order`, [userId, roles])).rows
      .map(r => ({ ruleCode: r.code, ruleLabel: r.label, docType: r.doc_type, enabled: !!r.enabled, stepOrder: Number(r.step_order), via: r.via, roleCode: r.approver_role ?? null }));
  }
  if (await tableExists('role_delegations')) {
    out.delegations.push(...(await db.query(
      `SELECT d.id::text, CASE WHEN d.from_user_id = $1 THEN 'given' ELSE 'received' END AS direction,
              trim(coalesce(o.first_name, '') || ' ' || coalesce(o.last_name, '')) AS other_name,
              d.role_code, d.starts_at, d.ends_at, d.reason, (now() BETWEEN d.starts_at AND d.ends_at) AS active
         FROM role_delegations d
         JOIN users o ON o.id = CASE WHEN d.from_user_id = $1 THEN d.to_user_id ELSE d.from_user_id END
        WHERE (d.from_user_id = $1 OR d.to_user_id = $1) AND d.ends_at >= now() - interval '30 days'
        ORDER BY d.starts_at DESC`, [userId])).rows
      .map(r => ({ id: `role-${r.id}`, kind: 'role' as const, direction: r.direction, otherName: r.other_name, roleCode: r.role_code, startsAt: r.starts_at, endsAt: r.ends_at, reason: r.reason ?? null, active: !!r.active })));
  }
  if (await tableExists('approval_delegations')) {
    out.delegations.push(...(await db.query(
      `SELECT d.id::text, CASE WHEN d.from_user_id = $1 THEN 'given' ELSE 'received' END AS direction,
              trim(coalesce(o.first_name, '') || ' ' || coalesce(o.last_name, '')) AS other_name,
              d.starts_on, d.ends_on, (CURRENT_DATE BETWEEN d.starts_on AND d.ends_on) AS active
         FROM approval_delegations d
         JOIN users o ON o.id = CASE WHEN d.from_user_id = $1 THEN d.to_user_id ELSE d.from_user_id END
        WHERE (d.from_user_id = $1 OR d.to_user_id = $1) AND d.ends_on >= CURRENT_DATE - 30
        ORDER BY d.starts_on DESC`, [userId])).rows
      .map(r => ({ id: `appr-${r.id}`, kind: 'approvals' as const, direction: r.direction, otherName: r.other_name, roleCode: null, startsAt: r.starts_on, endsAt: r.ends_on, reason: null, active: !!r.active })));
  }
  if (await tableExists('user_identities')) {
    out.identities = (await db.query(
      `SELECT provider, email, last_login_at, created_at FROM user_identities WHERE user_id = $1 ORDER BY provider`, [userId])).rows
      .map(r => ({ provider: r.provider, email: r.email ?? null, lastLoginAt: r.last_login_at ?? null, createdAt: r.created_at }));
  }
  return out;
}
