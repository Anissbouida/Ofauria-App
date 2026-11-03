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
  // Plan modifiable (mig 429)
  usage: (id: string): Promise<AccountUsage> => api.get(`/ledger/accounts/${id}/usage`).then(r => r.data.data),
  create: (b: AccountInput): Promise<Account> => api.post('/ledger/accounts', b).then(r => r.data.data),
  update: (id: string, b: AccountInput): Promise<Account> => api.put(`/ledger/accounts/${id}`, b).then(r => r.data.data),
  setActive: (id: string, active: boolean): Promise<Account> => api.post(`/ledger/accounts/${id}/active`, { active }).then(r => r.data.data),
  remove: (id: string): Promise<void> => api.delete(`/ledger/accounts/${id}`).then(() => undefined),
};
export interface AccountInput {
  code: string; label: string;
  accountType?: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'result' | null; normalSide?: 'D' | 'C' | null;
  isCollective?: boolean; auxiliaryKind?: 'supplier' | 'customer' | null;
  tvaRate?: number | null; tvaDirection?: 'collected' | 'deductible' | null;
}
export interface AccountUsage {
  lines: number; balance: number; children: number; auxiliaries: number;
  references: { what: string; n: number }[]; history: number;
}

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

/* ═══ Saisie libre d'écritures (mig 418) ═══ */
export interface ManualEntryLineInput {
  accountId: string; auxiliaryId?: string | null; debit: number; credit: number; label?: string | null;
}
export interface ManualEntryInput {
  journalCode: string; date: string; description: string;
  pieceRef?: string | null; pieceDate?: string | null;
  lines: ManualEntryLineInput[];
}
/** Détail d'écriture enrichi : pièce justificative, origine de saisie, liens d'extourne. */
export type JournalEntryDetailEx = JournalEntryDetail & {
  source_detail: string | null; piece_ref: string | null; piece_date: string | null;
  reversed_by_number: string | null; reversal_of_number: string | null;
};
export const manualEntriesApi = {
  createDraft: (b: ManualEntryInput): Promise<{ id: string }> => api.post('/ledger/entries', b).then(r => r.data.data),
  createAndPost: (b: ManualEntryInput): Promise<{ id: string; entry_number: string }> =>
    api.post('/ledger/entries/post', b).then(r => r.data.data),
  updateDraft: (id: string, b: ManualEntryInput): Promise<{ id: string }> => api.put(`/ledger/entries/${id}`, b).then(r => r.data.data),
  deleteDraft: (id: string): Promise<{ id: string }> => api.delete(`/ledger/entries/${id}`).then(r => r.data.data),
  post: (id: string): Promise<{ id: string; entry_number: string }> => api.post(`/ledger/entries/${id}/post`).then(r => r.data.data),
  reverse: (id: string, b: { date?: string | null; reason: string }): Promise<{ reversal_number: string | null }> =>
    api.post(`/ledger/entries/${id}/reverse`, b).then(r => r.data.data),
};

/* ═══ Lettrage manuel (mig 420) ═══ */
export interface LettrageAccount {
  id: string; code: string; label: string; is_collective: boolean; auxiliary_kind: 'supplier' | 'customer' | null;
  lines: number; open_lines: number; open_balance: string;
}
export interface LettrageTiers { id: string; code: string; label: string; lines: number; open_lines: number; open_balance: string }
export interface LettrageLine {
  id: string; lettrage_id: string | null; code: string | null; lettered_at: string | null;
  debit: string; credit: string; label: string | null;
  entry_id: string; entry_number: string; entry_date: string; description: string; piece_ref: string | null;
  source_kind: string; status: string; journal_code: string;
  frozen: boolean;                   // exercice clôturé : lettrage figé
}
export interface LettrageView {
  account: { id: string; code: string; label: string; is_collective: boolean };
  closed_until: string | null;
  totals: { open_debit: string; open_credit: string; open_lines: number; groups: number };
  lines: LettrageLine[]; truncated: boolean;
}
export type LettrageStatus = 'open' | 'lettered' | 'all';
export const lettrageApi = {
  accounts: (): Promise<LettrageAccount[]> => api.get('/ledger/lettrage/accounts').then(r => r.data.data),
  tiers: (accountId: string): Promise<LettrageTiers[]> => api.get(`/ledger/lettrage/accounts/${accountId}/tiers`).then(r => r.data.data),
  lines: (p: { accountId: string; auxiliaryId?: string; status: LettrageStatus; from?: string; to?: string }): Promise<LettrageView> =>
    api.get('/ledger/lettrage/lines', { params: p }).then(r => r.data.data),
  letter: (lineIds: string[]): Promise<{ lettrage_id: string; lines: number }> =>
    api.post('/ledger/lettrage', { lineIds }).then(r => r.data.data),
  unletter: (lettrageId: string): Promise<{ lettrage_id: string; lines: number }> =>
    api.delete(`/ledger/lettrage/${lettrageId}`).then(r => r.data.data),
  /** Factures soldées par leurs règlements (lien des pièces), à lettrer d'un coup. */
  autoPreview: (p: { accountId?: string; auxiliaryId?: string }): Promise<{ invoices: number; lines: number }> =>
    api.get('/ledger/lettrage/auto', { params: p }).then(r => r.data.data),
  auto: (p: { accountId?: string; auxiliaryId?: string }): Promise<{ invoices: number; lines: number }> =>
    api.post('/ledger/lettrage/auto', p).then(r => r.data.data),
};

