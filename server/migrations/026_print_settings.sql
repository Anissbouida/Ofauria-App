-- Print settings for receipt customization
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS receipt_header TEXT DEFAULT '';
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS receipt_footer TEXT DEFAULT 'Merci pour votre visite !';
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS receipt_show_logo BOOLEAN DEFAULT true;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS receipt_logo_size INTEGER DEFAULT 40;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS receipt_font_size INTEGER DEFAULT 12;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS receipt_paper_width INTEGER DEFAULT 80;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS receipt_show_cashier BOOLEAN DEFAULT true;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS receipt_show_date BOOLEAN DEFAULT true;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS receipt_show_payment_detail BOOLEAN DEFAULT true;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS receipt_extra_lines TEXT DEFAULT '';
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS receipt_auto_print BOOLEAN DEFAULT false;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS receipt_open_drawer BOOLEAN DEFAULT false;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS receipt_num_copies INTEGER DEFAULT 1;
