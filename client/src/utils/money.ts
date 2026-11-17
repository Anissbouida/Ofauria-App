import { formatMoney, DEFAULT_CURRENCY, type CurrencyDisplay } from '@ofauria/shared';
import api from '../api/client';

/**
 * Devise de la société pour l'affichage (M3-06) : chargée une fois (devise de base de la
 * table currencies), repli sur le dirham tant qu'elle n'est pas connue.
 *   money(1234.5)      → « 1 234,50 DH »
 *   currencySymbol()   → « DH » (en-têtes de colonnes, unités « DH/h »)
 */
let current: CurrencyDisplay = DEFAULT_CURRENCY;
let loading: Promise<void> | null = null;

export function loadCompanyCurrency(): Promise<void> {
  if (!loading) {
    loading = api.get('/currencies').then(r => {
      const base = (r.data?.data as { code: string; symbol: string | null; decimals: number; is_base: boolean }[] | undefined)?.find(c => c.is_base);
      if (base) current = { code: base.code, symbol: base.symbol || base.code, decimals: Number(base.decimals ?? 2) };
    }).catch(() => { loading = null; });
  }
  return loading ?? Promise.resolve();
}

export const money = (amount: number | string | null | undefined, opts: { signed?: boolean; decimals?: number } = {}) => {
  void loadCompanyCurrency();
  return formatMoney(amount, current, opts);
};
export const currencySymbol = () => { void loadCompanyCurrency(); return current.symbol; };
