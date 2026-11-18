import { DEFAULT_CURRENCY, formatMoney, type CurrencyDisplay } from '@ofauria/shared';
import { db } from '../config/database.js';

/**
 * Devise de la société (M3-06, G6-06) : devise de base de la table currencies, repli sur le dirham.
 *  - companyCurrency() / moneyText() : lecture asynchrone (cache 60 s) ;
 *  - currencySymbol() / baseCurrencyCode() : lecture synchrone de la dernière valeur connue,
 *    chargée au démarrage (index.ts) et rafraîchie à chaque companyCurrency(). Sans démarrage
 *    (tests, scripts) : dirham, comme avant.
 *      currencySymbol()   → « DH »  (suffixe d'un montant déjà formaté, en-têtes « Montant (DH) »)
 *      baseCurrencyCode() → « MAD » (comparaison avec currency_code ; en SQL : fn_base_currency(), mig 592)
 *  - PDFKit et ESC/POS gardent leur propre formatage des nombres : les polices n'ont pas
 *    l'espace fine insécable de toLocaleString ; seul le symbole vient d'ici.
 */
let cache: { at: number; value: CurrencyDisplay } | null = null;
let current: CurrencyDisplay = DEFAULT_CURRENCY;

export async function companyCurrency(): Promise<CurrencyDisplay> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  let value = DEFAULT_CURRENCY;
  try {
    const r = (await db.query(`SELECT code, symbol, decimals FROM currencies WHERE is_base LIMIT 1`)).rows[0];
    if (r) value = { code: String(r.code).trim(), symbol: r.symbol || String(r.code).trim(), decimals: Number(r.decimals ?? 2) };
  } catch { /* table absente : repli */ }
  cache = { at: Date.now(), value };
  current = value;
  return value;
}

export async function moneyText(amount: number | string | null | undefined, opts: { signed?: boolean; decimals?: number } = {}) {
  return formatMoney(amount, await companyCurrency(), opts);
}

/** Chargement au démarrage du serveur. */
export const loadCompanyCurrency = async () => { await companyCurrency(); };
export const currencySymbol = () => current.symbol;
export const baseCurrencyCode = () => current.code;

/** Signe monétaire générique « ¤ » d'un texte de catalogue → symbole de la société (« ¤ / kWh » → « DH / kWh »). */
export function withCurrency<T>(value: T): T {
  if (typeof value === 'string') return value.replace(/¤/g, current.symbol) as T;
  if (Array.isArray(value)) return value.map(withCurrency) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, withCurrency(v)])) as T;
  }
  return value;
}
