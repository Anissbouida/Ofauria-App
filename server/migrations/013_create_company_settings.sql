CREATE TABLE company_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name VARCHAR(100) NOT NULL DEFAULT 'OFAURIA',
  subtitle VARCHAR(200) NOT NULL DEFAULT 'Boulangerie - Patisserie',
  primary_color VARCHAR(7) NOT NULL DEFAULT '#714B67',
  secondary_color VARCHAR(7) NOT NULL DEFAULT '#5f3d57',
  logo_url TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO company_settings (company_name, subtitle, primary_color, secondary_color)
VALUES ('OFAURIA', 'Boulangerie - Patisserie', '#714B67', '#5f3d57');
