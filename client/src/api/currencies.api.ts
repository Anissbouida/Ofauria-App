import api from './client';

/** Devises et taux de change (mig 363). Taux = DH pour 1 unité de devise ; MAD = devise de base. */
export type Currency = {
  code: string; label: string; symbol: string | null; decimals: number; is_base: boolean; is_active: boolean;
  rate: string | null; rate_date: string | null; rate_source: string | null;
};
export type ExchangeRate = { id: string; currency_code: string; valid_on: string; rate: string; source: string | null; created_by_name: string | null; created_at: string };

export const BASE_CURRENCY = 'MAD';

export const currenciesApi = {
  list: (opts: { all?: boolean; date?: string } = {}): Promise<Currency[]> =>
    api.get('/currencies', { params: { ...(opts.all ? { all: 'true' } : {}), ...(opts.date ? { date: opts.date } : {}) } }).then(r => r.data.data),
  rates: (code: string): Promise<ExchangeRate[]> => api.get(`/currencies/${code}/rates`).then(r => r.data.data),
  addRate: (code: string, data: { rate: number; validOn?: string; source?: string | null }): Promise<ExchangeRate> =>
    api.post(`/currencies/${code}/rates`, data).then(r => r.data.data),
  create: (data: { code: string; label: string; symbol?: string | null; decimals?: number }): Promise<Currency> => api.post('/currencies', data).then(r => r.data.data),
  setActive: (code: string, isActive: boolean): Promise<Currency> => api.patch(`/currencies/${code}`, { isActive }).then(r => r.data.data),
};

/** Montant formaté dans sa devise : « 1 250,00 € », « 3 685,00 DH ». */
export function fmtMoney(v: number | string | null | undefined, code: string = BASE_CURRENCY, symbol?: string | null) {
  const n = Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n} ${symbol ?? (code === BASE_CURRENCY ? 'DH' : code)}`;
}
