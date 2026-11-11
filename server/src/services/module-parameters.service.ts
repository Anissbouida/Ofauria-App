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
  'sales.person_sizes': { sizes: [4, 6, 8, 10, 12, 16] },
  'sales.pricing': { max_discount_pct_sales: 10, max_discount_pct_manager: 30, max_price_override_pct: 30 } satisfies PricingRules,
  'sales.legal_mentions': { enforce_customer_ice: false } satisfies LegalMentionsRules,
  'sales.returns': { enabled: false, max_days: 14, max_amount_without_approval: 500 } satisfies ReturnRules,
  'sales.vat_regime': { mode: 'debit' },
  'sales.stamp_duty': { enabled: false, rate_pct: 0.25, min_dh: 1, cash_only: true } satisfies StampDutyRules,
};

/**
 * Prix et remises (O2C L3, mig 443) : remise manuelle maximale par rôle (vendeuse/caissière,
 * gérant ; l'administrateur n'est pas borné) et écart maximal d'un prix saisi au prix grille
 * pour un gérant (au-delà, administrateur seulement).
 */
export type PricingRules = { max_discount_pct_sales: number; max_discount_pct_manager: number; max_price_override_pct: number };

/** Caisse (mig 374) : 'block' = stock vitrine respecté, 'allow' = tout produit vendable même sans stock. */
export type PosStockRule = { mode: 'block' | 'allow' };

/**
 * Mentions légales des factures émises (phase 5.6, mig 484) : contrôles obligatoires
 * à l'émission. `enforce_customer_ice` = une facture à un client professionnel sans
 * ICE est refusée (loi marocaine). Défaut activé ; désactivable dans Paramètres.
 */
export type LegalMentionsRules = { enforce_customer_ice: boolean };

export async function legalMentionsRules(): Promise<LegalMentionsRules> {
  // Forçage explicite par l'environnement (tests, par processus) : ne touche jamais la
  // production, qui laisse la variable vide et lit le paramètre (défaut désactivé).
  const forced = (process.env.ENFORCE_CUSTOMER_ICE ?? '').toLowerCase();
  if (['on', '1', 'true', 'yes'].includes(forced)) return { enforce_customer_ice: true };
  const v = await getParameter<Partial<LegalMentionsRules>>('sales.legal_mentions');
  return { enforce_customer_ice: v?.enforce_customer_ice === true };
}

/**
 * Droit de timbre (phase 5.7, mig 485) : taux et minimum, sur les règlements espèces.
 * Désactivé par défaut — en attente des réponses de l'expert-comptable.
 */
export type StampDutyRules = { enabled: boolean; rate_pct: number; min_dh: number; cash_only: boolean };
export async function stampDutyRules(): Promise<StampDutyRules> {
  const v = await getParameter<Partial<StampDutyRules>>('sales.stamp_duty');
  return {
    enabled: v?.enabled === true,
    rate_pct: Number(v?.rate_pct) || 0,
    min_dh: Number(v?.min_dh) || 0,
    cash_only: v?.cash_only !== false,
  };
}

/**
 * Retours en caisse (phase 8.1) : un retour au-delà du délai (max_days) ou du seuil de
 * remboursement sans approbation (max_amount_without_approval) est encadré. Désactivé par
 * défaut — additif, rien ne change tant qu'un admin ne l'active pas.
 */
export type ReturnRules = { enabled: boolean; max_days: number; max_amount_without_approval: number };
export async function returnRules(): Promise<ReturnRules> {
  const v = await getParameter<Partial<ReturnRules>>('sales.returns');
  // Forçage par l'environnement (tests, par processus) ; jamais la production.
  const forced = ['on', '1', 'true', 'yes'].includes((process.env.ENFORCE_RETURN_RULES ?? '').toLowerCase());
  return {
    enabled: forced || v?.enabled === true,
    max_days: Number(v?.max_days) || 0,
    max_amount_without_approval: Number(v?.max_amount_without_approval) || 0,
  };
}

/** Régime de TVA (phase 5.7) : débit (exigible à la facture) ou encaissement. Informatif. */
export type VatRegime = 'debit' | 'encaissement';
export async function vatRegime(): Promise<VatRegime> {
  const v = await getParameter<{ mode?: string }>('sales.vat_regime');
  return v?.mode === 'encaissement' ? 'encaissement' : 'debit';
}

/** Vente sans stock autorisée : par le paramètre, ou par le drapeau d'environnement de test. */
export async function posAllowsNegativeStock(): Promise<boolean> {
  if (FLAGS.POS_ALLOW_NEGATIVE_STOCK) return true;
  return (await getParameter<PosStockRule>('sales.pos_stock')).mode === 'allow';
}

/** Entremets par personne (mig 377) : tailles standard proposées en caisse. */
export async function getPersonSizes(): Promise<number[]> {
  const v = await getParameter<number[] | { sizes?: number[] }>('sales.person_sizes');
  const raw = Array.isArray(v) ? v : (v?.sizes ?? []);
  const sizes = [...new Set(raw.map(Number).filter(n => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
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
