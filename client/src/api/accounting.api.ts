import api from './client';

export const caisseApi = {
  register: (year: number, month: number) =>
    api.get('/caisse/register', { params: { year, month } }).then(r => r.data.data),
  /** Admin : fixe le report du mois affiché (cash + carte). */
  saveReportOverride: (data: { year: number; month: number; cashNet: number; cardCumul: number; note?: string }) =>
    api.put('/caisse/report-override', data).then(r => r.data.data),
  /** Admin : supprime l'ajustement, le report redevient calculé. */
  deleteReportOverride: (year: number, month: number) =>
    api.delete('/caisse/report-override', { params: { year, month } }).then(r => r.data.data),
};

export type SupplierIdentifierInput = { typeCode: string; value: string; qualifier?: string | null };
export type IdentifierType = {
  code: string; country_code: string; label: string; description: string | null;
  pattern: string | null; is_unique: boolean; required_for_vat_deduction: boolean; display_order: number;
};

export const suppliersApi = {
  /** Tout le référentiel (actifs et inactifs) ; les écrans filtrent. */
  list: () => api.get('/suppliers').then(r => r.data.data),
  /** Fournisseurs actifs seulement (sélecteurs). */
  listActive: () => api.get('/suppliers', { params: { active: 'true' } }).then(r => r.data.data),
  getById: (id: string) => api.get(`/suppliers/${id}`).then(r => r.data.data),
  /** Écran Fournisseurs : page de la liste par situation (view=open = actifs, history = inactifs). */
  board: (params: Record<string, string>) =>
    api.get('/suppliers/board', { params }).then(r => r.data.data as { rows: Record<string, any>[]; total: number; page: number; pageSize: number }),
  /** Compteurs par situation + villes connues. */
  boardSummary: () =>
    api.get('/suppliers/board-summary').then(r => r.data.data as {
      stages: { stage: string; count: number; amount_due: string; open_po_amount: string; purchased_12m: string; late_count: number }[];
      cities: { city: string; count: number }[];
    }),
  /** Types d'identifiants légaux fournis par le pack pays (ICE, IF, RC…). */
  identifierTypes: (country?: string) =>
    api.get('/suppliers/identifier-types', { params: country ? { country } : {} }).then(r => r.data.data),
  /** Pré-contrôle de doublon (nom insensible à la casse, identifiant unique). */
  check: (params: { name?: string; typeCode?: string; value?: string; excludeId?: string }) =>
    api.get('/suppliers/check', { params }).then(r => r.data.data as Array<{ id: string; name: string; reason: string }>),
  history: (id: string) => api.get(`/suppliers/${id}/history`).then(r => r.data.data),
  create: (data: Record<string, any>) => api.post('/suppliers', data).then(r => r.data.data),
  update: (id: string, data: Record<string, any>) => api.put(`/suppliers/${id}`, data).then(r => r.data.data),
  remove: (id: string) => api.delete(`/suppliers/${id}`),
};

export const expenseCategoriesApi = {
  list: (all = false) => api.get('/expense-categories', { params: all ? { all: 'true' } : {} }).then(r => r.data.data),
  children: (parentId: string) => api.get(`/expense-categories/${parentId}/children`).then(r => r.data.data),
  create: (data: Record<string, any>) => api.post('/expense-categories', data).then(r => r.data.data),
  update: (id: string, data: Record<string, any>) => api.put(`/expense-categories/${id}`, data).then(r => r.data.data),
  remove: (id: string) => api.delete(`/expense-categories/${id}`),
};

export const revenueCategoriesApi = {
  list: (all = false) => api.get('/revenue-categories', { params: all ? { all: 'true' } : {} }).then(r => r.data.data),
  children: (parentId: string) => api.get(`/revenue-categories/${parentId}/children`).then(r => r.data.data),
  create: (data: Record<string, any>) => api.post('/revenue-categories', data).then(r => r.data.data),
  update: (id: string, data: Record<string, any>) => api.put(`/revenue-categories/${id}`, data).then(r => r.data.data),
  remove: (id: string) => api.delete(`/revenue-categories/${id}`),
};