/* ═══ Éditions comptables PDF / Excel ═══ */
export type EditionKind = 'journal' | 'grand-livre' | 'balance' | 'bilan' | 'cpc' | 'balance-agee' | 'immobilisations' | 'cessions' | 'analytique' | 'is' | 'ecarts-conversion' | 'liasse';
export type EditionParams = { startDate?: string; endDate?: string; journal?: string; account?: string; class?: number; side?: 'suppliers' | 'customers'; axis?: string; table?: LiasseTable; model?: LiasseModel };
export const editionsApi = {
  /** Télécharge l'état ; une erreur (JSON renvoyé en blob) est relue pour son message. */
  async download(kind: EditionKind, format: 'pdf' | 'xlsx', params: EditionParams): Promise<void> {
    let r;
    try {
      r = await api.get(`/ledger/editions/${kind}`, { params: { ...params, format }, responseType: 'blob' });
    } catch (err) {
      const data = (err as { response?: { data?: Blob } }).response?.data;
      if (data instanceof Blob) {
        const text = await data.text().catch(() => '');
        let message = 'Édition impossible';
        try { message = JSON.parse(text)?.error?.message || message; } catch { /* corps non JSON */ }
        throw new Error(message);
      }
      throw err;
    }
    const name = /filename="([^"]+)"/.exec(String(r.headers['content-disposition'] ?? ''))?.[1] ?? `${kind}.${format}`;
    const url = URL.createObjectURL(r.data as Blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
  },
};

/* ═══ Balance âgée comptable (lignes non lettrées des comptes de tiers) ═══ */
export type AgedSide = 'suppliers' | 'customers';
export type AgedBucket = 'current' | 'd30' | 'd60' | 'd90' | 'over90';
export interface AgedItem {
  key: string; kind: 'invoice' | 'payment' | 'opening' | 'other';
  reference: string; label: string; doc_date: string; due_date: string; days_late: number;
  amount: number; bucket: AgedBucket;
}
export interface AgedTiers {
  auxiliary_id: string; code: string; label: string; account_code: string;
  customer_id: string | null; supplier_id: string | null;
  total: number; overdue: number; buckets: Record<AgedBucket, number>; max_days_late: number; items: AgedItem[];
}
export interface AgedBalance {
  side: AgedSide; as_of: string;
  totals: { total: number; overdue: number; buckets: Record<AgedBucket, number>; tiers: number };
  ledger_balance: number;            // solde comptable des comptes de tiers : doit égaler totals.total
  tiers: AgedTiers[];
}
export const agedBalanceApi = {
  get: (side: AgedSide, asOf: string): Promise<AgedBalance> =>
    api.get('/ledger/aged-balance', { params: { side, asOf } }).then(r => r.data.data),
};

