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
    } = req.body;

    if (primaryColor && !/^#[0-9a-fA-F]{6}$/.test(primaryColor)) {
      res.status(400).json({ success: false, error: { message: 'Couleur primaire invalide (format #RRGGBB)' } });
      return;
    }
    if (secondaryColor && !/^#[0-9a-fA-F]{6}$/.test(secondaryColor)) {
      res.status(400).json({ success: false, error: { message: 'Couleur secondaire invalide (format #RRGGBB)' } });
      return;
    }

    const settings = await settingsRepository.update({
      companyName, subtitle, primaryColor, secondaryColor, logoUrl,
      receiptHeader, receiptFooter, receiptShowLogo, receiptLogoSize,
      receiptFontSize, receiptPaperWidth, receiptShowCashier, receiptShowDate,
      receiptShowPaymentDetail, receiptExtraLines,
      receiptAutoPrint, receiptOpenDrawer, receiptNumCopies,
    });
    res.json({ success: true, data: toApi(settings) });
  },
};