export const invoicesApi = {
  list: (params?: Record<string, string>) => api.get('/invoices', { params }).then(r => r.data.data),
  /** Écran Factures reçues : page de la liste par étape (view=open) ou par période (view=history). */
  receivedBoard: (params: Record<string, string>) =>
    api.get('/invoices/received-board', { params }).then(r => r.data.data as {
      rows: Record<string, any>[]; total: number; sumTotal: number; sumRemaining: number; page: number; pageSize: number;
    }),
  /** Compteurs par étape, factures échues et catégories utilisées (factures reçues). */
  receivedPipeline: () =>
    api.get('/invoices/received-pipeline').then(r => r.data.data as {
      stages: { stage: string; count: number; amount: string; remaining: string; late_count: number }[];
      late: { id: string; invoice_number: string; supplier_name: string; due_date: string; remaining: string; days_late: number }[];
      categories: { id: string; name: string; count: number }[];
    }),
  lineExpenses: (params?: Record<string, string>) => api.get('/invoices/line-expenses', { params }).then(r => r.data.data),
  updateCategory: (id: string, categoryId: string | null) => api.put(`/invoices/${id}/category`, { categoryId }).then(r => r.data.data),
  updateLineCategory: (lineId: string, source: string, categoryId: string | null) =>
    api.put(`/invoices/line/${lineId}/category`, { categoryId, source }).then(r => r.data.data),
  getById: (id: string) => api.get(`/invoices/${id}`).then(r => r.data.data),
  create: (data: Record<string, any>) => api.post('/invoices', data).then(r => r.data.data),
  createFromOrder: (orderId: string) => api.post(`/invoices/from-order/${orderId}`).then(r => r.data.data),
  /** Fusionne les factures fournisseurs des BCs en une seule. */
  merge: (data: { purchaseOrderIds: string[]; supplierInvoiceNumber?: string; invoiceDate?: string }) =>
    api.post('/invoices/merge', data).then(r => r.data.data),
  /** Facture reçue : motif obligatoire (référentiel purchase_reason_codes, mig 309).
   *  Facture émise : 200 = annulée ; 202 = annulation soumise à approbation (r.approval, lot 8). */
  cancel: (id: string, reason?: { reasonCodeId: string; note?: string }) => api.post(`/invoices/${id}/cancel`, reason ?? {})
    .then(r => r.data as { success: boolean; data: Record<string, unknown>; approval?: { rule_label: string } }),
  /** Contrôle : blocages, mentions légales, rapprochement par ligne (mig 309). */
  control: (id: string, revalidate = false) => api.get(`/invoices/${id}/control`, { params: revalidate ? { revalidate: 'true' } : {} }).then(r => r.data.data),
  releaseHold: (holdId: string, reason: { reasonCodeId: string; note?: string }) => api.post(`/invoices/holds/${holdId}/release`, reason).then(r => r.data.data),
  addHold: (id: string, note: string) => api.post(`/invoices/${id}/holds`, { note }).then(r => r.data.data),
  taxCodes: (at?: string) => api.get('/invoices/tax-codes', { params: at ? { at } : {} }).then(r => r.data.data),
  /** Modification complete (admin + gerant) — sert aussi pour ajuster une facture. */
  update: (id: string, data: Record<string, any>) => api.put(`/invoices/${id}`, data).then(r => r.data.data),
  /** Remplace les lignes (admin + gerant). Recalcule amount + TVA + total_amount automatiquement.
   *  tvaRate : taux TVA de la ligne en % (null = pas de TVA explicite, fallback en-tete). */
  replaceItems: (id: string, items: Array<{
    productId?: string | null;
    ingredientId?: string | null;
    description?: string | null;
    quantity: number;
    unitPrice: number;
    subtotal?: number;
    tvaRate?: number | null;
  }>) => api.put(`/invoices/${id}/items`, { items }).then(r => r.data.data),
  /** Suppression physique (admin + gerant). force=true cascade les paiements lies. */
  remove: (id: string, opts: { force?: boolean } = {}) =>
    api.delete(`/invoices/${id}`, { params: opts.force ? { force: 'true' } : undefined }).then(r => r.data.data),
  paymentAlerts: (days = 7) => api.get('/invoices/payment-alerts', { params: { days } }).then(r => r.data.data),
  /** Dettes & creances ouvertes : { receivables, payables, standaloneDebts }. */
  debts: () => api.get('/invoices/debts').then(r => r.data.data),
  /** Echelonne une facture en N echeances (materiel achete a credit). */
  createSchedule: (id: string, data: {
    installments: number; firstDueDate: string; intervalMonths?: number;
    amount?: number; expectedPaymentMode?: string | null; notes?: string | null;
  }) => api.post(`/invoices/${id}/schedule`, data).then(r => r.data.data),
  updatePaymentTerms: (id: string, data: { dueDate?: string | null; expectedPaymentMode?: string | null; receptionDate?: string | null }) =>
    api.put(`/invoices/${id}/payment-terms`, data).then(r => r.data.data),
  updateStatus: (id: string, status: string) =>
    api.put(`/invoices/${id}/status`, { status }).then(r => r.data.data),
  downloadDocx: (id: string) => api.get(`/invoices/${id}/download-pdf`, { responseType: 'blob' }).then(r => r),
  uploadAttachment: (id: string, file: File) => {
    const fd = new FormData();
    fd.append('attachment', file);
    return api.post(`/invoices/${id}/attachment`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data.data);
  },
  removeAttachment: (id: string) => api.delete(`/invoices/${id}/attachment`).then(r => r.data.data),
};

