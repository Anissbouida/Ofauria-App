import { db } from '../config/database.js';
import { FLAGS } from '../config/feature-flags.js';

/**
 * Paramètres métier en table (mig 306) : remplacent les constantes de code et les
 * drapeaux d'environnement. Lecture côté serveur uniquement pour les règles ; le
 * client lit la même valeur via l'API pour l'affichage.
 */

export type ExpenseRequiresPo = { enabled: boolean; threshold: number; currency: string };

const DEFAULTS: Record<string, unknown> = {
  'purchasing.expense_requires_po': { enabled: false, threshold: 2000, currency: 'MAD' } satisfies ExpenseRequiresPo,
  'sales.quotes': { validity_days: 30 },
  'sales.dunning': { enabled: true, auto_send: false, min_amount: 50, credit_control: 'warn', auto_release: true },
  'sales.pos_stock': { mode: 'block' } satisfies PosStockRule,
  'sales.person_sizes': [4, 6, 8, 10, 12, 16],
};

/** Caisse (mig 374) : 'block' = stock vitrine respecté, 'allow' = tout produit vendable même sans stock. */
export type PosStockRule = { mode: 'block' | 'allow' };

/** Vente sans stock autorisée : par le paramètre, ou par le drapeau d'environnement de test. */
export async function posAllowsNegativeStock(): Promise<boolean> {
  if (FLAGS.POS_ALLOW_NEGATIVE_STOCK) return true;
  return (await getParameter<PosStockRule>('sales.pos_stock')).mode === 'allow';
}

/** Entremets par personne (mig 377) : tailles standard proposées en caisse. */
export async function getPersonSizes(): Promise<number[]> {
  const v = await getParameter<number[]>('sales.person_sizes');
  const sizes = (Array.isArray(v) ? v : []).map(Number).filter(n => Number.isFinite(n) && n > 0);
  return sizes.length ? sizes : [4, 6, 8, 10, 12, 16];
}

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
