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

/* ═══ Modèles d'écritures (mig 391) ═══ */
export type EntryTemplateLine = {
  id?: string; account_id: string; account_code?: string; account_name?: string;
  side: 'debit' | 'credit'; amount: number; label?: string | null;
};
export type EntryTemplate = {
  id: string; name: string; journal_code: string; journal_name?: string; description: string | null;
  is_active: boolean; line_count?: number; total_debit?: number; lines?: EntryTemplateLine[];
};
export type EntryTemplateInput = {
  name: string; journalCode?: string; description?: string | null;
  lines: { accountId: string; side: 'debit' | 'credit'; amount: number; label?: string | null }[];
};
export const entryTemplatesApi = {
  list: (): Promise<EntryTemplate[]> => api.get('/ledger/entry-templates').then(r => r.data.data),
  getById: (id: string): Promise<EntryTemplate> => api.get(`/ledger/entry-templates/${id}`).then(r => r.data.data),
  create: (data: EntryTemplateInput) => api.post('/ledger/entry-templates', data).then(r => r.data.data),
  update: (id: string, data: EntryTemplateInput) => api.put(`/ledger/entry-templates/${id}`, data).then(r => r.data.data),
  setActive: (id: string, active: boolean) => api.post(`/ledger/entry-templates/${id}/active`, { active }).then(r => r.data.data),
  remove: (id: string) => api.delete(`/ledger/entry-templates/${id}`).then(r => r.data.data),
  instantiate: (id: string, data: { date: string; label?: string | null; amounts?: Record<string, number> }): Promise<{ id: string; entry_number: string }> =>
    api.post(`/ledger/entry-templates/${id}/instantiate`, data).then(r => r.data.data),
};

/* ═══ Periodes fiscales ═══ */
export const fiscalPeriodsApi = {
  list: (year?: number): Promise<FiscalPeriod[]> =>
    api.get('/ledger/fiscal-periods', { params: year ? { year } : {} })
       .then(r => r.data.data),
  updateStatus: (id: string, status: 'open' | 'closed' | 'locked', note?: string): Promise<FiscalPeriod> =>
    api.patch(`/ledger/fiscal-periods/${id}/status`, { status, note }).then(r => r.data.data),
  /** Mig 311 : contrôles de clôture (bloquants / avertissements) et historique. */
  checklist: (id: string): Promise<CloseCheck[]> =>
    api.get(`/ledger/fiscal-periods/${id}/checklist`).then(r => r.data.data),
  events: (id: string): Promise<PeriodEvent[]> =>
    api.get(`/ledger/fiscal-periods/${id}/events`).then(r => r.data.data),
};

export interface CloseCheck { code: string; label: string; item_count: number; amount: string | null; blocking: boolean }
export interface PeriodEvent { id: string; from_status: string; to_status: string; user_name: string | null; note: string | null; at: string }

/* ═══ Mig 311 (D8) : comptabilité des achats ═══ */
export interface OutboxItem {
  id: string; source_kind: string; source_id: string; status: 'pending' | 'posted' | 'failed';
  attempts: number; last_error: string | null; created_at: string; document_label: string | null;
}
export interface GrirOpenItem {
  po_line_id: string; purchase_order_id: string; order_number: string; supplier_name: string | null;
  item_name: string | null; open_amount: string; first_event: string; age_days: number;
}
export interface VatStatementRow {
  invoice_id: string; invoice_number: string; supplier_invoice_number: string | null; invoice_date: string;
  supplier_name: string; supplier_ice: string | null; supplier_if: string | null;
  amount_ht: string; amount_tva: string; amount_ttc: string; vat_recoverable_from: string | null;
  is_vat_recoverable: boolean; vat_non_recoverable_reason: string | null; legal_issues: unknown; payments: string | null;
  flag_no_ice?: boolean; flag_internal_number?: boolean;
}
export const purchaseLedgerApi = {
  outbox: (status?: string): Promise<OutboxItem[]> =>
    api.get('/ledger/outbox', { params: status ? { status } : {} }).then(r => r.data.data),
  replay: (id?: string) =>
    api.post(id ? `/ledger/outbox/${id}/replay` : '/ledger/outbox/replay').then(r => r.data.data as { replayed: number; posted: number; failed: number; errors: string[] }),
  grirOpenItems: (params?: { supplierId?: string; minAge?: number }): Promise<GrirOpenItem[]> =>
    api.get('/ledger/grir/open-items', { params }).then(r => r.data.data),
  vatStatement: (startDate: string, endDate: string): Promise<VatStatementRow[]> =>
    api.get('/ledger/vat-deduction-statement', { params: { startDate, endDate } }).then(r => r.data.data),
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

/* ═══ Backfill (génération des écritures depuis l'historique) ═══ */
export interface BackfillSummary {
  invoices: number;
  payments: number;
  cashings: number;
  sales: number;
  shiftEntries: number;
  created: number;
  skipped: number;
  resynced: number;
  errors: number;
  errorSamples: string[];
}
export const ledgerBackfillApi = {
  run: (): Promise<BackfillSummary> =>
    api.post('/ledger/backfill').then(r => r.data.data),
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
export interface LedgerAccountBlock {
  code: string;
  label: string;
  normal_side: string;
  opening: number;
  total_debit: number;
  total_credit: number;
  closing: number;
  movements: LedgerMovement[];
}
export interface GeneralLedgerFullResult {
  accounts: LedgerAccountBlock[];
  total_debit: number;
  total_credit: number;
  account_count: number;
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
  generalLedgerFull: (params: PeriodParams & { account?: string; class?: number } = {}): Promise<GeneralLedgerFullResult> =>
    api.get('/ledger/general-ledger-full', { params }).then(r => r.data.data),
  balance: (params: PeriodParams = {}): Promise<BalanceRow[]> =>
    api.get('/ledger/balance', { params }).then(r => r.data.data),
  incomeStatement: (params: PeriodParams = {}): Promise<IncomeStatementResult> =>
    api.get('/ledger/income-statement', { params }).then(r => r.data.data),
  balanceSheet: (endDate: string): Promise<BalanceSheet> =>
    api.get('/ledger/balance-sheet', { params: { endDate } }).then(r => r.data.data),
  cashFlow: (params: { startDate: string; endDate: string }): Promise<CashFlowResult> =>
    api.get('/ledger/cash-flow', { params }).then(r => r.data.data),
};

export interface CashFlowResult {
  startDate: string; endDate: string;
  accounts: { code: string; label: string; opening: number; inflow: number; outflow: number; closing: number }[];
  openingTotal: number; inflowTotal: number; outflowTotal: number; closingTotal: number;
  nature: { account_class: number; label: string; inflow: number; outflow: number }[];
}

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
  // Mig 311 : TVA dont le droit n'est pas encore né (facture non soldée) et exclusions.
  pending_payment?: { count: number; amount: number };
  excluded?: { reason: string; count: number; amount: number }[];
}

export const tvaDeclarationApi = {
  declaration: (startDate: string, endDate: string): Promise<TvaDeclaration> =>
    api.get('/ledger/tva-declaration', { params: { startDate, endDate } }).then(r => r.data.data),
};
