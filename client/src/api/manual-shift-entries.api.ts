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

/** Lecture seule (mig 415) : historique des saisies manuelles, retirées au profit des fermetures de caisse. */
export const manualShiftEntriesApi = {
  list: (params?: { dateFrom?: string; dateTo?: string }) =>
    api.get('/manual-shift-entries', { params }).then(r => r.data.data as ManualShiftEntry[]),
};
