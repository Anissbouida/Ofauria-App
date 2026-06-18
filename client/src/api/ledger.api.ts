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
  updateStatus: (id: string, status: 'open' | 'closed' | 'locked', note?: string): Promise<FiscalPeriod> =>
    api.patch(`/ledger/fiscal-periods/${id}/status`, { status, note }).then(r => r.data.data),
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

/* ═══ Etats comptables ═══ */
export interface LedgerMovement {
  entry_date: string;
  entry_number: string;
  journal_code: string;
  entry_description: string | null;
  line_label: string | null;
  debit: string;
  credit: string;
  lettrage_id: string | null;
  auxiliary_code: string | null;
  auxiliary_label: string | null;
}
export interface GeneralLedgerResult {
  account: { code: string; label: string; normal_side: string; account_type: string };
  opening: number;
  movements: LedgerMovement[];
}
export interface BalanceRow {
  code: string;
  label: string;
  account_class: number;
  account_type: string;
  normal_side: string;
  total_debit: string;
  total_credit: string;
  balance: string;
}
export interface IncomeStatementResult {
  charges: { code: string; label: string; account_class: number; amount: string }[];
  produits: { code: string; label: string; account_class: number; amount: string }[];
  total_charges: number;
  total_produits: number;
  resultat_net: number;
}

interface PeriodParams { startDate?: string; endDate?: string }

export interface BilanLine { code: string; label: string; amount: number }
export interface BalanceSheet {
  end_date: string;
  actif: {
    immobilise: BilanLine[]; total_immobilise: number;
    circulant: BilanLine[]; total_circulant: number;
    tresorerie: BilanLine[]; total_tresorerie: number;
    total: number;
  };
  passif: {
    financement_permanent: BilanLine[]; resultat_net: number; total_financement: number;
    circulant: BilanLine[]; total_circulant: number;
    tresorerie: BilanLine[]; total_tresorerie: number;
    total: number;
  };
  ecart: number;
}

export const financialStatementsApi = {
  generalLedger: (account: string, params: PeriodParams = {}): Promise<GeneralLedgerResult> =>
    api.get('/ledger/general-ledger', { params: { account, ...params } }).then(r => r.data.data),
  balance: (params: PeriodParams = {}): Promise<BalanceRow[]> =>
    api.get('/ledger/balance', { params }).then(r => r.data.data),
  incomeStatement: (params: PeriodParams = {}): Promise<IncomeStatementResult> =>
    api.get('/ledger/income-statement', { params }).then(r => r.data.data),
  balanceSheet: (endDate: string): Promise<BalanceSheet> =>
    api.get('/ledger/balance-sheet', { params: { endDate } }).then(r => r.data.data),
};

/* ═══ Declaration TVA (CA20) ═══ */
export interface TvaLine {
  code: string;
  label: string;
  tva_rate: string;
  tva_direction: 'collected' | 'deductible';
  amount: string;
}
export interface TvaDeclaration {
  period: { startDate: string; endDate: string };
  collected: TvaLine[];
  deductible: TvaLine[];
  total_collected: number;
  total_deductible: number;
  tva_due: number;
}

export const tvaDeclarationApi = {
  declaration: (startDate: string, endDate: string): Promise<TvaDeclaration> =>
    api.get('/ledger/tva-declaration', { params: { startDate, endDate } }).then(r => r.data.data),
};
