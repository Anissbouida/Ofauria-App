import { db } from '../config/database.js';
import { auditedQuery } from '../utils/audit-context.js';

export const settingsRepository = {
  async get() {
    const result = await db.query('SELECT * FROM company_settings WHERE id = 1');
    return result.rows[0];
  },

  /** N° d'affiliation CNSS employeur : tenu dans les paramètres de paie (mig 318), affiché sur la fiche société. */
  async employerCnss(): Promise<string | null> {
    const exists = (await db.query(`SELECT to_regclass('public.payroll_settings') IS NOT NULL AS ok`)).rows[0].ok;
    if (!exists) return null;
    const r = await db.query(`SELECT employer_cnss_number FROM payroll_settings WHERE id = 1`);
    return (r.rows[0]?.employer_cnss_number as string | null) ?? null;
  },

  async update(data: {
    companyName?: string; subtitle?: string;
    primaryColor?: string; secondaryColor?: string; logoUrl?: string | null;
    receiptHeader?: string; receiptFooter?: string;
    receiptShowLogo?: boolean; receiptLogoSize?: number;
    receiptFontSize?: number; receiptPaperWidth?: number;
    receiptShowCashier?: boolean; receiptShowDate?: boolean;
    receiptShowPaymentDetail?: boolean; receiptExtraLines?: string;
    receiptAutoPrint?: boolean; receiptOpenDrawer?: boolean; receiptNumCopies?: number;
    staffDiscountPercent?: number;
    // Theme / Appearance
    themeBgPage?: string; themeBgCard?: string; themeBgSecondary?: string; themeBgSeparator?: string;
    themeTextStrong?: string; themeTextBody?: string; themeTextMuted?: string;
    themeAccent?: string; themeAccentHover?: string; themeAccentLight?: string;
    themeCtaColor?: string; themeCtaText?: string;
    // Production feature flags
    productionFrigoEnabled?: boolean; productionCalculInverseEnabled?: boolean;
    productionStepsEnabled?: boolean; productionStepsBlocking?: boolean;
    productionYieldEnabled?: boolean; productionCostEnabled?: boolean;
    productionChargeLoyer?: number; productionChargeEnergie?: number; productionChargeAutres?: number;
    // Arrondi prix (mig 170)
    prixArrondiStrategie?: string;
    prixArrondiSens?: string;
    // Identite legale (mig 326)
    legalName?: string | null; legalAddress?: string | null; legalCity?: string | null;
    legalPhone?: string | null; legalEmail?: string | null; legalRc?: string | null;
    legalIf?: string | null; legalIce?: string | null; legalPatente?: string | null;
    // Fiche societe (mig 331)
    legalForm?: string | null; legalCapital?: number | null; legalWebsite?: string | null;
  }, actorId?: string) {
    const mapping: Record<string, string> = {
      companyName: 'company_name',
      subtitle: 'subtitle',
      primaryColor: 'primary_color',
      secondaryColor: 'secondary_color',
      logoUrl: 'logo_url',
      receiptHeader: 'receipt_header',
      receiptFooter: 'receipt_footer',
      receiptShowLogo: 'receipt_show_logo',
      receiptLogoSize: 'receipt_logo_size',
      receiptFontSize: 'receipt_font_size',
      receiptPaperWidth: 'receipt_paper_width',
      receiptShowCashier: 'receipt_show_cashier',
      receiptShowDate: 'receipt_show_date',
      receiptShowPaymentDetail: 'receipt_show_payment_detail',
      receiptExtraLines: 'receipt_extra_lines',
      receiptAutoPrint: 'receipt_auto_print',
      receiptOpenDrawer: 'receipt_open_drawer',
      receiptNumCopies: 'receipt_num_copies',
      staffDiscountPercent: 'staff_discount_percent',
      // Theme / Appearance
      themeBgPage: 'theme_bg_page',
      themeBgCard: 'theme_bg_card',
      themeBgSecondary: 'theme_bg_secondary',
      themeBgSeparator: 'theme_bg_separator',
      themeTextStrong: 'theme_text_strong',
      themeTextBody: 'theme_text_body',
      themeTextMuted: 'theme_text_muted',
      themeAccent: 'theme_accent',
      themeAccentHover: 'theme_accent_hover',
      themeAccentLight: 'theme_accent_light',
      themeCtaColor: 'theme_cta_color',
      themeCtaText: 'theme_cta_text',
      // Production feature flags
      productionFrigoEnabled: 'production_frigo_enabled',
      productionCalculInverseEnabled: 'production_calcul_inverse_enabled',
      productionStepsEnabled: 'production_steps_enabled',
      productionStepsBlocking: 'production_steps_blocking',
      productionYieldEnabled: 'production_yield_enabled',
      productionCostEnabled: 'production_cost_enabled',
      productionChargeLoyer: 'production_charge_loyer',
      productionChargeEnergie: 'production_charge_energie',
      productionChargeAutres: 'production_charge_autres',
      // Arrondi prix (mig 170)
      prixArrondiStrategie: 'prix_arrondi_strategie',
      prixArrondiSens: 'prix_arrondi_sens',
      // Identite legale (mig 326)
      legalName: 'legal_name', legalAddress: 'legal_address', legalCity: 'legal_city',
      legalPhone: 'legal_phone', legalEmail: 'legal_email', legalRc: 'legal_rc',
      legalIf: 'legal_if', legalIce: 'legal_ice', legalPatente: 'legal_patente',
      // Fiche societe (mig 331)
      legalForm: 'legal_form', legalCapital: 'legal_capital', legalWebsite: 'legal_website',
    };

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    for (const [key, col] of Object.entries(mapping)) {
      if ((data as Record<string, unknown>)[key] !== undefined) {
        fields.push(`${col} = $${i++}`);
        values.push((data as Record<string, unknown>)[key]);
      }
    }

    if (fields.length === 0) return this.get();
    fields.push('updated_at = NOW()');
    const result = await auditedQuery(actorId, `UPDATE company_settings SET ${fields.join(', ')} WHERE id = 1 RETURNING *`, values);
    return result.rows[0];
  },

  // ── Réglages de production centralisés (mig 403) — roadmap lot 9 ──
  async getProductionSettings() {
    const r = await db.query(
      `SELECT production_charges_fixes_pct, production_overproduction_pct, production_markup_percent,
              production_steps_enabled, production_steps_blocking, production_yield_enabled, production_cost_enabled
       FROM company_settings WHERE id = 1`
    );
    return r.rows[0] ?? null;
  },
  async updateProductionSettings(data: {
    chargesFixesPct?: number; overproductionPct?: number; markupPercent?: number;
    stepsEnabled?: boolean; stepsBlocking?: boolean; yieldEnabled?: boolean; costEnabled?: boolean;
  }, actorId: string | null) {
    const mapping: Record<string, string> = {
      chargesFixesPct: 'production_charges_fixes_pct',
      overproductionPct: 'production_overproduction_pct',
      markupPercent: 'production_markup_percent',
      stepsEnabled: 'production_steps_enabled',
      stepsBlocking: 'production_steps_blocking',
      yieldEnabled: 'production_yield_enabled',
      costEnabled: 'production_cost_enabled',
    };
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, col] of Object.entries(mapping)) {
      if ((data as Record<string, unknown>)[key] !== undefined) {
        fields.push(`${col} = $${i++}`);
        values.push((data as Record<string, unknown>)[key]);
      }
    }
    if (fields.length === 0) return this.getProductionSettings();
    fields.push('updated_at = NOW()');
    await auditedQuery(actorId, `UPDATE company_settings SET ${fields.join(', ')} WHERE id = 1`, values);
    return this.getProductionSettings();
  },
};
