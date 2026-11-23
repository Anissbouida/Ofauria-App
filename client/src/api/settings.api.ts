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
  legalForm?: string; legalCapital?: number | null; legalWebsite?: string; legalCommuneCode?: string;
  employerCnssNumber?: string | null;
}

/** Compte bancaire de la société (mig 331). */
export interface CompanyBankAccount {
  id: string; label: string; bank_name: string; rib: string; swift: string | null; ledger_account: string | null;
  store_id: string | null; store_name: string | null; is_default: boolean; show_on_invoices: boolean; is_active: boolean;
}
/** Entité juridique (G6-03, mig 608) : la société qui émet les pièces d'un établissement. */
export interface LegalEntity {
  id: string; code: string; legal_name: string; trade_name: string | null; legal_form: string | null; capital: string | null;
  ice: string | null; if_number: string | null; rc: string | null; patente: string | null; cnss: string | null;
  address: string | null; city: string | null; commune_code: string | null; phone: string | null; email: string | null;
  website: string | null; currency_code: string; country_code: string; logo_url: string | null;
  is_default: boolean; is_active: boolean; store_count: number;
}
export interface LegalEntityStore { id: string; name: string; code: string | null; is_active: boolean; legal_entity_id: string }
/** Taux de TVA daté (tax_codes, mig 309/331). */
export interface TaxCode {
  id: string; code: string; label: string; rate: string; kind: string; recoverable: boolean;
  valid_from: string; valid_to: string | null; legal_ref: string | null; status: 'current' | 'past' | 'future';
}

