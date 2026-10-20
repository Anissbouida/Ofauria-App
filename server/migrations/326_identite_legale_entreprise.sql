-- ═══════════════════════════════════════════════════════════════════════
-- 326 — Identité légale de l'entreprise dans les paramètres
--   Jusqu'ici codée en dur (utils/company-legal.ts) : raison sociale,
--   siège, ville, téléphone, email, RC, IF, ICE, patente. Elle devient
--   saisissable dans Paramètres > Entreprise et alimente factures, bons de
--   commande, bulletins de paie, attestations et pièces de départ.
--   Le nom commercial (company_name) reste distinct de la raison sociale.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS legal_name    VARCHAR(120),
  ADD COLUMN IF NOT EXISTS legal_address TEXT,
  ADD COLUMN IF NOT EXISTS legal_city    VARCHAR(80),
  ADD COLUMN IF NOT EXISTS legal_phone   VARCHAR(40),
  ADD COLUMN IF NOT EXISTS legal_email   VARCHAR(120),
  ADD COLUMN IF NOT EXISTS legal_rc      VARCHAR(30),
  ADD COLUMN IF NOT EXISTS legal_if      VARCHAR(30),
  -- Identifiant commun de l'entreprise : 15 chiffres.
  ADD COLUMN IF NOT EXISTS legal_ice     VARCHAR(15),
  ADD COLUMN IF NOT EXISTS legal_patente VARCHAR(30);

ALTER TABLE company_settings DROP CONSTRAINT IF EXISTS company_settings_legal_ice_format;
ALTER TABLE company_settings ADD CONSTRAINT company_settings_legal_ice_format
  CHECK (legal_ice IS NULL OR legal_ice ~ '^[0-9]{15}$');

-- Reprise des valeurs jusqu'ici codées en dur (sans écraser une saisie).
UPDATE company_settings SET
  legal_name    = COALESCE(legal_name,    'TRIANGLE D''ORIENT SARL'),
  legal_address = COALESCE(legal_address, 'NR 22 RDC LOTISSEMENT FAJR MOHAMMEDIA'),
  legal_city    = COALESCE(legal_city,    'Mohammedia'),
  legal_phone   = COALESCE(legal_phone,   '06 49 83 77 67'),
  legal_email   = COALESCE(legal_email,   'gestion@ofauria.ma'),
  legal_rc      = COALESCE(legal_rc,      '38769'),
  legal_if      = COALESCE(legal_if,      '68818304'),
  legal_ice     = COALESCE(legal_ice,     '003805857000072'),
  legal_patente = COALESCE(legal_patente, '39503652')
WHERE id = 1;