/* ═══ Exercices (mig 416) : clôture annuelle et à-nouveaux ═══ */
export interface FiscalYear {
  id: string; year: number; start_date: string; end_date: string;
  status: 'open' | 'closed';
  closed_at: string | null; closed_by_name: string | null;
  result_amount: string | null;      // figé à la clôture
  result_to_date: string;            // provisoire tant que l'exercice est ouvert
  months_open: number; months_total: number;
  chain_seq: number | null; chain_hash: string | null;
  opening_entries: string[];
}
export interface FiscalYearCloseResult {
  year: number; result: number; periods_locked: number; chain_seq: number; chain_hash: string;
  opening_entries: { entry_number: string; store_id: string | null; lines: number }[];
}
export const fiscalYearsApi = {
  list: (): Promise<FiscalYear[]> => api.get('/ledger/fiscal-years').then(r => r.data.data),
  checklist: (year: number): Promise<CloseCheck[]> =>
    api.get(`/ledger/fiscal-years/${year}/checklist`).then(r => r.data.data),
  close: (year: number): Promise<FiscalYearCloseResult> =>
    api.post(`/ledger/fiscal-years/${year}/close`).then(r => r.data.data),
  /** FEC de l'exercice et son attestation d'intégrité (même génération). */
  fec: (year: number): Promise<FecExport> => api.get('/ledger/fec', { params: { year } }).then(r => r.data.data),
};
export interface FecExport {
  filename: string; content: string; attestationFilename: string; attestation: string;
  stats: { entries: number; lines: number; totalDebit: number; totalCredit: number; sha256: string; start: string; end: string };
}

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
export interface PeriodEvent {
  id: string; from_status: string; to_status: string; user_name: string | null; note: string | null; at: string;
  /** Tête de chaîne inscrite à la clôture/verrouillage (mig 413). */
  chain_seq: number | null; chain_hash: string | null;
}

/* ═══ Mig 413 : inaltérabilité (chaînage, gardes, journal d'audit) ═══ */
export interface IntegrityGuard { table: string; trigger: string; role: string; enabled: boolean; missing: boolean }
export interface IntegrityStatus {
  sealed: number;
  unsealed: number;
  last_sealed_at: string | null;
  oldest_unsealed_at: string | null;
  headSeq: number;
  headHash: string | null;
  guards: IntegrityGuard[];
  lastVerify: { at: string; details: { ok: boolean; anomalies: number; checked: number; head_seq: number }; first_name: string | null; last_name: string | null } | null;
  lastAnchor: { at: string; to_status: string; chain_seq: number; chain_hash: string; month: number; year: number } | null;
}
export interface IntegrityAnomaly { seq: number; entry_id: string | null; entry_no: string | null; problem: string }
export interface IntegrityVerifyResult { ok: boolean; checked: number; headSeq: number; headHash: string | null; anomalies: IntegrityAnomaly[] }
export type LedgerAuditEvent = 'post' | 'reverse' | 'draft_delete' | 'letter' | 'unletter' | 'reletter' | 'seal' | 'verify' | 'outbox_replay' | 'year_close' | 'fec_export';
export interface LedgerAuditRow {
  id: string; at: string; event: LedgerAuditEvent;
  entry_id: string | null; entry_number: string | null; line_id: string | null; lettrage_id: string | null;
  client_ip: string | null; details: Record<string, unknown> | null;
  first_name: string | null; last_name: string | null;
}

export const integrityApi = {
  status: (): Promise<IntegrityStatus> => api.get('/ledger/integrity').then(r => r.data.data),
  seal: (): Promise<{ sealed: number; headSeq: number; headHash: string | null }> =>
    api.post('/ledger/integrity/seal').then(r => r.data.data),
  verify: (): Promise<IntegrityVerifyResult> => api.post('/ledger/integrity/verify').then(r => r.data.data),
  auditLog: (params: { event?: LedgerAuditEvent; before?: string; limit?: number }): Promise<LedgerAuditRow[]> =>
    api.get('/ledger/audit-log', { params }).then(r => r.data.data),
};

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
  lettered: number;
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
  /** Mig 416 : ouverture (fenêtre de cumul + à-nouveaux) et clôture = ouverture + solde de la période. */
  opening: number;
  closing: number;
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
    financement_permanent: BilanLine[]; resultat_net: number; resultat_anterieur: number; total_financement: number;
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