/** Pack pays (G6-06, mig 606) : paramètres légaux de la paie et de la fiscalité, en lecture seule. */
export interface CountryPackParameter {
  key: string; category: 'paie' | 'fiscalite' | 'formats'; label: string;
  value: unknown; effectiveFrom: string | null; legalRef: string | null;
  upcoming: { value: unknown; effectiveFrom: string }[];
}
export interface CountryPackOverview {
  country: string;
  pack: { code: string; name: string; defaultCurrency: string; declarativeFormats: string[]; notes: string | null } | null;
  fallback: boolean;
  date: string;
  parameters: CountryPackParameter[];
  payrollScale: Record<string, unknown> | null;
  taxCodes: TaxCode[];
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
  name: string; label: string; type: 'boolean' | 'number' | 'integer' | 'percent' | 'enum' | 'list' | 'date' | 'time';
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

export interface SectorInfo {
  // modules / features = listes EFFECTIVES (secteur + ajustements, mig 507).
  current: { code: string; label: string; modules: string[]; features?: string[]; home_route?: string | null; report_keys?: string[] };
  // Libellés par secteur (phase 9.1) : clé neutre → mot affiché.
  labels?: Record<string, string>;
  /** Nombre d'ajustements (modules + options) par rapport au préréglage. */
  adjusted?: number;
  /** Profils proposés. Mig 633 : famille, état, parent et chaîne d'héritage. */
  available: {
    code: string; label: string; isCustom?: boolean; family?: string | null; status?: string; description?: string | null;
    baseSector?: string | null; inherits?: boolean; lineage?: { code: string; label: string }[];
    modulesCount?: number; featuresCount?: number;
  }[];
  /** Spécialisations proposées par le profil courant (ou déjà actives). */
  specializations?: { code: string; label: string; description: string | null; enabled: boolean; offered: boolean }[];
}

/** Aperçu d'impact d'un brouillon de modules / options (mig 508, lot P0b). */
export interface ModuleImpact {
  modulesOn: string[];
  modulesOff: string[];
  featuresOn: string[];
  featuresOff: string[];
  roles: { code: string; label: string; gained: string[]; lost: string[] }[];
  hidden: { scope: string; label: string; count: number }[];
}

/** Version de la configuration des modules (mig 508). */
/** Bilan de santé de la configuration (P8) : propositions calculées sur les données. */
export interface HealthRecommendation {
  key: string;
  tone: 'suggestion' | 'warning';
  /** Contrôles de cohérence (C-04) : « blocking » = un ordre ou un lot restera bloqué. */
  severity?: 'blocking' | 'warning';
  module: string;
  title: string;
  detail: string;
  action:
    | { kind: 'adjust'; label: string; changes: { modules?: Record<string, boolean>; features?: Record<string, boolean> } }
    | { kind: 'link'; label: string; to: string };
  /** Nombre total d'éléments en cause ; `items` en porte au plus 200, avec lien vers la fiche. */
  count?: number;
  items?: { id: string; label: string; to: string }[];
}
export interface HealthReport { recommendations: HealthRecommendation[]; dismissed: number }

/** Mise en route guidée (P9) : tâches par module, cochées d'après les données. */
export interface ModuleOnboarding {
  module: string;
  label: string;
  done: number;
  total: number;
  tasks: { key: string; label: string; done: boolean; to: string }[];
}
export interface OnboardingReport { modules: ModuleOnboarding[]; hidden: number }

/** Modèle de configuration (P10) : aperçu avant d'en faire un secteur. */
export interface ConfigModelPreview {
  name: string;
  warnings: string[];
  modules: number;
  addedModules: string[];
  removedModules: string[];
  features: number;
  labels: number;
  starter: { units: number; stepTypes: number; equipmentTypes: number };
}

/** Proposition de l'assistant de configuration (P11) : modèle filtré + écarts pour le brouillon. */
export interface ConfigSuggestion {
  model: { name: string; labels: Record<string, string>; starter: { stepTypes: { label: string }[]; equipmentTypes: { label: string }[] } } & Record<string, unknown>;
  preview: ConfigModelPreview;
  changes: { modules: Record<string, boolean>; features: Record<string, boolean> };
  rationale: string;
  questions: string[];
}

export interface ConfigVersion {
  id: number;
  created_at: string;
  created_by_name: string | null;
  label: string;
}

/** Écran « Secteur et modules » (mig 507) : préréglage, écarts et listes effectives. */
export interface ModuleActivation {
  sector: { code: string; label: string };
  packModules: string[];
  packFeatures: string[];
  moduleOverrides: Record<string, boolean>;
  featureOverrides: Record<string, boolean>;
  /** Catalogue de capacités (mig 507, étendu mig 632 : nature, dépendances, socle actif par défaut). */
  catalog: {
    key: string; module_key: string; label: string; description: string | null; sort_order: number;
    kind?: 'fonction' | 'reglementaire'; requires?: string[]; default_on?: boolean;
  }[];
  modules: string[];
  features: string[];
  /** Diffusion (mig 509) : modules en pilote et modules fermés par établissement. */
  rollout: { pilots: Record<string, { roles: string[]; users: string[] }>; storeDisabled: Record<string, string[]> };
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
  /** G3-11 — registre des traitements de données personnelles (loi 09-08). */
  processingRegister: () => api.get('/settings/data/processing-register').then(r => r.data.data) as Promise<ProcessingActivity[]>,
  /** G2-02 — qualité des données maîtres : compteurs, puis liste à corriger d'un compteur. */
  dataQuality: () => api.get('/settings/data/quality').then(r => r.data.data) as Promise<DataQualityIndicator[]>,
  dataQualityItems: (key: string) => api.get(`/settings/data/quality/${key}`).then(r => r.data.data) as Promise<DataQualityItem[]>,
  parameters: () => api.get('/settings/parameters').then(r => r.data.data) as Promise<BusinessParameter[]>,
  updateParameter: (key: string, value: Record<string, unknown>) =>
    api.put(`/settings/parameters/${key}`, { value }).then(r => r.data.data),
  legalEntities: () => api.get('/settings/legal-entities').then(r => r.data.data) as Promise<{ entities: LegalEntity[]; stores: LegalEntityStore[] }>,
  saveLegalEntity: (id: string | null, data: Record<string, unknown>) =>
    (id ? api.put(`/settings/legal-entities/${id}`, data) : api.post('/settings/legal-entities', data)).then(r => r.data.data) as Promise<LegalEntity>,
  assignStoreEntity: (storeId: string, legalEntityId: string) =>
    api.put(`/settings/legal-entities/stores/${storeId}`, { legalEntityId }).then(r => r.data.data),
  bankAccounts: () => api.get('/settings/bank-accounts').then(r => r.data.data) as Promise<CompanyBankAccount[]>,
  saveBankAccount: (id: string | null, data: Record<string, unknown>) =>
    (id ? api.put(`/settings/bank-accounts/${id}`, data) : api.post('/settings/bank-accounts', data)).then(r => r.data.data) as Promise<CompanyBankAccount>,
  sector: () => api.get('/settings/sector').then(r => r.data.data) as Promise<SectorInfo>,
  /** Spécialisations (mig 633) : activer n'ajoute que ce qui manque, désactiver ne supprime rien. */
  setSpecialization: (code: string, enabled: boolean) =>
    api.put(`/settings/specializations/${code}`, { enabled }).then(r => r.data.data) as Promise<{ result: { workshops?: number; stepTypes?: number; features?: string[] } }>,
  setSector: (code: string, keepAdjustments = true) =>
    api.put('/settings/sector', { code, keepAdjustments }).then(r => r.data.data) as Promise<{ code: string; label: string; modules: string[] }>,
  sectorStarter: (sector?: string) => api.get('/settings/sector/starter', { params: sector ? { sector } : {} }).then(r => r.data.data) as Promise<{ sector: string; preview: { categories: string[]; items: string[] } }>,
  loadSectorStarter: () => api.post('/settings/sector/starter').then(r => r.data.data) as Promise<Record<string, number>>,
  modules: () => api.get('/settings/modules').then(r => r.data.data) as Promise<ModuleActivation>,
  saveModules: (changes: { modules?: Record<string, boolean | null>; features?: Record<string, boolean | null> }) =>
    api.put('/settings/modules', changes).then(r => r.data.data) as Promise<ModuleActivation>,
  resetModules: () => api.post('/settings/modules/reset').then(r => r.data.data) as Promise<ModuleActivation>,
  previewModules: (changes: { modules?: Record<string, boolean | null>; features?: Record<string, boolean | null> }) =>
    api.post('/settings/modules/preview', changes).then(r => r.data.data) as Promise<ModuleImpact>,
  saveModuleRollout: (key: string, change: { pilot: { roles: string[]; users: string[] } | null; disabledStores: string[] }) =>
    api.put(`/settings/modules/${key}/rollout`, change).then(r => r.data.data) as Promise<ModuleActivation>,
  exportConfig: () => api.get('/settings/modules/export').then(r => r.data.data) as Promise<Record<string, unknown> & { base_sector: string }>,
  previewConfigModel: (model: unknown) => api.post('/settings/modules/import/preview', { model }).then(r => r.data.data) as Promise<ConfigModelPreview>,
  assistantStatus: () => api.get('/settings/modules/assistant').then(r => r.data.data) as Promise<{ available: boolean }>,
  suggestConfig: (description: string) => api.post('/settings/modules/assistant', { description }).then(r => r.data.data) as Promise<ConfigSuggestion>,
  createSector: (data: { model?: unknown; name?: string }) =>
    api.post('/settings/sectors', data).then(r => r.data.data) as Promise<{ code: string; label: string; warnings: string[] }>,
  deleteSector: (code: string) => api.delete(`/settings/sectors/${encodeURIComponent(code)}`).then(r => r.data.data),
  moduleOnboarding: () => api.get('/settings/modules/onboarding').then(r => r.data.data) as Promise<OnboardingReport>,
  hideOnboarding: (module: string) => api.post(`/settings/modules/onboarding/${encodeURIComponent(module)}/hide`).then(r => r.data.data) as Promise<OnboardingReport>,
  showOnboarding: () => api.post('/settings/modules/onboarding/show').then(r => r.data.data) as Promise<OnboardingReport>,
  moduleHealth: () => api.get('/settings/modules/health').then(r => r.data.data) as Promise<HealthReport>,
  dismissHealth: (key: string) => api.post(`/settings/modules/health/${encodeURIComponent(key)}/dismiss`).then(r => r.data.data) as Promise<HealthReport>,
  restoreHealth: () => api.post('/settings/modules/health/restore').then(r => r.data.data) as Promise<HealthReport>,
  moduleVersions: () => api.get('/settings/modules/versions').then(r => r.data.data) as Promise<ConfigVersion[]>,
  restoreModuleVersion: (id: number) =>
    api.post(`/settings/modules/versions/${id}/restore`).then(r => r.data.data) as Promise<ModuleActivation>,
  taxCodes: () => api.get('/settings/tax-codes').then(r => r.data.data) as Promise<TaxCode[]>,
  countryPack: () => api.get('/settings/country-pack').then(r => r.data.data) as Promise<CountryPackOverview>,
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

export type DataQualityIndicator = { key: string; label: string; help: string; task: string; toFix: number; total: number; detailLabel: string };
export type DataQualityItem = { id: string; kind: 'recipe' | 'ingredient'; label: string; detail: string };

export type ProcessingActivity = {
  key: string; label: string; purpose: string; data: string; recipients: string;
  rights: { access: boolean; erasure: boolean; note: string };
};
