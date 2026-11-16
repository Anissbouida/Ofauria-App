/**
 * Plafond de remise manuelle par rôle (G0-19) — une seule règle pour les commandes,
 * les devis et la caisse : l'administrateur n'est pas borné, le gérant l'est par
 * `max_discount_pct_manager`, tous les autres rôles par `max_discount_pct_sales`
 * (paramètre sales.pricing).
 *
 * En caisse, un dépassement se valide par le PIN d'un responsable dont le propre
 * plafond couvre la remise. Le PIN suit les règles de la connexion : compte
 * verrouillé après plusieurs échecs, tentative journalisée.
 */
import type { Request } from 'express';
import { db } from '../config/database.js';
import { getParameter, type PricingRules } from './module-parameters.service.js';
import { userRepository } from '../repositories/user.repository.js';
import { authEventRepository } from '../repositories/auth-event.repository.js';
import { comparePin } from '../utils/hash.js';

const FAIL_THRESHOLD = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
// Hachage factice : même durée de réponse pour un compte inconnu ou sans PIN.
const DUMMY_HASH = '$2b$12$UxU1Tp4KJsAmO.WHvNvvveuwXdUvUlXrtWSW61B3P/ZS4ArHjAgt6';

/** Plafond de remise manuelle du rôle, en % ; null = non borné (administrateur). */
export async function discountCeiling(role: string): Promise<number | null> {
  if (role === 'admin') return null;
  const rules = await getParameter<PricingRules>('sales.pricing');
  return Number(role === 'manager' ? rules.max_discount_pct_manager : rules.max_discount_pct_sales);
}

/** Plafond dépassé ? Retourne le plafond du rôle, ou null si la remise est permise. */
export async function exceededCeiling(pct: number, role: string): Promise<number | null> {
  if (!(pct > 0)) return null;
  const max = await discountCeiling(role);
  return max !== null && pct > max + 0.001 ? max : null;
}

/** Responsables pouvant valider une remise en caisse : gérants et administrateurs actifs ayant un PIN. */
export async function discountApprovers(): Promise<{ id: string; first_name: string; last_initial: string; role: string; pin_length: number | null }[]> {
  const r = await db.query(
    `SELECT id, first_name, upper(left(btrim(last_name), 1)) AS last_initial, role, pin_length
       FROM users WHERE pin_code IS NOT NULL AND is_active = true AND role IN ('admin', 'manager')
      ORDER BY first_name, last_name`);
  return r.rows;
}

export type DiscountApproval =
  | { ok: true; approverId: string }
  | { ok: false; status: number; message: string };

/**
 * Validation d'une remise au-delà du plafond par le PIN d'un responsable (gérant ou
 * administrateur) dont le plafond couvre `pct`.
 */
export async function approveDiscountByPin(req: Request, approval: { userId: string; pinCode: string }, pct: number): Promise<DiscountApproval> {
  const user = await userRepository.findById(approval.userId);
  if (!user || !user.is_active || !user.pin_code || !['admin', 'manager'].includes(user.role)) {
    await comparePin(approval.pinCode, DUMMY_HASH);
    return { ok: false, status: 403, message: 'Validation refusée : choisissez un responsable disposant d\'un code PIN' };
  }
  const lockedUntil = await userRepository.isLocked(user.id);
  if (lockedUntil) return { ok: false, status: 423, message: 'Compte du responsable verrouillé après plusieurs codes erronés : réessayez plus tard' };

  if (!await comparePin(approval.pinCode, user.pin_code)) {
    const { count } = await userRepository.recordFailedLogin(user.id, FAIL_THRESHOLD, LOCK_DURATION_MS);
    await authEventRepository.recordFromRequest(req, {
      eventType: 'pin_login_failed', userId: user.id, email: user.email, success: false,
      details: { reason: 'discount_approval_bad_pin', failedCount: count },
    });
    return { ok: false, status: 403, message: `Code PIN du responsable incorrect (${Math.max(0, FAIL_THRESHOLD - count)} tentative(s) restante(s))` };
  }
  await userRepository.resetFailedLogins(user.id);

  const max = await exceededCeiling(pct, user.role);
  if (max !== null) return { ok: false, status: 403, message: `Remise de ${pct} % au-delà du plafond de ce responsable (${max} %) : demandez à un administrateur` };
  return { ok: true, approverId: user.id };
}
