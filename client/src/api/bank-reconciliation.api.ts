import api from './client';

export interface BankStatement {
  id: string;
  label: string;
  account_id: string;
  account_code: string;
  account_label: string;
  statement_date: string;
  opening_balance: string;
  closing_balance: string;
  line_count: number;
  reconciled_count: number;
  source_format?: string | null;       // mig 426 : csv, xlsx, ofx, mt940, cfonb (NULL = saisi avant)
  duplicates_skipped?: number;
}

export interface BankLine {
  id: string;
  operation_date: string;
  label: string | null;
  reference: string | null;
  amount: string;
  direction: 'in' | 'out';
  matched_entry_line_id: string | null;
  matched_entry_number: string | null;
  reconciled: boolean;
}

export interface LedgerLine {
  id: string;
  debit: string;
  credit: string;
  label: string | null;
  entry_number: string;
  entry_date: string;
  journal_code: string;
}

export interface ReconciliationView {
  statement: BankStatement;
  bankLines: BankLine[];
  unmatchedLedgerLines: LedgerLine[];
  summary: {
    total_lines: number;
    reconciled: number;
    unmatched_bank: number;
    unmatched_ledger: number;
  };
}

export interface ImportLine {
  operationDate: string;
  label?: string;
  reference?: string;
  amount: number;
  direction: 'in' | 'out';
}

export const bankReconciliationApi = {
  listStatements: (): Promise<BankStatement[]> =>
    api.get('/bank-reconciliation/statements').then(r => r.data.data),
  createStatement: (data: {
    label: string; accountCode: string; statementDate: string;
    openingBalance: number; closingBalance: number; lines: ImportLine[];
  }): Promise<BankStatement> =>
    api.post('/bank-reconciliation/statements', data).then(r => r.data.data),
  getReconciliation: (id: string): Promise<ReconciliationView> =>
    api.get(`/bank-reconciliation/statements/${id}`).then(r => r.data.data),
  autoMatch: (id: string): Promise<{ matched: number }> =>
    api.post(`/bank-reconciliation/statements/${id}/auto-match`).then(r => r.data.data),
  matchLine: (bankLineId: string, entryLineId: string): Promise<BankLine> =>
    api.post(`/bank-reconciliation/lines/${bankLineId}/match`, { entryLineId }).then(r => r.data.data),
  unmatchLine: (bankLineId: string): Promise<BankLine> =>
    api.post(`/bank-reconciliation/lines/${bankLineId}/unmatch`).then(r => r.data.data),
  deleteStatement: (id: string): Promise<void> =>
    api.delete(`/bank-reconciliation/statements/${id}`).then(() => undefined),
};

/* ═══ Import de fichiers de banque (mig 426) ═══ */
export type BankFormat = 'csv' | 'xlsx' | 'ofx' | 'mt940' | 'cfonb';
export type BankDateFormat = 'DD/MM/YYYY' | 'DD-MM-YYYY' | 'DD.MM.YYYY' | 'DD/MM/YY' | 'YYYY-MM-DD' | 'MM/DD/YYYY';
export interface BankCsvProfile {
  delimiter?: string | null; decimalSep: ',' | '.'; dateFormat: BankDateFormat; skipRows: number; hasHeader: boolean;
  colDate: number; colValueDate?: number | null; colLabel: number; colLabel2?: number | null; colReference?: number | null;
  colDebit?: number | null; colCredit?: number | null; colAmount?: number | null; negativeIsOut?: boolean;
}
export interface BankImportProfile {
  id: string; name: string; delimiter: string | null; decimal_sep: ',' | '.'; date_format: BankDateFormat;
  skip_rows: number; has_header: boolean; col_date: number; col_value_date: number | null; col_label: number;
  col_label2: number | null; col_reference: number | null; col_debit: number | null; col_credit: number | null;
  col_amount: number | null; negative_is_out: boolean; treasury_account_id: string | null; treasury_label: string | null;
}
export interface BankImportFile {
  fileName: string; contentBase64: string; format?: BankFormat | 'auto'; encoding?: 'auto' | 'utf-8' | 'windows-1252';
  profileId?: string | null; profile?: BankCsvProfile | null; treasuryAccountId?: string | null;
}
export interface BankImportPreview {
  format: BankFormat; accountNumber: string | null; currency: string | null; warnings: string[]; rawRows: string[][] | null;
  statementDate: string | null; openingBalance: number | null; closingBalance: number | null;
  treasuryAccount: { id: string; code: string; label: string; account_code: string };
  profileId: string | null;
  stats: { count: number; duplicates: number; in: number; out: number; net: number };
  lines: { operationDate: string; valueDate: string | null; label: string; reference: string | null; amount: number; direction: 'in' | 'out'; duplicate: boolean }[];
}
export const bankImportApi = {
  preview: (f: BankImportFile): Promise<BankImportPreview> => api.post('/bank-reconciliation/import/preview', f).then(r => r.data.data),
  import: (f: BankImportFile & { label?: string | null; statementDate?: string | null; openingBalance?: number | null; closingBalance?: number | null }):
    Promise<{ statement: BankStatement; imported: number; skipped: number }> =>
    api.post('/bank-reconciliation/import', f).then(r => r.data.data),
  profiles: (): Promise<BankImportProfile[]> => api.get('/bank-reconciliation/import/profiles').then(r => r.data.data),
  saveProfile: (p: BankCsvProfile & { name: string; treasuryAccountId?: string | null }): Promise<BankImportProfile> =>
    api.post('/bank-reconciliation/import/profiles', p).then(r => r.data.data),
};
