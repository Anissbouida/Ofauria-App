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
