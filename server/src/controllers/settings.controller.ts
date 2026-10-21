import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { settingsRepository } from '../repositories/settings.repository.js';

function toApi(row: Record<string, unknown>) {
  return {
    companyName: row.company_name,
    subtitle: row.subtitle,
    primaryColor: row.primary_color,
    secondaryColor: row.secondary_color,
    logoUrl: row.logo_url,
    receiptHeader: row.receipt_header || '',
    receiptFooter: row.receipt_footer || 'Merci pour votre visite !',
    receiptShowLogo: row.receipt_show_logo ?? true,
    receiptLogoSize: row.receipt_logo_size ?? 40,
    receiptFontSize: row.receipt_font_size ?? 12,
    receiptPaperWidth: row.receipt_paper_width ?? 80,
    receiptShowCashier: row.receipt_show_cashier ?? true,
    receiptShowDate: row.receipt_show_date ?? true,
    receiptShowPaymentDetail: row.receipt_show_payment_detail ?? true,
    receiptExtraLines: row.receipt_extra_lines || '',
    receiptAutoPrint: row.receipt_auto_print ?? false,
    receiptOpenDrawer: row.receipt_open_drawer ?? false,
    receiptNumCopies: row.receipt_num_copies ?? 1,
    staffDiscountPercent: parseFloat(String(row.staff_discount_percent)) || 10,
    // Theme / Appearance
    themeBgPage: row.theme_bg_page || '#FAF6F1',
    themeBgCard: row.theme_bg_card || '#FFFDF9',
    themeBgSecondary: row.theme_bg_secondary || '#F3ECE2',
    themeBgSeparator: row.theme_bg_separator || '#E8DDD0',
    themeTextStrong: row.theme_text_strong || '#2D1810',
    themeTextBody: row.theme_text_body || '#5C3D2E',
    themeTextMuted: row.theme_text_muted || '#8B7355',
    themeAccent: row.theme_accent || '#C4872B',
    themeAccentHover: row.theme_accent_hover || '#A8721F',
    themeAccentLight: row.theme_accent_light || '#F5E6CC',
    themeCtaColor: row.theme_cta_color || '#C4872B',
    themeCtaText: row.theme_cta_text || '#FFFFFF',
    productionChargeLoyer: parseFloat(String(row.production_charge_loyer)) || 0,
    productionChargeEnergie: parseFloat(String(row.production_charge_energie)) || 0,
    productionChargeAutres: parseFloat(String(row.production_charge_autres)) || 0,
    prixArrondiStrategie: (row.prix_arrondi_strategie as string) || 'aucun',
    prixArrondiSens: (row.prix_arrondi_sens as string) || 'superieur',
    // Identite legale (mig 326)
    legalName: row.legal_name ?? '', legalAddress: row.legal_address ?? '', legalCity: row.legal_city ?? '',
    legalPhone: row.legal_phone ?? '', legalEmail: row.legal_email ?? '', legalRc: row.legal_rc ?? '',
    legalIf: row.legal_if ?? '', legalIce: row.legal_ice ?? '', legalPatente: row.legal_patente ?? '',
  };
}

export const settingsController = {
  async get(_req: AuthRequest, res: Response) {
    const settings = await settingsRepository.get();
    res.json({ success: true, data: toApi(settings) });
  },

  async update(req: AuthRequest, res: Response) {
    const {
      companyName, subtitle, primaryColor, secondaryColor, logoUrl,
      receiptHeader, receiptFooter, receiptShowLogo, receiptLogoSize,
      receiptFontSize, receiptPaperWidth, receiptShowCashier, receiptShowDate,
      receiptShowPaymentDetail, receiptExtraLines,
      receiptAutoPrint, receiptOpenDrawer, receiptNumCopies,
      staffDiscountPercent,
      themeBgPage, themeBgCard, themeBgSecondary, themeBgSeparator,
      themeTextStrong, themeTextBody, themeTextMuted,
      themeAccent, themeAccentHover, themeAccentLight,
      themeCtaColor, themeCtaText,
      productionChargeLoyer, productionChargeEnergie, productionChargeAutres,
      prixArrondiStrategie, prixArrondiSens,
    } = req.body;

    // Identite legale (mig 326) : texte libre borne, '' -> null ; ICE = 15 chiffres.
    const LEGAL_MAX: Record<string, number> = {
      legalName: 120, legalAddress: 300, legalCity: 80, legalPhone: 40, legalEmail: 120,
      legalRc: 30, legalIf: 30, legalIce: 15, legalPatente: 30,
    };
    const legal: Record<string, string | null> = {};
    for (const [key, max] of Object.entries(LEGAL_MAX)) {
      const v = req.body[key];
      if (v === undefined) continue;
      if (v !== null && typeof v !== 'string') { res.status(400).json({ success: false, error: { message: `${key} invalide` } }); return; }
      const t = (key === 'legalIce' ? (v ?? '').replace(/\s/g, '') : (v ?? '').trim());
      if (t.length > max) { res.status(400).json({ success: false, error: { message: `${key} : ${max} caractères maximum` } }); return; }
      legal[key] = t || null;
    }
    if (legal.legalIce && !/^\d{15}$/.test(legal.legalIce)) {
      res.status(400).json({ success: false, error: { message: 'ICE invalide : 15 chiffres attendus' } });
      return;
    }
    if (legal.legalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(legal.legalEmail)) {
      res.status(400).json({ success: false, error: { message: 'Email de l\'entreprise invalide' } });
      return;
    }

    if (primaryColor && !/^#[0-9a-fA-F]{6}$/.test(primaryColor)) {
      res.status(400).json({ success: false, error: { message: 'Couleur primaire invalide (format #RRGGBB)' } });
      return;
    }
    if (secondaryColor && !/^#[0-9a-fA-F]{6}$/.test(secondaryColor)) {
      res.status(400).json({ success: false, error: { message: 'Couleur secondaire invalide (format #RRGGBB)' } });
      return;
    }

    // Validate theme colors
    const hexRegex = /^#[0-9a-fA-F]{6}$/;
    const themeColors = { themeBgPage, themeBgCard, themeBgSecondary, themeBgSeparator, themeTextStrong, themeTextBody, themeTextMuted, themeAccent, themeAccentHover, themeAccentLight, themeCtaColor, themeCtaText };
    for (const [key, val] of Object.entries(themeColors)) {
      if (val && !hexRegex.test(val as string)) {
        res.status(400).json({ success: false, error: { message: `Couleur invalide pour ${key} (format #RRGGBB)` } });
        return;
      }
    }

    const settings = await settingsRepository.update({
      companyName, subtitle, primaryColor, secondaryColor, logoUrl,
      receiptHeader, receiptFooter, receiptShowLogo, receiptLogoSize,
      receiptFontSize, receiptPaperWidth, receiptShowCashier, receiptShowDate,
      receiptShowPaymentDetail, receiptExtraLines,
      receiptAutoPrint, receiptOpenDrawer, receiptNumCopies,
      staffDiscountPercent,
      themeBgPage, themeBgCard, themeBgSecondary, themeBgSeparator,
      themeTextStrong, themeTextBody, themeTextMuted,
      themeAccent, themeAccentHover, themeAccentLight,
      themeCtaColor, themeCtaText,
      productionChargeLoyer, productionChargeEnergie, productionChargeAutres,
      prixArrondiStrategie, prixArrondiSens,
      ...legal,
    }, req.user?.userId);
    res.json({ success: true, data: toApi(settings) });
  },
};
