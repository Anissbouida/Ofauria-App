import { db } from '../config/database.js';
import { effectiveRights } from './access-rights.js';
import { evaluateSod, unionRights, type SodRule, type SodViolation, type EffectiveRights, type RightRow } from './access-rules.js';

/**
 * Gouvernance des droits (mig 336) : séparation des tâches (SoD), plafonds
 * d'approbation, en lecture base. Les délégations sont intégrées en amont par
 * access-rights (userRoleContext), donc déjà prises en compte ici via
 * effectiveRights.
 */

// ─── Séparation des tâches ────────────────────────────────────────────
let sodCache: { at: number; rules: SodRule[] } | null = null;
const TTL_MS = 30_000;

async function loadSodRules(): Promise<SodRule[]> {
  if (sodCache && Date.now() - sodCache.at < TTL_MS) return sodCache.rules;
  const exists = (await db.query(`SELECT to_regclass('public.sod_rules') IS NOT NULL AS ok`)).rows[0].ok as boolean;
  const rules: SodRule[] = exists
    ? (await db.query(`SELECT code, label, severity, a_module, a_right, b_module, b_right FROM sod_rules WHERE is_active`)).rows
    : [];
  sodCache = { at: Date.now(), rules };
  return rules;
}
export function invalidateSodCache() { sodCache = null; }

let sodModeCache: { at: number; mode: 'off' | 'log' | 'enforce' } | null = null;
export async function sodEnforcementMode(): Promise<'off' | 'log' | 'enforce'> {
  if (sodModeCache && Date.now() - sodModeCache.at < TTL_MS) return sodModeCache.mode;
  const has = (await db.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'company_settings' AND column_name = 'sod_enforcement'`)).rows.length > 0;
  const mode = (has
    ? (await db.query(`SELECT sod_enforcement AS m FROM company_settings WHERE id = 1`)).rows[0]?.m ?? 'off'
    : 'off') as 'off' | 'log' | 'enforce';
  sodModeCache = { at: Date.now(), mode };
  return mode;
}
export function invalidateSodMode() { sodModeCache = null; }

/** Conflits de séparation des tâches pour un utilisateur (ses rôles + délégations). */
export async function evaluateUserSod(userId: string): Promise<SodViolation[]> {
  const [rights, rules] = await Promise.all([effectiveRights(userId), loadSodRules()]);
  return evaluateSod(rights, rules);
}

/**
 * Conflits de séparation des tâches pour un ENSEMBLE de rôles, avant toute
 * persistance (contrôle à l'affectation). N'évalue que l'union des droits des
 * rôles (les exceptions par utilisateur ne sont pas considérées ici). Un rôle
 * de base admin exempte l'ensemble.
 */
export async function evaluateRoleCodesSod(roleCodes: string[]): Promise<SodViolation[]> {
  const rules = await loadSodRules();
  if (rules.length === 0 || roleCodes.length === 0) return [];
  const info = await db.query(`SELECT base_role FROM roles WHERE code = ANY($1::varchar[])`, [roleCodes]);
  if (info.rows.some((r: { base_role: string }) => r.base_role === 'admin')) return [];
  const r = await db.query(
    `SELECT module, can_view, can_create, can_edit, can_delete, config FROM role_permissions WHERE role_code = ANY($1::varchar[])`, [roleCodes]);
  const rows = unionRights(r.rows as RightRow[]);
  const rights: EffectiveRights = {
    roleCode: roleCodes[0], baseRole: '', roles: roleCodes, baseRoles: [], isAdmin: false, source: 'role', rows,
  };
  return evaluateSod(rights, rules);
}

export interface UserSodReport {
  userId: string;
  name: string;
  roleCode: string;
  violations: SodViolation[];
}

/** Scan de tous les comptes actifs : utilisateurs en conflit de séparation des tâches. */
export async function scanSodViolations(): Promise<UserSodReport[]> {
  const rules = await loadSodRules();
  if (rules.length === 0) return [];
  const users = (await db.query(
    `SELECT id, concat_ws(' ', first_name, last_name) AS name, role FROM users WHERE is_active ORDER BY name`)).rows;
  const out: UserSodReport[] = [];
  for (const u of users) {
    const rights = await effectiveRights(u.id);
    const violations = evaluateSod(rights, rules);
    if (violations.length > 0) out.push({ userId: u.id, name: u.name, roleCode: u.role, violations });
  }
  return out;
}

// ─── Plafonds d'approbation ───────────────────────────────────────────
/**
 * Plafond d'approbation effectif d'un utilisateur pour un type de document :
 * le plus élevé de ses rôles (délégations comprises). Administrateur : illimité.
 * Dormant : si aucun plafond n'est défini pour ce type de document (toutes
 * tables/rôles confondus), renvoie l'infini — la limite ne mord qu'une fois
 * configurée, pour ne pas bloquer les flux existants.
 */
export async function approvalLimitFor(userId: string, documentType: string): Promise<number> {
  const exists = (await db.query(`SELECT to_regclass('public.approval_limits') IS NOT NULL AS ok`)).rows[0].ok as boolean;
  if (!exists) return Infinity;
  const rights = await effectiveRights(userId);
  if (rights.isAdmin) return Infinity;
  const configured = (await db.query(`SELECT 1 FROM approval_limits WHERE document_type = $1 LIMIT 1`, [documentType])).rows.length > 0;
  if (!configured) return Infinity;
  if (rights.roles.length === 0) return 0;
  const r = await db.query(
    `SELECT COALESCE(MAX(max_amount), 0) AS m FROM approval_limits WHERE document_type = $1 AND role_code = ANY($2::varchar[])`,
    [documentType, rights.roles]);
  return Number(r.rows[0].m);
}

/** Vérifie qu'un montant est dans le plafond d'approbation de l'utilisateur. */
export async function checkApprovalLimit(userId: string, documentType: string, amount: number): Promise<{ allowed: boolean; limit: number }> {
  const limit = await approvalLimitFor(userId, documentType);
  return { allowed: amount <= limit, limit };
}
