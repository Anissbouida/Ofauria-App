import api from './client';

export type ManualShiftEntry = {
  id: string;
  store_id: string;
  entry_date: string;
  matin_cash_reel: string | null;
  matin_cash_systeme: string | null;
  matin_carte_reel: string | null;
  matin_carte_systeme: string | null;
  soir_cash_reel: string | null;
  soir_cash_systeme: string | null;
  soir_carte_reel: string | null;
  soir_carte_systeme: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ManualShiftEntryUpsert = {
  entryDate: string;
  matin_cash_reel?: number | null;
  matin_cash_systeme?: number | null;
  matin_carte_reel?: number | null;
  matin_carte_systeme?: number | null;
  soir_cash_reel?: number | null;
  soir_cash_systeme?: number | null;
  soir_carte_reel?: number | null;
  soir_carte_systeme?: number | null;
  notes?: string | null;
};

export const manualShiftEntriesApi = {
  list: (params?: { dateFrom?: string; dateTo?: string }) =>
    api.get('/manual-shift-entries', { params }).then(r => r.data.data as ManualShiftEntry[]),
  upsert: (payload: ManualShiftEntryUpsert) =>
    api.put('/manual-shift-entries', payload).then(r => r.data.data as ManualShiftEntry),
};
