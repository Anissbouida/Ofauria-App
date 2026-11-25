-- Préparation du contexte entreprise ; valeurs par défaut compatibles avec l'installation actuelle.
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS default_locale varchar(10) NOT NULL DEFAULT 'fr';
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Africa/Casablanca';
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS company_size text;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS tax_regime text;