export const caisseImportApi = {
  preview: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/caisse-import/preview', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data.data);
  },
  commit: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/caisse-import/commit', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data.data);
  },
};

export const paymentsApi = {
  list: (params?: Record<string, string>) => api.get('/payments', { params }).then(r => r.data.data),
  create: (data: Record<string, any>) => api.post('/payments', data).then(r => r.data.data),
  update: (id: string, data: Record<string, any>) => api.put(`/payments/${id}`, data).then(r => r.data.data),
  remove: (id: string) => api.delete(`/payments/${id}`),
  summary: (dateFrom: string, dateTo: string) =>
    api.get('/payments/summary', { params: { dateFrom, dateTo } }).then(r => r.data.data),
  /** Liste des cheques pour gestion encaissement. status: 'pending' | 'cashed' | 'all'. */
  listChecks: (params?: { status?: string; dateFrom?: string; dateTo?: string; supplierId?: string; employeeId?: string }) =>
    api.get('/payments/checks', { params }).then(r => r.data.data),
  /** Confirme l'encaissement d'un cheque (date debit bancaire). */
  markCashed: (id: string, data: { cashedAt?: string; note?: string }) =>
    api.post(`/payments/${id}/mark-cashed`, data).then(r => r.data.data),
  /** Admin : annule la confirmation d'encaissement (correction d'erreur). */
  unmarkCashed: (id: string) =>
    api.post(`/payments/${id}/unmark-cashed`).then(r => r.data.data),
  // ─── Mig 310 (D7) : modes typés, plafond espèces, annulation, virements internes ───
  /** Modes de paiement typés et comptes de trésorerie actifs. */
  modes: () => api.get('/payments/modes').then(r => r.data.data as { modes: PaymentMode[]; treasuryAccounts: TreasuryAccount[] }),
  /** Jauge du plafond espèces chez un fournisseur (jour / mois), effet du montant saisi. */
  cashCumul: (params: { supplierId: string; date: string; amount?: number }) =>
    api.get('/payments/cash-cumul', { params }).then(r => r.data.data as CashCumul),
  cashLimitBreaches: () => api.get('/payments/cash-limit-breaches').then(r => r.data.data),
  /** Annulation motivée : contre-pièce négative + extourne comptable (jamais de suppression). */
  void: (id: string, data: { reasonCodeId: string; note?: string }) =>
    api.post(`/payments/${id}/void`, data).then(r => r.data.data),
  /** Ré-émission d'un paiement annulé (chèque perdu, rejet) : nouveau règlement lié. */
  reissue: (id: string, data: Record<string, unknown>) =>
    api.post(`/payments/${id}/reissue`, data).then(r => r.data.data),
  internalTransfer: (data: { fromAccountId: string; toAccountId: string; amount: number; paymentDate: string; reference?: string; description?: string }) =>
    api.post('/payments/internal-transfer', data).then(r => r.data.data),
  actions: (id: string) => api.get(`/payments/${id}/actions`).then(r => r.data.data),
};