/* ═══ Impôt sur les sociétés (mig 430) ═══ */
export interface TaxParams {
  regime: 'standard' | 'credit'; rate_standard: number; rate_high: number; high_threshold: number; rate_credit: number;
  cm_rate: number; cm_minimum: number; cm_exempt: boolean; cm_base_override: number | null;
}
export interface TaxPayment { id: string; kind: 'acompte' | 'solde'; quarter: number | null; amount: number; paid_on: string; treasury: string; reference: string | null; entry_number: string }
export interface CorporateTax {
  year: number; params: TaxParams; status: 'draft' | 'booked'; booked_at: string | null; charge_entry_number: string | null;
  accounting_result: number; produits: number; charges: number;
  adjustments: { id: string; kind: 'reintegration' | 'deduction'; label: string; amount: number }[];
  reintegrations: number; deductions: number; taxable_result: number;
  cm_lines: { code: string; label: string; amount: number }[]; cm_base_computed: number; cm_base: number;
  rate: number; is_amount: number; cm_amount: number; tax_due: number; cm_applies: boolean;
  basis: { source: 'previous' | 'none'; tax: number | null; taxable: number | null; cm: number | null };
  prior_credit: number;
  schedule: { quarter: number; due_date: string; theoretical: number | null; credit_used: number; to_pay: number | null; payment: TaxPayment | null }[];
  payments: TaxPayment[]; acomptes_paid: number; available: number; imputed: number;
  balance_due: number; credit_after: number; solde_paid: number; solde_deadline: string; net_result: number;
}
export const corporateTaxApi = {
  get: (year: number): Promise<CorporateTax> => api.get(`/ledger/corporate-tax/${year}`).then(r => r.data.data),
  setParams: (year: number, p: Partial<TaxParams>) => api.put(`/ledger/corporate-tax/${year}/params`, p).then(r => r.data.data),
  addAdjustment: (year: number, b: { kind: 'reintegration' | 'deduction'; label: string; amount: number }) =>
    api.post(`/ledger/corporate-tax/${year}/adjustments`, b).then(r => r.data.data),
  removeAdjustment: (id: string) => api.delete(`/ledger/corporate-tax/adjustments/${id}`).then(r => r.data.data),
  pay: (year: number, b: { kind: 'acompte' | 'solde'; quarter?: number; amount: number; date: string; treasury: 'bank' | 'cash'; reference?: string }): Promise<{ entry_number: string }> =>
    api.post(`/ledger/corporate-tax/${year}/payments`, b).then(r => r.data.data),
  cancelPayment: (id: string, reason: string) => api.post(`/ledger/corporate-tax/payments/${id}/cancel`, { reason }).then(r => r.data.data),
  book: (year: number): Promise<{ entry_number: string; tax_due: number; imputed: number; balance_due: number }> =>
    api.post(`/ledger/corporate-tax/${year}/book`).then(r => r.data.data),
  unbook: (year: number, reason: string) => api.post(`/ledger/corporate-tax/${year}/unbook`, { reason }).then(r => r.data.data),
};

