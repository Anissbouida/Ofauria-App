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
}

export const settingsApi = {
  get: () => api.get('/settings').then(r => r.data.data) as Promise<CompanySettings>,
  update: (data: Partial<CompanySettings>) => api.put('/settings', data).then(r => r.data.data) as Promise<CompanySettings>,
  uploadLogo: (file: File) => {
    const formData = new FormData();
    formData.append('logo', file);
    return api.post('/upload/logo', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data.data as { url: string });
  },
};
