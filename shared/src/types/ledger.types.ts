// Types du noyau comptable (plan comptable CGNC, journaux, ecritures).
// Lecture seule pour la Phase 1.

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'result';
export type NormalSide = 'D' | 'C';
export type AuxiliaryKind = 'supplier' | 'customer';
export type TvaDirection = 'collected' | 'deductible';

export interface Account {
  id: string;
  code: string;
  label: string;
  account_class: number;
  rubrique: string;
  poste: string;
  parent_id: string | null;
  account_type: AccountType;
  normal_side: NormalSide;
  is_collective: boolean;
  auxiliary_kind: AuxiliaryKind | null;
  tva_rate: string | null;
  tva_direction: TvaDirection | null;
  is_active: boolean;
  created_at: string;
}

export interface AccountAuxiliary {
  id: string;
  account_id: string;
  code: string;
  label: string;
  is_active: boolean;
  supplier_id: string | null;
  customer_id: string | null;
  supplier_name: string | null;
  customer_first_name: string | null;
  customer_last_name: string | null;
  account_code: string;
}

export type JournalKind = 'purchase' | 'sales' | 'bank' | 'cash' | 'misc';

export interface Journal {
  id: string;
  code: string;
  label: string;
  kind: JournalKind;
  is_active: boolean;
  display_order: number;
  default_counterpart_account_id: string | null;
  default_counterpart_code: string | null;
}

export type FiscalPeriodStatus = 'open' | 'closed' | 'locked';

export interface FiscalPeriod {
  id: string;
  year: number;
  month: number;
  start_date: string;
  end_date: string;
  status: FiscalPeriodStatus;
  closed_at: string | null;
  closed_by: string | null;
  closed_note: string | null;
  created_at: string;
}

export type JournalEntryStatus = 'draft' | 'posted' | 'reversed';
export type JournalEntrySourceKind = 'manual' | 'invoice' | 'payment' | 'sale' | 'reversal' | 'backfill';

export interface JournalEntrySummary {
  id: string;
  entry_number: string;
  entry_date: string;
  description: string | null;
  source_kind: JournalEntrySourceKind;
  source_id: string | null;
  status: JournalEntryStatus;
  posted_at: string | null;
  store_id: string | null;
  journal_id: string;
  journal_code: string;
  journal_label: string;
  journal_kind: JournalKind;
  fiscal_year: number;
  fiscal_month: number;
  fiscal_status: FiscalPeriodStatus;
  total_debit: string;
  total_credit: string;
  line_count: number;
}

export interface JournalEntryLine {
  id: string;
  line_order: number;
  debit: string;
  credit: string;
  label: string | null;
  lettrage_id: string | null;
  account_id: string;
  auxiliary_id: string | null;
  account_code: string;
  account_label: string;
  is_collective: boolean;
  auxiliary_code: string | null;
  auxiliary_label: string | null;
}

export interface JournalEntryDetail extends JournalEntrySummary {
  fiscal_period_id: string;
  posted_by: string | null;
  created_by: string | null;
  created_at: string;
  posted_by_email: string | null;
  created_by_email: string | null;
  lines: JournalEntryLine[];
}

export interface JournalEntryListResponse {
  data: JournalEntrySummary[];
  meta: { total: number; limit: number; offset: number };
}

export interface JournalEntryFilters {
  startDate?: string;
  endDate?: string;
  journalId?: string;
  status?: JournalEntryStatus;
  search?: string;
  limit?: number;
  offset?: number;
}
