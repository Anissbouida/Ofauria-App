import { db } from '../config/database.js';
import { evaluateRoleCodesSod } from './governance.js';
import { mfaRepository } from '../repositories/mfa.repository.js';

/**
 * Fiche d'un rôle (refonte Utilisateurs, lot 4) : ce qui dépend du rôle, réglé dans d'autres
 * modules et réuni ici — comptes qui l'ont (rôle principal, rôle secondaire, délégation),
 * double authentification, plafonds d'approbation, séparation des tâches, circuits
 * d'approbation, ateliers, modules en essai, écrans publiés pour le rôle, modèle d'origine.
 */

export interface RoleMember {
  id: string; name: string; email: string; isActive: boolean; storeId: string | null;
  as: 'primary' | 'secondary'; since: string | null;
}
export interface RoleDelegationRow {
  id: number; fromName: string; toId: string; toName: string; startsAt: string; endsAt: string; reason: string | null; status: 'active' | 'scheduled';
}
export interface RoleProfile {
  origin: 'system' | 'template' | 'custom';
  template: { code: string; label: string; sectorCode: string | null; homeRoute: string | null } | null;
  members: RoleMember[];
  delegations: RoleDelegationRow[];
  actionKeys: string[];
  mfaRequired: boolean;
  approvalLimits: { documentType: string; maxAmount: number; currency: string }[];
  sod: {
    /** Règles que le rôle enfreint à lui seul. */
    alone: { code: string; label: string; severity: string }[];
    /** Rôles actifs dont le cumul avec celui-ci enfreint une règle. */
    incompatibleWith: { code: string; label: string; rules: string[] }[];
    /** Comptes actifs qui ont ce rôle et sont en conflit. */
    conflictAccounts: number;
  };
  approvalSteps: { ruleCode: string; ruleLabel: string; docType: string; enabled: boolean; stepOrder: number }[];
  workshops: { code: string; label: string }[];
  pilots: string[];
  screens: { screenKey: string; publishedAt: string | null }[];
}

