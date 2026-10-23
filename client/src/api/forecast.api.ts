import api from './client';

/** Prévision de la demande (mig 314). Calcul côté serveur : services/demand-forecast.ts. */

export type ForecastMethod = 'meme_jour' | 'evenement' | 'moyenne' | 'ferme' | 'insuffisant' | 'manuel';
export type ForecastConfidence = 'haute' | 'moyenne' | 'faible';
export type EventKind = 'ramadan' | 'fete' | 'vacances' | 'evenement' | 'fermeture';

export type ForecastCell = {
  qty: number;
  computed_qty: number;
  base: number;
  method: ForecastMethod;
  factors: { tendance: number; evenement: number; marge: number };
  n_obs: number;
  n_stockout: number;
  confidence: ForecastConfidence;
  event_label: string | null;
  explanation: string;
  override_reason: string | null;
  /** Vendu réel si la journée est passée, sinon null. */
  actual: number | null;
};

export type ForecastRow = {
  product_id: string;
  product_name: string;
  category_id: number | null;
  category_name: string | null;
  price: number;
  markup_pct: number;
  days: Record<string, ForecastCell>;
};

export type CalendarEvent = {
  id: string;
  store_id: string | null;
  date_start: string;
  date_end: string;
  kind: EventKind;
  label: string;
  uplift_pct: number;
  category_id: number | null;
  category_name?: string | null;
};

export type UnmappedKey = { product_key: string; product_name: string; sku: string | null; category: string | null; sold_60d: number };

export type AccuracyGroup = { key: string; days: number; forecast: number; actual: number; mape: number | null };

export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  ramadan: 'Ramadan',
  fete: 'Fête',
  vacances: 'Vacances',
  evenement: 'Événement',
  fermeture: 'Fermeture',
};

export const forecastApi = {
  grid: (params: { from?: string; to?: string }): Promise<{ store_id: string; dates: string[]; events: CalendarEvent[]; rows: ForecastRow[] }> =>
    api.get('/forecast/grid', { params }).then(r => r.data.data),
  day: (date: string): Promise<{ store_id: string; date: string; items: Array<Omit<ForecastRow, 'days'> & { forecast: ForecastCell }> }> =>
    api.get('/forecast/day', { params: { date } }).then(r => r.data.data),
  snapshot: (data: { date: string; usedFor: 'plan' | 'fiche' | 'manual'; productIds: string[] }) =>
    api.post('/forecast/snapshot', data).then(r => r.data),
  setOverride: (data: { productId: string; date: string; quantity: number; reason?: string | null }) =>
    api.put('/forecast/override', data).then(r => r.data.data),
  deleteOverride: (productId: string, date: string) =>
    api.delete('/forecast/override', { params: { productId, date } }).then(r => r.data),
  events: (from?: string): Promise<CalendarEvent[]> =>
    api.get('/forecast/events', { params: from ? { from } : {} }).then(r => r.data.data),
  saveEvent: (data: Omit<CalendarEvent, 'id' | 'store_id' | 'category_name'> & { id?: string; all_stores: boolean }) => {
    const { id, ...body } = data;
    return (id ? api.put(`/forecast/events/${id}`, body) : api.post('/forecast/events', body)).then(r => r.data.data);
  },
  deleteEvent: (id: string) => api.delete(`/forecast/events/${id}`).then(r => r.data),
  unmapped: (): Promise<UnmappedKey[]> => api.get('/forecast/links/unmapped').then(r => r.data.data),
  link: (productKey: string, productId: string | null) =>
    api.put(`/forecast/links/${encodeURIComponent(productKey)}`, { productId }).then(r => r.data),
  accuracy: (from: string, to: string): Promise<{ days: number; mape: number | null; byCategory: AccuracyGroup[]; byProduct: AccuracyGroup[] }> =>
    api.get('/forecast/accuracy', { params: { from, to } }).then(r => r.data.data),
};
