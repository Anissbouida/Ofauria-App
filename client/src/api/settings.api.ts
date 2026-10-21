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

export const settingsApi = {
  get: () => api.get('/settings').then(r => r.data.data) as Promise<CompanySettings>,
  update: (data: Partial<CompanySettings>) => api.put('/settings', data).then(r => r.data.data) as Promise<CompanySettings>,
  auditLog: (params: { table?: string; changedBy?: string; subjectId?: string; from?: string; to?: string; q?: string; limit?: number; offset?: number }) =>
    api.get('/settings/audit-log', { params }).then(r => r.data.data) as Promise<Paged<AuditLogEntry>>,
  auditTables: () => api.get('/settings/audit-log/tables').then(r => r.data.data) as Promise<string[]>,
  authEvents: (params: { eventType?: string; userId?: string; success?: boolean; from?: string; to?: string; limit?: number; offset?: number }) =>
    api.get('/settings/auth-events', { params }).then(r => r.data.data) as Promise<Paged<AuthEventEntry>>,
  uploadLogo: (file: File) => {
    const formData = new FormData();
    formData.append('logo', file);
    return api.post('/upload/logo', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data.data as { url: string });
  },
};