export interface PaymentMode {
  code: string; label: string; legacy_method: string; is_cash: boolean; treasury_kind: 'cash' | 'bank';
  requires_reference: boolean; deductible_over_cash_limit: boolean;
}
export interface TreasuryAccount { id: string; code: string; label: string; kind: 'cash' | 'bank'; account_code: string; is_default: boolean }
export interface CashCumul {
  supplierName: string; applies: boolean; agriException: boolean; enforcement: 'warn' | 'block';
  dayTotal: number; monthTotal: number; dayCount: number; dayLimit: number | null; monthLimit: number | null;
  warnPct: number; amount: number; dayAfter: number; monthAfter: number; pctDay: number | null; pctMonth: number | null;
  warning: boolean; exceeded: boolean; blocked: boolean;
}

/**
 * Echeancier des sorties d'argent (migration 258) :
 *   - dettes echelonnees : materiel/equipement achete a credit
 *   - charges fixes      : loyer, electricite, eau... generees automatiquement
 *
 * Le REGLEMENT d'une echeance passe par paymentsApi.create({ scheduledPaymentId,
 * invoiceId? , amount, paymentMethod, ... }) : c'est un paiement ordinaire, donc
 * il alimente la caisse, le suivi des cheques et le grand livre comme les autres.
 */
export const paymentSchedulesApi = {
  /** Calendrier des echeances. status 'open' (defaut) = non soldees. */
  list: (params?: { from?: string; to?: string; status?: 'open' | 'all'; sourceKind?: string }) =>
    api.get('/payment-schedules', { params }).then(r => r.data.data),
  /** Echeances d'une facture / dette / charge fixe donnee. */
  bySource: (kind: 'invoice' | 'debt' | 'recurring', id: string) =>
    api.get(`/payment-schedules/by-source/${kind}/${id}`).then(r => r.data.data),
  /** Renseigne le montant d'une echeance variable, decale une date, annule. */
  update: (id: string, data: {
    amountDue?: number | null; dueDate?: string; notes?: string | null;
    expectedPaymentMode?: string | null; status?: 'pending' | 'cancelled';
  }) => api.patch(`/payment-schedules/${id}`, data).then(r => r.data.data),
};

/** Dettes echelonnees sans facture (materiel a credit saisi directement). */
export const debtsApi = {
  list: (includeSettled = false) =>
    api.get('/debts', { params: includeSettled ? { includeSettled: 'true' } : {} }).then(r => r.data.data),
  create: (data: {
    label: string; totalAmount: number; installments: number; firstDueDate: string;
    intervalMonths?: number; supplierId?: string | null; categoryId?: string | null;
    fixedAssetId?: string | null; startDate?: string; expectedPaymentMode?: string | null;
    notes?: string | null;
  }) => api.post('/debts', data).then(r => r.data.data),
  setStatus: (id: string, status: 'active' | 'cancelled') =>
    api.patch(`/debts/${id}`, { status }).then(r => r.data.data),
  remove: (id: string) => api.delete(`/debts/${id}`).then(r => r.data.data),
};

/** Modeles de charges fixes recurrentes (loyer, electricite, eau...). */
export const recurringChargesApi = {
  list: (includeInactive = false) =>
    api.get('/recurring-charges', { params: includeInactive ? { includeInactive: 'true' } : {} }).then(r => r.data.data),
  create: (data: Record<string, any>) => api.post('/recurring-charges', data).then(r => r.data.data),
  update: (id: string, data: Record<string, any>) =>
    api.patch(`/recurring-charges/${id}`, data).then(r => r.data.data),
  remove: (id: string) => api.delete(`/recurring-charges/${id}`).then(r => r.data.data),
};
