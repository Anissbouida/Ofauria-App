import { db } from '../config/database.js';

export const settingsRepository = {
  async get() {
    const result = await db.query('SELECT * FROM company_settings WHERE id = 1');
    return result.rows[0];
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
  }) {
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
    const result = await db.query(`UPDATE company_settings SET ${fields.join(', ')} WHERE id = 1 RETURNING *`, values);
    return result.rows[0];
  },
};