async function tableExists(name: string): Promise<boolean> {
  return !!(await db.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${name}`])).rows[0]?.ok;
}

export async function roleOrigin(code: string, isSystem: boolean): Promise<RoleProfile['origin']> {
  if (isSystem) return 'system';
  if (!(await tableExists('sector_role_templates'))) return 'custom';
  return (await db.query(`SELECT 1 FROM sector_role_templates WHERE code = $1`, [code])).rows.length ? 'template' : 'custom';
}

export async function roleProfile(role: { code: string; is_system: boolean }): Promise<RoleProfile> {
  const code = role.code;
  const out: RoleProfile = {
    origin: await roleOrigin(code, role.is_system), template: null, members: [], delegations: [], actionKeys: [],
    mfaRequired: false, approvalLimits: [], sod: { alone: [], incompatibleWith: [], conflictAccounts: 0 },
    approvalSteps: [], workshops: [], pilots: [], screens: [],
  };

  if (out.origin === 'template') {
    const t = (await db.query(`SELECT code, label, sector_code, home_route FROM sector_role_templates WHERE code = $1`, [code])).rows[0];
    if (t) out.template = { code: t.code, label: t.label, sectorCode: t.sector_code ?? null, homeRoute: t.home_route ?? null };
  }

  // Titulaires : rôle principal (users.role) ou secondaire (user_roles), comptes désactivés compris.
  const hasUserRoles = await tableExists('user_roles');
  out.members = (await db.query(hasUserRoles
    ? `SELECT u.id, trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) AS name, u.email, u.is_active, u.store_id,
              (u.role = $1) AS is_primary, ur.assigned_at
         FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.role_code = $1
        WHERE (u.role = $1 OR ur.role_code IS NOT NULL) AND NOT coalesce(u.is_system, false)
        ORDER BY u.is_active DESC, (u.role = $1) DESC, u.first_name, u.last_name`
    : `SELECT u.id, trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) AS name, u.email, u.is_active, u.store_id,
              true AS is_primary, NULL::timestamptz AS assigned_at
         FROM users u WHERE u.role = $1 AND NOT coalesce(u.is_system, false) ORDER BY u.is_active DESC, u.first_name`, [code])).rows
    .map(r => ({ id: r.id, name: r.name || r.email, email: r.email, isActive: !!r.is_active, storeId: r.store_id ?? null,
      as: r.is_primary ? 'primary' as const : 'secondary' as const, since: r.assigned_at ?? null }));

  if (await tableExists('role_delegations')) {
    out.delegations = (await db.query(
      `SELECT d.id, trim(coalesce(f.first_name, '') || ' ' || coalesce(f.last_name, '')) AS from_name,
              d.to_user_id, trim(coalesce(t.first_name, '') || ' ' || coalesce(t.last_name, '')) AS to_name,
              d.starts_at, d.ends_at, d.reason, (now() >= d.starts_at) AS started
         FROM role_delegations d JOIN users f ON f.id = d.from_user_id JOIN users t ON t.id = d.to_user_id
        WHERE d.role_code = $1 AND d.ends_at > now() ORDER BY d.starts_at`, [code])).rows
      .map(r => ({ id: Number(r.id), fromName: r.from_name, toId: r.to_user_id, toName: r.to_name, startsAt: r.starts_at, endsAt: r.ends_at,
        reason: r.reason ?? null, status: r.started ? 'active' as const : 'scheduled' as const }));
  }

  if (await tableExists('role_action_permissions')) {
    out.actionKeys = (await db.query(`SELECT permission_key FROM role_action_permissions WHERE role_code = $1 ORDER BY 1`, [code])).rows
      .map(r => r.permission_key as string);
  }

  out.mfaRequired = (await mfaRepository.requiredRoles()).includes(code);

  if (await tableExists('approval_limits')) {
    out.approvalLimits = (await db.query(
      `SELECT document_type, max_amount, currency FROM approval_limits WHERE role_code = $1 ORDER BY document_type`, [code])).rows
      .map(r => ({ documentType: r.document_type, maxAmount: Number(r.max_amount), currency: r.currency }));
  }

  // Séparation des tâches : le rôle seul, puis cumulé avec chacun des autres rôles actifs.
  if (code !== 'admin' && await tableExists('sod_rules')) {
    out.sod.alone = (await evaluateRoleCodesSod([code])).map(v => ({ code: v.code, label: v.label, severity: v.severity }));
    const aloneCodes = new Set(out.sod.alone.map(v => v.code));
    const others = (await db.query(`SELECT code, label FROM roles WHERE is_active AND code <> $1 AND base_role <> 'admin' ORDER BY label`, [code])).rows;
    for (const o of others) {
      const rules = (await evaluateRoleCodesSod([code, o.code])).filter(v => !aloneCodes.has(v.code));
      if (rules.length) out.sod.incompatibleWith.push({ code: o.code, label: o.label, rules: rules.map(v => v.label) });
    }
    // Comptes actifs du rôle dont l'ensemble des rôles enfreint au moins une règle.
    const holders = out.members.filter(m => m.isActive).map(m => m.id);
    if (holders.length && (out.sod.alone.length || out.sod.incompatibleWith.length)) {
      const byUser = (await db.query(hasUserRoles
        ? `SELECT u.id, array_remove(array_agg(DISTINCT x.code), NULL) AS codes
             FROM users u LEFT JOIN LATERAL (SELECT u.role AS code UNION SELECT role_code FROM user_roles WHERE user_id = u.id) x ON true
            WHERE u.id = ANY($1::uuid[]) GROUP BY u.id`
        : `SELECT id, ARRAY[role] AS codes FROM users WHERE id = ANY($1::uuid[])`, [holders])).rows;
      for (const u of byUser) {
        if ((await evaluateRoleCodesSod(u.codes as string[])).length) out.sod.conflictAccounts++;
      }
    }
  }

  if (await tableExists('approval_rule_steps')) {
    out.approvalSteps = (await db.query(
      `SELECT r.code, r.label, r.doc_type, r.enabled, s.step_order
         FROM approval_rule_steps s JOIN approval_rules r ON r.id = s.rule_id
        WHERE s.approver_role = $1 ORDER BY r.display_order NULLS LAST, r.label, s.step_order`, [code])).rows
      .map(r => ({ ruleCode: r.code, ruleLabel: r.label, docType: r.doc_type, enabled: !!r.enabled, stepOrder: Number(r.step_order) }));
  }
  if (await tableExists('production_workshop_members')) {
    out.workshops = (await db.query(
      `SELECT w.code, w.label FROM production_workshop_members m JOIN production_workshops w ON w.code = m.workshop_code
        WHERE m.role_code = $1 ORDER BY w.sort_order NULLS LAST, w.label`, [code])).rows.map(r => ({ code: r.code, label: r.label }));
  }
  if (await tableExists('module_pilot_members')) {
    out.pilots = (await db.query(`SELECT module_key FROM module_pilot_members WHERE role_code = $1 ORDER BY 1`, [code])).rows.map(r => r.module_key as string);
  }
  if (await tableExists('screen_definitions')) {
    out.screens = (await db.query(
      `SELECT screen_key, published_at FROM screen_definitions WHERE scope_type = 'role' AND scope_id = $1 AND status = 'publie' ORDER BY screen_key`, [code])).rows
      .map(r => ({ screenKey: r.screen_key, publishedAt: r.published_at ?? null }));
  }
  return out;
}