/* ═══ Réévaluation des devises (mig 431) ═══ */
export interface FxRevaluationLine {
  invoice_id: string; invoice_number: string; external_ref: string | null; invoice_date: string; tiers: string | null;
  side: 'receivable' | 'payable'; currency_code: string; foreign_remaining: number; book_rate: number; book_amount: number;
  closing_rate: number | null; closing_amount: number | null; difference: number | null; account_code: string | null;
}
export interface FxRevaluation {
  year: number; closing_date: string; status: 'draft' | 'booked'; fiscal_year_closed: boolean; booked_at: string | null;
  reval_entry_number: string | null; reopen_entry_number: string | null;
  rates: Record<string, { rate: number | null; valid_on: string | null; source: 'saisi' | 'table' | 'manquant' }>;
  missing_rates: string[]; lines: FxRevaluationLine[];
  loss_total: number; gain_total: number; provision: number; provision_reversal: number; previous_provision: number;
  realized: { loss: number; gain: number; net: number };
}
export const fxRevaluationApi = {
  get: (year: number, rates: Record<string, number> = {}): Promise<FxRevaluation> => {
    const q = Object.entries(rates).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}`).join(',');
    return api.get(`/ledger/fx-revaluation/${year}`, { params: q ? { rates: q } : {} }).then(r => r.data.data);
  },
  book: (year: number, rates: Record<string, number>): Promise<{ reval_entry_number: string; reopen_entry_number: string | null; provision: number }> =>
    api.post(`/ledger/fx-revaluation/${year}/book`, { rates }).then(r => r.data.data),
  cancel: (year: number, reason: string) => api.post(`/ledger/fx-revaluation/${year}/cancel`, { reason }).then(r => r.data.data),
};

/* ═══ Liasse fiscale (lot Bonus 14) ═══ */
export type LiasseModel = 'normal' | 'simplifie';
export type LiasseTable = 'actif' | 'passif' | 'cpc' | 'esg' | 'passage';
export type LiasseKind = 'line' | 'group' | 'subtotal' | 'total';
export type LiasseAmountLine = { id: string; label: string; kind: LiasseKind; accounts: string[]; amount: number; previous: number };
export type LiasseActifLine = { id: string; label: string; kind: LiasseKind; accounts: string[]; gross: number; amort: number; net: number; previous_net: number };
export type Liasse = {
  year: number; model: LiasseModel; closing_date: string; suggested_model: LiasseModel;
  company: { name: string; if?: string; ice?: string; rc?: string; patente?: string; address?: string; city?: string };
  actif: LiasseActifLine[]; passif: LiasseAmountLine[]; cpc: LiasseAmountLine[]; tfr: LiasseAmountLine[]; caf: LiasseAmountLine[];
  totals: { actif: number; passif: number; result: number; revenue: number; previous_result: number };
  passage: {
    net_result: number; reintegrations: { label: string; amount: number }[]; deductions: { label: string; amount: number }[];
    taxable_result: number; tax_due: number; cm_amount: number; is_amount: number; rate: number; tax_status: 'draft' | 'booked';
  };
  controls: { level: 'error' | 'warning'; message: string }[];
  status: 'final' | 'provisional'; has_previous: boolean;
};
export const liasseApi = {
  get: (year: number, model: LiasseModel): Promise<Liasse> => api.get(`/ledger/liasse/${year}`, { params: { model } }).then(r => r.data.data),
};

/* ═══ Télédéclarations EDI (portail SIMPL de la DGI) ═══ */
export type EdiIssue = { level: 'error' | 'warning'; message: string };
export type VatDeductionEdi = {
  period: { year: number; period: number; regime: 1 | 2; start: string; end: string };
  lines: { ord: number; invoice_id: string; num: string; des: string; mht: number; tva: number; ttc: number; supplier: string;
    if: string | null; ice: string | null; tx: number; mp: number; payment_mode: string | null; dpai: string | null; dfac: string }[];
  totals: { ht: number; tva: number; ttc: number }; issues: EdiIssue[]; filename: string;
};
export type Ir9421Edi = {
  year: number; filename: string; issues: EdiIssue[];
  staff: { name: string; cin: string | null; days: number; brut: number; exonere: number; brutImposable: number; fraisPro: number;
    cotisations: number; netImposable: number; ir: number; dependents: number; situation: string; rate: string }[];
  totals: { brut: number; brutImposable: number; netImposable: number; ir: number; deductions: number; versements: number };
};
export type LiasseIsEdi = {
  year: number; model: LiasseModel; filename: string; status: 'final' | 'provisional'; issues: EdiIssue[];
  tables: { id: number; label: string; cells: number }[];
  totals: { actif: number; passif: number; result: number; taxable_result: number };
};
async function downloadBlob(url: string, params: Record<string, unknown>, fallback: string) {
  let r;
  try {
    r = await api.get(url, { params, responseType: 'blob' });
  } catch (err) {
    const data = (err as { response?: { data?: Blob } }).response?.data;
    if (data instanceof Blob) {
      let message = 'Fichier impossible';
      try { message = JSON.parse(await data.text())?.error?.message || message; } catch { /* corps non JSON */ }
      throw new Error(message);
    }
    throw err;
  }
  const name = /filename="([^"]+)"/.exec(String(r.headers['content-disposition'] ?? ''))?.[1] ?? fallback;
  const href = URL.createObjectURL(r.data as Blob);
  const a = document.createElement('a');
  a.href = href; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(href); }, 1000);
}
export const ediApi = {
  vatDeductions: (year: number, period: number, regime: 1 | 2): Promise<VatDeductionEdi> =>
    api.get(`/ledger/edi/tva-deductions/${year}`, { params: { period, regime } }).then(r => r.data.data),
  downloadVatDeductions: (year: number, period: number, regime: 1 | 2, format: 'zip' | 'xml') =>
    downloadBlob(`/ledger/edi/tva-deductions/${year}`, { period, regime, format }, `releve_deductions.${format}`),
  ir9421: (year: number): Promise<Ir9421Edi> => api.get(`/ledger/edi/9421/${year}`).then(r => r.data.data),
  download9421: (year: number, format: 'zip' | 'xml') => downloadBlob(`/ledger/edi/9421/${year}`, { format }, `etat_9421.${format}`),
  liasse: (year: number, model: LiasseModel): Promise<LiasseIsEdi> => api.get(`/ledger/edi/liasse/${year}`, { params: { model } }).then(r => r.data.data),
  downloadLiasse: (year: number, model: LiasseModel, format: 'zip' | 'xml') =>
    downloadBlob(`/ledger/edi/liasse/${year}`, { model, format }, `liasse_is.${format}`),
};
