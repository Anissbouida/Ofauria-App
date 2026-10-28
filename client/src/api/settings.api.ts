import api from './client';

export interface CompanySettings {
  companyName: string;
  subtitle: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string | null;
  // Print settings
  receiptHeader: string;
  receiptFooter: string;
  receiptShowLogo: boolean;
  receiptLogoSize: number;
  receiptFontSize: number;
  receiptPaperWidth: number;
  receiptShowCashier: boolean;
  receiptShowDate: boolean;
  receiptShowPaymentDetail: boolean;
  receiptExtraLines: string;
  receiptAutoPrint: boolean;
  receiptOpenDrawer: boolean;
  receiptNumCopies: number;
  staffDiscountPercent: number;
  // Theme / Appearance
  themeBgPage: string;
  themeBgCard: string;
  themeBgSecondary: string;
  themeBgSeparator: string;
  themeTextStrong: string;
  themeTextBody: string;
  themeTextMuted: string;
  themeAccent: string;
  themeAccentHover: string;
  themeAccentLight: string;
  themeCtaColor: string;
  themeCtaText: string;
  productionChargeLoyer: number;
  productionChargeEnergie: number;
  productionChargeAutres: number;
  // Arrondi prix (mig 170)
  prixArrondiStrategie?: 'aucun' | 'au_dh' | 'au_demi_dh' | 'au_5dh';
  prixArrondiSens?: 'inferieur' | 'superieur' | 'naturel';
  // Identite legale (mig 326) : factures, bons de commande, paie, attestations.
  legalName?: string; legalAddress?: string; legalCity?: string;
  legalPhone?: string; legalEmail?: string; legalRc?: string;
  legalIf?: string; legalIce?: string; legalPatente?: string;
  // Fiche societe (mig 331) ; CNSS employeur lu dans les parametres de paie (lecture seule ici).
  legalForm?: string; legalCapital?: number | null; legalWebsite?: string;
  employerCnssNumber?: string | null;
}

/** Compte bancaire de la société (mig 331). */
export interface CompanyBankAccount {
  id: string; label: string; bank_name: string; rib: string; swift: string | null; ledger_account: string | null;
  store_id: string | null; store_name: string | null; is_default: boolean; show_on_invoices: boolean; is_active: boolean;
}
/** Taux de TVA daté (tax_codes, mig 309/331). */
export interface TaxCode {
  id: string; code: string; label: string; rate: string; kind: string; recoverable: boolean;
  valid_from: string; valid_to: string | null; legal_ref: string | null; status: 'current' | 'past' | 'future';
}

/** Ligne du journal des modifications (config_audit_log mig 328 + ref_audit_log). */
export interface AuditLogEntry {
  id: string;
  table_name: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  record_id: string | null;
  record_label: string | null;
  subject_id: string | null;
  subject_name: string | null;
  changed_by: string | null;
  changed_by_name: string | null;
  changed_at: string;
  diff: Record<string, { old: unknown; new: unknown }> | null;
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
}

