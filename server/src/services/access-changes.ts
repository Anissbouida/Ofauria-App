import { db } from '../config/database.js';
import { approvalService } from './approval.service.js';
import { userRepository } from '../repositories/user.repository.js';
import { roleRepository } from '../repositories/role.repository.js';
import { mfaRepository } from '../repositories/mfa.repository.js';
import { setRolePermissions, invalidatePermissionCaches } from './permissions.js';
import { invalidateRolesCache } from './access-rights.js';
import type { NormalizedPermission } from './permission-input.js';

/**
 * Changements d'accès sensibles (refonte Utilisateurs, lot 10, mig 710). Quand la politique
 * (security.approvals) coche un type de changement, la demande est mise en attente et passe par le
 * moteur d'approbation (pièce access_change, circuit « Changement d'accès sensible ») ; elle
 * s'applique quand un AUTRE administrateur l'approuve. Sans second administrateur actif, aucun
 * type ne peut être coché (personne ne pourrait approuver).
 */
export const ACCESS_CHANGE_KINDS = ['grant_admin', 'grant_mfa_role', 'role_rights', 'mfa_role_removed'] as const;
export type AccessChangeKind = typeof ACCESS_CHANGE_KINDS[number];

export class AccessChangeError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export type AccessChangePayload =
  | { type: 'user_roles'; userId: string; roles: string[]; primaryRole: string }
  | { type: 'role_rights'; code: string; perms: NormalizedPermission[] | null; keys: string[] | null }
  | { type: 'mfa_roles'; roles: string[] };

export async function approvalKinds(): Promise<AccessChangeKind[]> {
  const v = (await db.query(`SELECT value FROM module_parameters WHERE key = 'security.approvals'`)).rows[0]?.value;
  const kinds = Array.isArray(v?.kinds) ? (v.kinds as string[]) : [];
  return kinds.filter((k): k is AccessChangeKind => (ACCESS_CHANGE_KINDS as readonly string[]).includes(k));
}

export async function setApprovalKinds(kinds: string[], actorId: string): Promise<AccessChangeKind[]> {
  const clean = [...new Set(kinds)].filter((k): k is AccessChangeKind => (ACCESS_CHANGE_KINDS as readonly string[]).includes(k));
  if (clean.length !== new Set(kinds).size) throw new AccessChangeError('Type de changement inconnu');
  if (clean.length && (await userRepository.countActiveAdmins()) < 2) {
    throw new AccessChangeError('Il faut au moins deux administrateurs actifs : personne ne peut approuver sa propre demande.', 409);
  }
  await db.query(
    `INSERT INTO module_parameters (key, value, description, updated_by, updated_at)
     VALUES ('security.approvals', $1::jsonb, 'Changements d''accès soumis à approbation (lot 10).', $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = $2, updated_at = now()`,
    [JSON.stringify({ kinds: clean }), actorId]);
  return clean;
}

/**
 * Met le changement en attente si son type est soumis à approbation ; sinon rend null et
 * l'appelant applique tout de suite. Le premier type coché parmi `kinds` l'emporte.
 */
export async function deferIfSensitive(kinds: AccessChangeKind[], label: string, payload: AccessChangePayload, actorId: string): Promise<{ id: string; label: string } | null> {
  const enabled = await approvalKinds();
  const kind = kinds.find(k => enabled.includes(k));
  if (!kind) return null;
  const id = (await db.query(
    `INSERT INTO pending_access_changes (kind, label, payload, requested_by) VALUES ($1, $2, $3, $4) RETURNING id`,
    [kind, label.slice(0, 200), JSON.stringify(payload), actorId])).rows[0].id as string;
  const submitted = await approvalService.submit({ docType: 'access_change', docId: id, docLabel: label, values: { kind }, requestedBy: actorId });
  if (submitted.outcome === 'not_required') {
    // Circuit désactivé dans Circuits d'approbation : le changement s'applique tout de suite.
    await db.query(`UPDATE pending_access_changes SET status = 'applied', decided_by = $2, decided_at = now() WHERE id = $1`, [id, actorId]);
    return null;
  }
  await db.query(`UPDATE pending_access_changes SET approval_request_id = $2 WHERE id = $1`, [id, submitted.request.id]);
  return { id, label };
}

/** Applique un changement (tout de suite, ou à l'approbation). */
export async function applyAccessChange(payload: AccessChangePayload, actorId: string): Promise<void> {
  if (payload.type === 'user_roles') {
    await userRepository.setRoleCodes(payload.userId, payload.roles, payload.primaryRole, actorId);
    await userRepository.bumpTokenVersion(payload.userId);
  } else if (payload.type === 'role_rights') {
    if (payload.perms) await roleRepository.setPermissions(payload.code, payload.perms, actorId);
    if (payload.keys) await setRolePermissions(payload.code, payload.keys, actorId);
  } else {
    await mfaRepository.setRequiredRoles(payload.roles, actorId);
  }
  invalidateRolesCache();
  invalidatePermissionCaches();
}

/** Approbation accordée (moteur d'approbation, pièce access_change). */
export async function applyPendingAccessChange(id: string, approverId: string): Promise<void> {
  const row = (await db.query(`SELECT payload, status FROM pending_access_changes WHERE id = $1`, [id])).rows[0];
  if (!row || row.status !== 'pending') return;
  try {
    await applyAccessChange(row.payload as AccessChangePayload, approverId);
    await db.query(`UPDATE pending_access_changes SET status = 'applied', decided_by = $2, decided_at = now() WHERE id = $1`, [id, approverId]);
  } catch (e) {
    await db.query(`UPDATE pending_access_changes SET status = 'failed', decided_by = $2, decided_at = now(), error = $3 WHERE id = $1`,
      [id, approverId, (e instanceof Error ? e.message : String(e)).slice(0, 500)]);
    throw e;
  }
}

export async function rejectPendingAccessChange(id: string, actorId: string): Promise<void> {
  await db.query(`UPDATE pending_access_changes SET status = 'rejected', decided_by = $2, decided_at = now() WHERE id = $1 AND status = 'pending'`, [id, actorId]);
}

export async function listAccessChanges(limit = 30) {
  return (await db.query(
    `SELECT c.id, c.kind, c.label, c.status, c.requested_at, c.decided_at, c.error, c.approval_request_id,
            NULLIF(concat_ws(' ', r.first_name, r.last_name), '') AS requested_by_name,
            NULLIF(concat_ws(' ', d.first_name, d.last_name), '') AS decided_by_name
       FROM pending_access_changes c
       LEFT JOIN users r ON r.id = c.requested_by
       LEFT JOIN users d ON d.id = c.decided_by
      ORDER BY (c.status = 'pending') DESC, c.requested_at DESC LIMIT $1`, [limit])).rows;
}
