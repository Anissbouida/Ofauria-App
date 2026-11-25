import { db } from '../config/database.js';

/**
 * Politique de sécurité (refonte Utilisateurs, lot 8, mig 708) — paramètre security.policy,
 * réglé dans Utilisateurs › Sécurité et connexions. Les valeurs par défaut sont celles qui étaient
 * fixées dans le code : 12 caractères, pas de renouvellement, verrouillage après 5 échecs pendant
 * 15 minutes, double authentification dès la prochaine connexion, PIN de 6 chiffres, déconnexion
 * après 15 minutes d'inactivité. La longueur du mot de passe ne descend jamais sous 12 : la forme
 * (majuscule, minuscule, chiffre, caractère spécial) reste vérifiée par strongPassword.
 */
export interface SecurityPolicy {
  passwordMinLength: number;
  /** 0 = jamais. */
  passwordMaxAgeDays: number;
  lockoutThreshold: number;
  lockoutMinutes: number;
  /** 0 = dès la prochaine connexion. */
  mfaGraceDays: number;
  pinMinLength: number;
  idleMinutes: number;
}

export const POLICY_DEFAULTS: SecurityPolicy = {
  passwordMinLength: 12, passwordMaxAgeDays: 0, lockoutThreshold: 5, lockoutMinutes: 15,
  mfaGraceDays: 0, pinMinLength: 6, idleMinutes: 15,
};

/** Valeurs admises : intervalle [min, max] ou liste fermée. */
export const POLICY_LIMITS: Record<keyof SecurityPolicy, { min: number; max: number } | number[]> = {
  passwordMinLength: { min: 12, max: 32 },
  passwordMaxAgeDays: [0, 90, 180, 365],
  lockoutThreshold: { min: 3, max: 10 },
  lockoutMinutes: { min: 5, max: 240 },
  mfaGraceDays: [0, 3, 7, 14, 30],
  pinMinLength: [4, 6],
  idleMinutes: [15, 60, 480, 1440],
};

const TTL_MS = 30_000;
let cache: { at: number; policy: SecurityPolicy } | null = null;

const allowed = (k: keyof SecurityPolicy, v: unknown): v is number => {
  const n = Number(v);
  if (!Number.isInteger(n)) return false;
  const lim = POLICY_LIMITS[k];
  return Array.isArray(lim) ? lim.includes(n) : n >= lim.min && n <= lim.max;
};

/** Politique en vigueur (valeurs invalides ou absentes → défaut). Cache de 30 s. */
export async function securityPolicy(): Promise<SecurityPolicy> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.policy;
  let raw: Record<string, unknown> = {};
  try {
    raw = (await db.query(`SELECT value FROM module_parameters WHERE key = 'security.policy'`)).rows[0]?.value ?? {};
  } catch { /* table absente : défauts */ }
  const policy = { ...POLICY_DEFAULTS };
  for (const k of Object.keys(POLICY_DEFAULTS) as (keyof SecurityPolicy)[]) {
    if (allowed(k, raw[k])) policy[k] = Number(raw[k]);
  }
  cache = { at: Date.now(), policy };
  return policy;
}

export function invalidateSecurityPolicy() { cache = null; }

/** Contrôle d'une politique reçue de l'écran : rend la politique complète, ou le message d'erreur. */
export function validatePolicy(input: Partial<Record<keyof SecurityPolicy, unknown>>, current: SecurityPolicy): SecurityPolicy | string {
  const out = { ...current };
  for (const k of Object.keys(input) as (keyof SecurityPolicy)[]) {
    if (!(k in POLICY_DEFAULTS)) return `Réglage inconnu : ${k}`;
    if (!allowed(k, input[k])) return `Valeur non admise pour ${k}`;
    out[k] = Number(input[k]);
  }
  return out;
}

export async function setSecurityPolicy(policy: SecurityPolicy, actorId: string): Promise<void> {
  await db.query(
    `INSERT INTO module_parameters (key, value, description, updated_by, updated_at)
     VALUES ('security.policy', $1::jsonb, 'Politique de sécurité (Utilisateurs › Sécurité et connexions).', $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = $2, updated_at = now()`,
    [JSON.stringify(policy), actorId]);
  invalidateSecurityPolicy();
}

/** Message si le mot de passe est plus court que la politique ; null sinon. */
export async function passwordPolicyError(password: string): Promise<string | null> {
  const { passwordMinLength } = await securityPolicy();
  return password.length < passwordMinLength ? `Le mot de passe doit compter ${passwordMinLength} caractères au moins` : null;
}

/** Message si le PIN ne respecte pas la politique (chiffres, longueur minimale, 10 au plus) ; null sinon. */
export async function pinPolicyError(pin: string): Promise<string | null> {
  const { pinMinLength } = await securityPolicy();
  return new RegExp(`^\\d{${pinMinLength},10}$`).test(pin) ? null : `Le code PIN doit compter ${pinMinLength} à 10 chiffres`;
}

/** Vrai si le mot de passe a dépassé la durée de renouvellement. */
export function passwordExpired(changedAt: Date | string | null | undefined, policy: SecurityPolicy): boolean {
  if (!policy.passwordMaxAgeDays || !changedAt) return false;
  return Date.now() - new Date(changedAt).getTime() > policy.passwordMaxAgeDays * 86_400_000;
}
