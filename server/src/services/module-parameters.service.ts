import { db } from '../config/database.js';

/**
 * Paramètres métier en table (mig 306) : remplacent les constantes de code et les
 * drapeaux d'environnement. Lecture côté serveur uniquement pour les règles ; le
 * client lit la même valeur via l'API pour l'affichage.
 */

export type ExpenseRequiresPo = { enabled: boolean; threshold: number; currency: string };

const DEFAULTS: Record<string, unknown> = {
  'purchasing.expense_requires_po': { enabled: false, threshold: 2000, currency: 'MAD' } satisfies ExpenseRequiresPo,
};

export async function getParameter<T>(key: string): Promise<T> {
  const r = await db.query(`SELECT value FROM module_parameters WHERE key = $1`, [key]);
  return (r.rows[0]?.value ?? DEFAULTS[key]) as T;
}

export async function listParameters(prefix: string) {
  const r = await db.query(
    `SELECT key, value, description, updated_at FROM module_parameters WHERE key LIKE $1 || '%' ORDER BY key`,
    [prefix],
  );
  return r.rows;
}

export async function setParameter(key: string, value: unknown, userId: string) {
  const r = await db.query(
    `UPDATE module_parameters SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1 RETURNING key, value, updated_at`,
    [key, JSON.stringify(value), userId],
  );
  return r.rows[0] ?? null;
}
