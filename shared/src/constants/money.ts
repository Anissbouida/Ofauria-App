/**
 * Montants (M3-06, plan d'action 2026-11) : un seul formatage pour les écrans et les
 * documents, avec la devise de la société (table currencies, devise de base) au lieu de
 * « DH » écrit en dur. Repli : dirham (symbole DH, 2 décimales).
 */
export interface CurrencyDisplay {
  code: string;
  symbol: string;
  decimals: number;
}

export const DEFAULT_CURRENCY: CurrencyDisplay = { code: 'MAD', symbol: 'DH', decimals: 2 };

/**
 * « 1 234,50 DH ». `null` / non numérique → « — ». `signed` ajoute « + » aux montants positifs.
 * `locale` (G6-05) : séparateurs selon la langue de l'interface (« 1,234.50 DH » en anglais) ;
 * français par défaut (documents, serveur).
 */
export function formatMoney(
  amount: number | string | null | undefined,
  currency: CurrencyDisplay = DEFAULT_CURRENCY,
  opts: { signed?: boolean; decimals?: number; locale?: string } = {},
): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const d = opts.decimals ?? currency.decimals;
  const text = n.toLocaleString(opts.locale ?? 'fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  return `${opts.signed && n > 0 ? '+' : ''}${text} ${currency.symbol}`;
}
