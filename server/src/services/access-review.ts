import { db } from '../config/database.js';
import { effectiveRights, resolveRole } from './access-rights.js';
import { evaluateUserSod, approvalLimitFor } from './governance.js';
import { userRepository } from '../repositories/user.repository.js';
import { APPROVAL_DOCUMENT_TYPES } from '@ofauria/shared';

/**
 * Outils admin de revue des accès (Phase 3) — lecture seule :
 *   - accessReview  : « voir en tant que » — droits effectifs résolus d'un
 *                     utilisateur, avec provenance (quel rôle accorde quoi),
 *                     conflits de séparation des tâches et plafonds ;
 *   - accessHistory : historique des changements de droits de l'utilisateur
 *                     (journaux auth_events + config_audit_log) ;
 *   - accessOverview: tableau de revue de tous les comptes actifs.
 */

export interface AccessReviewModule {
  module: string;
  canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean;
  verbs: string[]; scope: string;
  grantedBy: string[]; // codes de rôle qui accordent ce module, ou '__custom__'
}

export async function accessReview(userId: string) {
  const user = await userRepository.findById(userId);
  if (!user) return null;
  const rights = await effectiveRights(userId);
  const ownCodes = await userRepository.getRoleCodes(userId);
  const roleInfos = await Promise.all(rights.roles.map(async code => {
    const info = await resolveRole(code);
    return { code: info.code, label: info.label, baseRole: info.baseRole, delegated: !ownCodes.includes(code) };
  }));

  // Provenance par module : les rôles dont les droits couvrent ce module.
  const perRole = new Map<string, Set<string>>(); // module -> roles
  if (!rights.isAdmin && rights.source === 'role' && rights.roles.length) {
    const rows = (await db.query(
      `SELECT role_code, module FROM role_permissions WHERE role_code = ANY($1::varchar[]) AND can_view`, [rights.roles])).rows;
    for (const r of rows) {
      const s = perRole.get(r.module) ?? new Set<string>();
      s.add(r.role_code); perRole.set(r.module, s);
    }
  }

  const modules: AccessReviewModule[] = rights.rows
    .filter(r => r.can_view || r.can_create || r.can_edit || r.can_delete)
    .map(r => {
      const cfg = (r.config ?? {}) as Record<string, unknown>;
      return {
        module: r.module,
        canView: r.can_view, canCreate: r.can_create, canEdit: r.can_edit, canDelete: r.can_delete,
        verbs: Array.isArray(cfg.verbs) ? cfg.verbs as string[] : [],
        scope: typeof cfg.scope === 'string' ? cfg.scope : 'store',
        grantedBy: rights.source === 'user' ? ['__custom__'] : [...(perRole.get(r.module) ?? [])],
      };
    });

  const sodViolations = await evaluateUserSod(userId);
  // Plafonds : table absente (mig 336 non appliquée) → tout dormant, pas de requête.
  const limitsExist = !!(await db.query(`SELECT to_regclass('public.approval_limits') AS ok`)).rows[0].ok;
  const limitRows = limitsExist
    ? await Promise.all(APPROVAL_DOCUMENT_TYPES.map(async dt => {
        const configured = (await db.query(`SELECT 1 FROM approval_limits WHERE document_type = $1 LIMIT 1`, [dt])).rows.length > 0;
        const limit = await approvalLimitFor(userId, dt);
        return { documentType: dt, configured, limit: Number.isFinite(limit) ? limit : null };
      }))
    : APPROVAL_DOCUMENT_TYPES.map(dt => ({ documentType: dt, configured: false, limit: null as number | null }));

  return {
    user: { id: user.id, name: `${user.first_name} ${user.last_name}`, email: user.email, storeId: user.store_id, isActive: user.is_active },
    isAdmin: rights.isAdmin,
    source: rights.source,
    roles: roleInfos,
    baseRoles: rights.baseRoles,
    modules,
    sodViolations,
    approvalLimits: limitRows,
  };
}

export interface AccessHistoryEntry {
  at: string;
  actor: string | null;
  kind: string;
  detail: Record<string, unknown>;
}

export async function accessHistory(userId: string): Promise<AccessHistoryEntry[]> {
  const events = (await db.query(
    `SELECT e.created_at, e.event_type, e.details, e.success,
            concat_ws(' ', a.first_name, a.last_name) AS actor
       FROM auth_events e LEFT JOIN users a ON a.id = e.user_id
      WHERE e.target_user_id = $1
        AND e.event_type IN ('user_created', 'user_updated', 'permission_changed')
      ORDER BY e.created_at DESC LIMIT 100`, [userId])).rows;

  // config_audit_log : affectations de rôle (trigger user_roles, subject_id = user_id).
  const hasAudit = (await db.query(`SELECT to_regclass('public.config_audit_log') AS t`)).rows[0].t;
  const audit = hasAudit ? (await db.query(
    `SELECT c.changed_at, c.table_name, c.operation, c.diff,
            concat_ws(' ', a.first_name, a.last_name) AS actor
       FROM config_audit_log c LEFT JOIN users a ON a.id = c.changed_by
      WHERE c.subject_id = $1 AND c.table_name = 'user_roles'
      ORDER BY c.changed_at DESC LIMIT 100`, [userId])).rows : [];

  const merged: AccessHistoryEntry[] = [
    ...events.map((e: Record<string, unknown>) => ({
      at: new Date(e.created_at as string).toISOString(),
      actor: (e.actor as string) || null,
      kind: e.event_type as string,
      detail: (e.details ?? {}) as Record<string, unknown>,
    })),
    ...audit.map((c: Record<string, unknown>) => ({
      at: new Date(c.changed_at as string).toISOString(),
      actor: (c.actor as string) || null,
      kind: `role_${c.operation as string}`,
      detail: { table: c.table_name, diff: c.diff },
    })),
  ];
  merged.sort((a, b) => (a.at < b.at ? 1 : -1));
  return merged.slice(0, 150);
}

export interface AccessOverviewRow {
  userId: string; name: string; email: string; roles: string[];
  hasCustomPerms: boolean; conflictCount: number; isActive: boolean;
}

export async function accessOverview(): Promise<AccessOverviewRow[]> {
  const users = (await db.query(
    `SELECT u.id, concat_ws(' ', u.first_name, u.last_name) AS name, u.email, u.is_active,
            COALESCE(array_agg(ur.role_code) FILTER (WHERE ur.role_code IS NOT NULL), ARRAY[]::varchar[]) AS roles,
            EXISTS (SELECT 1 FROM user_permissions up WHERE up.user_id = u.id) AS has_custom
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
      WHERE u.is_active
      GROUP BY u.id
      ORDER BY name`)).rows;

  const out: AccessOverviewRow[] = [];
  for (const u of users) {
    const roles = u.roles as string[];
    const violations = await evaluateUserSod(u.id);
    out.push({
      userId: u.id, name: u.name, email: u.email,
      roles, hasCustomPerms: !!u.has_custom, conflictCount: violations.length, isActive: u.is_active,
    });
  }
  return out;
}