export interface AuthEventEntry {
  id: string;
  event_type: string;
  user_id: string | null;
  user_name: string | null;
  target_user_id: string | null;
  target_name: string | null;
  email: string | null;
  ip: string | null;
  user_agent: string | null;
  success: boolean;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface Paged<T> { rows: T[]; total: number }

/** Serie de numeros des pieces (document_sequences, mig 329). */
export interface DocumentSequence {
  doc_type: string;
  label: string;
  module: string;
  pattern: string;
  padding: number;
  reset_period: 'never' | 'year' | 'month' | 'day';
  gapless: boolean;
  next_number: string;
  updated_at: string;
  updated_by_name: string | null;
  last_used_at: string | null;
}
export type DocumentSequenceInput = { pattern: string; padding: number; resetPeriod: DocumentSequence['reset_period'] };

/** Paramètre métier du catalogue (Paramètres › Paramètres métier, lot 4). */
export interface ParamField {
  name: string; label: string; type: 'boolean' | 'number' | 'integer' | 'percent' | 'enum' | 'list';
  unit?: string; min?: number; max?: number; options?: { value: string; label: string }[];
}
export interface BusinessParameter {
  key: string; domain: string; domainLabel: string; label: string; help: string;
  fields: ParamField[]; defaults: Record<string, unknown>;
  value: Record<string, unknown> | null; available: boolean; editable: boolean;
  history: { changed_at: string; by_name: string | null; diff: Record<string, { old: unknown; new: unknown }> | null }[];
}

/** Modèle d'une pièce envoyée aux tiers (mig 332). */
export interface DocumentTemplate {
  doc_type: 'invoice' | 'purchase_order'; label: string; payment_terms: string | null; late_penalty: string | null;
  footer_note: string | null; show_bank: boolean; show_legal_form: boolean; updated_at: string; updated_by_name: string | null;
}
/** Règle de notification par type d'événement (mig 332). */
export interface NotificationRule {
  type: string; label: string; domain: string; enabled: boolean; extra_roles: string[]; email_enabled?: boolean;
  sent_30d: number; recipients_30d: string[] | null; updated_at: string; updated_by_name: string | null;
}

/** Écran Données (lot 7). */
export interface DataStatus {
  counts: Record<string, number | null>; size: string;
  lastMigration: { name: string; executed_at: string } | null;
  exports: { event_type: 'config_export' | 'data_export' | 'data_import'; created_at: string; details: Record<string, unknown> | null; by_name: string | null }[];
  entities: { key: string; label: string; modes?: ImportMode[]; note?: string | null }[];
}
export type ImportMode = 'upsert' | 'create' | 'update';
export interface ImportPreview {
  columns: string[]; unknownHeaders: string[];
  summary: { create: number; update: number; error: number; skip: number };
  rows: { line: number; action: 'create' | 'update' | 'error' | 'skip'; values: Record<string, unknown>; errors: { column: string; message: string }[]; reason?: string }[];
  /** Import générique (mig 370) : colonnes du fichier, association retenue, champs cibles, mode. */
  headers: string[]; mapping: Record<string, string>;
  fields: { key: string; header: string; required: boolean; custom: boolean; match: boolean }[];
  mode: ImportMode; modes: ImportMode[];
}
export interface DataImport {
  id: string; entity: string; entity_label: string; file_name: string | null; mode: ImportMode; status: 'done' | 'undone';
  created_count: number; updated_count: number; skipped_count: number; created_at: string; by_name: string | null;
  undone_at: string | null; undone_by_name: string | null; can_undo: boolean;
  undo_report: { restored: number; deleted: number; deactivated: number; kept: number } | null;
}

/** Accueil de la configuration (refonte lot B) : un point de contrôle par réglage clé. */
export interface SetupCheck {
  key: string; page: string; section: string | null; label: string; detail: string;
  status: 'ok' | 'todo' | 'warn' | 'info'; required: boolean; anchor?: string;
}
export interface SetupOverview {
  checks: SetupCheck[];
  recent: { id: string; table_name: string; operation: string; record_label: string | null; changed_at: string; changed_by_name: string | null }[] | null;
}

export const settingsApi = {
  setup: () => api.get('/settings/setup').then(r => r.data.data) as Promise<SetupOverview>,
  get: () => api.get('/settings').then(r => r.data.data) as Promise<CompanySettings>,
  update: (data: Partial<CompanySettings>) => api.put('/settings', data).then(r => r.data.data) as Promise<CompanySettings>,
  auditLog: (params: { table?: string; changedBy?: string; subjectId?: string; from?: string; to?: string; q?: string; limit?: number; offset?: number }) =>
    api.get('/settings/audit-log', { params }).then(r => r.data.data) as Promise<Paged<AuditLogEntry>>,
  auditTables: () => api.get('/settings/audit-log/tables').then(r => r.data.data) as Promise<string[]>,
  authEvents: (params: { eventType?: string; userId?: string; success?: boolean; from?: string; to?: string; limit?: number; offset?: number }) =>
    api.get('/settings/auth-events', { params }).then(r => r.data.data) as Promise<Paged<AuthEventEntry>>,
  documentSequences: () => api.get('/settings/document-sequences').then(r => r.data.data) as Promise<DocumentSequence[]>,
  previewDocumentSequence: (data: DocumentSequenceInput) =>
    api.post('/settings/document-sequences/preview', data).then(r => r.data.data) as Promise<{ valid: boolean; sample?: string; error?: string }>,
  updateDocumentSequence: (docType: string, data: DocumentSequenceInput) =>
    api.put(`/settings/document-sequences/${docType}`, data).then(r => r.data.data) as Promise<{ doc_type: string; next_number: string }>,
  parameters: () => api.get('/settings/parameters').then(r => r.data.data) as Promise<BusinessParameter[]>,
  updateParameter: (key: string, value: Record<string, unknown>) =>
    api.put(`/settings/parameters/${key}`, { value }).then(r => r.data.data),
  bankAccounts: () => api.get('/settings/bank-accounts').then(r => r.data.data) as Promise<CompanyBankAccount[]>,
  saveBankAccount: (id: string | null, data: Record<string, unknown>) =>
    (id ? api.put(`/settings/bank-accounts/${id}`, data) : api.post('/settings/bank-accounts', data)).then(r => r.data.data) as Promise<CompanyBankAccount>,
  taxCodes: () => api.get('/settings/tax-codes').then(r => r.data.data) as Promise<TaxCode[]>,
  addTaxRate: (data: Record<string, unknown>) => api.post('/settings/tax-codes', data).then(r => r.data.data) as Promise<TaxCode>,
  updateTaxCode: (id: string, data: Record<string, unknown>) => api.put(`/settings/tax-codes/${id}`, data).then(r => r.data.data) as Promise<TaxCode>,
  documentTemplates: () => api.get('/settings/documents').then(r => r.data.data) as Promise<DocumentTemplate[]>,
  updateDocumentTemplate: (docType: string, data: Record<string, unknown>) =>
    api.put(`/settings/documents/${docType}`, data).then(r => r.data.data) as Promise<DocumentTemplate>,
  /** Aperçu PDF (blob) avec des données d'exemple. */
  documentPreview: (docType: string) =>
    api.get(`/settings/documents/${docType}/preview`, { responseType: 'blob' }).then(r => r.data as Blob),
  notificationRules: () => api.get('/settings/notification-rules').then(r => r.data.data) as Promise<NotificationRule[]>,
  updateNotificationRule: (type: string, data: { enabled?: boolean; emailEnabled?: boolean; extraRoles?: string[] }) =>
    api.put(`/settings/notification-rules/${type}`, data).then(r => r.data.data) as Promise<NotificationRule>,
  dataStatus: () => api.get('/settings/data/status').then(r => r.data.data) as Promise<DataStatus>,
  /** Téléchargement (modèle, exports) : renvoie le fichier et son nom. */
  download: (path: string) => api.get(`/settings/data/${path}`, { responseType: 'blob' }).then(r => {
    const cd = String(r.headers['content-disposition'] ?? '');
    return { blob: r.data as Blob, filename: /filename="([^"]+)"/.exec(cd)?.[1] ?? 'export' };
  }),
  importPreview: (entity: string, file: File, opts: { mapping?: Record<string, string> | null; mode?: ImportMode } = {}) => {
    const fd = new FormData(); fd.append('file', file);
    if (opts.mapping) fd.append('mapping', JSON.stringify(opts.mapping));
    if (opts.mode) fd.append('mode', opts.mode);
    return api.post(`/settings/data/import/${entity}/preview`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data.data) as Promise<ImportPreview>;
  },
  importCommit: (entity: string, file: File, opts: { mapping?: Record<string, string> | null; mode?: ImportMode } = {}) => {
    const fd = new FormData(); fd.append('file', file);
    if (opts.mapping) fd.append('mapping', JSON.stringify(opts.mapping));
    if (opts.mode) fd.append('mode', opts.mode);
    return api.post(`/settings/data/import/${entity}/commit`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data.data) as Promise<{ created: number; updated: number }>;
  },
  imports: () => api.get('/settings/data/imports').then(r => r.data.data as DataImport[]),
  undoImport: (id: string) => api.post(`/settings/data/imports/${id}/undo`).then(r => r.data.data as { restored: number; deleted: number; deactivated: number; kept: number }),
  uploadLogo: (file: File) => {
    const formData = new FormData();
    formData.append('logo', file);
    return api.post('/upload/logo', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data.data as { url: string });
  },
};
