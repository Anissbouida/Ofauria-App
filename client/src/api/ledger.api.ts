import api from './client';
import type {
  Account,
  AccountAuxiliary,
  Journal,
  FiscalPeriod,
  JournalEntryDetail,
  JournalEntryFilters,
  JournalEntrySummary,
} from '@ofauria/shared';

/* ═══ Plan comptable CGNC ═══ */
export const planComptableApi = {
  list: (includeInactive = false): Promise<Account[]> =>
    api.get('/ledger/accounts', { params: includeInactive ? { includeInactive: 'true' } : {} })
       .then(r => r.data.data),
  getByCode: (code: string): Promise<Account> =>
    api.get(`/ledger/accounts/${code}`).then(r => r.data.data),
};

/* ═══ Tiers auxiliaires ═══ */
export const accountAuxiliariesApi = {
  list: (kind?: 'supplier' | 'customer'): Promise<AccountAuxiliary[]> =>
    api.get('/ledger/auxiliaries', { params: kind ? { kind } : {} })
       .then(r => r.data.data),
};

/* ═══ Journaux ═══ */
export const journalsApi = {
  list: (): Promise<Journal[]> =>
    api.get('/ledger/journals').then(r => r.data.data),
};

/* ═══ Periodes fiscales ═══ */
export const fiscalPeriodsApi = {
  list: (year?: number): Promise<FiscalPeriod[]> =>
    api.get('/ledger/fiscal-periods', { params: year ? { year } : {} })
       .then(r => r.data.data),
};

/* ═══ Reconciliation legacy <-> ledger ═══ */
export interface ReconciliationSummary {
  total_invoices: number;
  with_entries: number;
  missing_entries: number;
  divergent: number;
  aligned: number;
  total_delta: string;
}
export interface ReconciliationDivergence {
  invoice_id: string;
  invoice_number: string;
  invoice_type: 'received' | 'emitted';
  invoice_date: string;
  total_amount: string;
  legacy_remaining: string;
  ledger_remaining: string;
  delta: string;
  has_ledger_entries: boolean;
}
export const reconciliationApi = {
  check: (): Promise<{ summary: ReconciliationSummary; divergent: ReconciliationDivergence[] }> =>
    api.get('/ledger/reconciliation').then(r => r.data.data),
};

/* ═══ Ecritures comptables ═══ */
export const journalEntriesApi = {
  list: (filters: JournalEntryFilters = {}): Promise<{
    rows: JournalEntrySummary[];
    total: number;
  }> =>
    api.get('/ledger/entries', { params: filters }).then(r => ({
      rows: r.data.data,
      total: r.data.meta?.total ?? 0,
    })),
  getById: (id: string): Promise<JournalEntryDetail> =>
    api.get(`/ledger/entries/${id}`).then(r => r.data.data),
};
