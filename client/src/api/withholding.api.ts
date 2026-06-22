import api from './client';

export interface WithholdingType {
  id: string;
  code: string;
  label: string;
  legal_ref: string | null;
  rate: string | null;
  threshold: string | null;
  rate_above: string | null;
  base: 'brut_ht' | 'brut_ttc';
  echeance_jours: number;
  is_active: boolean;
  notes: string | null;
  account_id: string;
  account_code: string;
  account_label: string;
}

export interface ToRemitLine {
  code: string;
  label: string;
  legal_ref: string | null;
  echeance_jours: number;
  account_code: string;
  total_retenu: string;
  total_reverse: string;
  a_reverser: string;
}

export interface ToRemitResult {
  lines: ToRemitLine[];
  total_a_reverser: number;
}

export const withholdingApi = {
  listTypes: (): Promise<WithholdingType[]> =>
    api.get('/withholding/types').then(r => r.data.data),
  updateType: (id: string, data: Record<string, unknown>): Promise<WithholdingType> =>
    api.patch(`/withholding/types/${id}`, data).then(r => r.data.data),
  toRemit: (startDate?: string, endDate?: string): Promise<ToRemitResult> =>
    api.get('/withholding/to-remit', { params: { startDate, endDate } }).then(r => r.data.data),
  reversement: (typeCode: string, amount: number, date: string, method: 'bank' | 'cash'): Promise<{ entry_number: string }> =>
    api.post('/withholding/reversement', { typeCode, amount, date, method }).then(r => r.data.data),
};
