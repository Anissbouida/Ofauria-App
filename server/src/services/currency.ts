import { DEFAULT_CURRENCY, formatMoney, type CurrencyDisplay } from '@ofauria/shared';
import { db } from '../config/database.js';

/**
 * Devise de la société pour les documents (M3-06) : devise de base de la table
 * currencies (cache 60 s), repli sur le dirham.
 */
let cache: { at: number; value: CurrencyDisplay } | null = null;

export async function companyCurrency(): Promise<CurrencyDisplay> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  let value = DEFAULT_CURRENCY;
  try {
    const r = (await db.query(`SELECT code, symbol, decimals FROM currencies WHERE is_base LIMIT 1`)).rows[0];
    if (r) value = { code: String(r.code).trim(), symbol: r.symbol || String(r.code).trim(), decimals: Number(r.decimals ?? 2) };
  } catch { /* table absente : repli */ }
  cache = { at: Date.now(), value };
  return value;
}

export async function moneyText(amount: number | string | null | undefined, opts: { signed?: boolean; decimals?: number } = {}) {
  return formatMoney(amount, await companyCurrency(), opts);
}
