-- G6-06 (plan d'action 2026-11) — pack pays, phase 1 : paramètres légaux datés par pays.
--
-- La devise est faite (mig 592). Restaient, codés en dur dans le serveur, les paramètres
-- légaux marocains de la paie et de la fiscalité. Ce lot les sort en DONNÉES, sans changer
-- un seul chiffre (zéro écart) :
--
--   country_packs              un pack par pays (code ISO 3166-1 alpha-2, nom, devise par
--                              défaut, formats déclaratifs propres au pays) ;
--   country_pack_parameters    paramètres DATÉS d'un pack (clé, valeur numérique OU json,
--                              date d'effet) : la valeur en vigueur à une date est celle de
--                              la plus grande date d'effet <= date.
--
-- Ce qui existait déjà est RÉUTILISÉ, pas dupliqué :
--   - pays actif de la société : module_parameters 'company.country_code' (mig 309, « choisit
--     le pack pays »), déjà lu par tax_codes ; pas de nouvelle colonne company_settings ;
--   - barème de paie daté (CNSS, AMO, plafond 6 000, allocations familiales, taxe de formation
--     professionnelle, frais professionnels, barème IR, SMIG) : payroll_tax_scales (mig 241,
--     318, 524) — c'est la partie « cotisations » du pack MA, éditable avec piste d'audit ;
--   - codes TVA datés : tax_codes (mig 309, par pays) ;
--   - réglages de l'employeur (base 26 j, 191 h, majorations…) : payroll_settings (mig 318,
--     321) — le pack fournit la valeur LÉGALE quand le réglage est absent.
--
-- Pack 'MA' rempli avec EXACTEMENT les valeurs jusqu'ici codées en dur :
--   paie.base_days 26 · paie.legal_monthly_hours 191 · paie.legal_weekly_hours 44 ·
--   paie.ot_rates {25 %, 50 %, 50 %, 100 %} · paie.night_window 21:00-06:00 ·
--   paie.holiday_worked_rate 1 · paie.ot_annual_quota_hours 100 ·
--   paie.seniority_brackets 5/10/15/20/25 % à 2/5/12/20/25 ans (art. 350 C. trav.) ·
--   fiscalite.vat_rates [7, 10, 14, 20] · formats.rib_length 24 · formats.ice_length 15.
-- Les formats déclaratifs (e-BDS Damancom, EDI SIMPL TVA / 9421 / liasse IS, liasse
-- fiscale, relevé des déductions) restent marocains : ils sont listés dans
-- country_packs.declarative_formats et le serveur refuse (400) ces routes si le pays actif
-- n'est pas MA.
--
-- Lecture seule dans cette phase (Paramètres › Finance › Pays et législation) : la
-- modification sera réservée au comptable dans une phase ultérieure.
--
-- INVERSION :
--   DROP TABLE IF EXISTS country_pack_parameters;
--   DROP TABLE IF EXISTS country_packs;

CREATE TABLE IF NOT EXISTS country_packs (
  code                 CHAR(2)      PRIMARY KEY CHECK (code ~ '^[A-Z]{2}$'),
  name                 VARCHAR(80)  NOT NULL,
  default_currency     CHAR(3)      NOT NULL CHECK (default_currency ~ '^[A-Z]{3}$'),
  declarative_formats  TEXT[]       NOT NULL DEFAULT '{}',
  notes                TEXT,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE country_packs IS
  'G6-06 (mig 606) : pack pays (législation). Pays actif = module_parameters company.country_code.';
COMMENT ON COLUMN country_packs.declarative_formats IS
  'Formats déclaratifs propres au pays (codes) : routes refusées si le pays actif ne les porte pas.';

CREATE TABLE IF NOT EXISTS country_pack_parameters (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code    CHAR(2)      NOT NULL REFERENCES country_packs(code),
  key             VARCHAR(60)  NOT NULL CHECK (key ~ '^[a-z]+\.[a-z0-9_]+$'),
  category        VARCHAR(20)  NOT NULL CHECK (category IN ('paie', 'fiscalite', 'formats')),
  label           VARCHAR(160) NOT NULL,
  value_numeric   NUMERIC(14,4),
  value_json      JSONB,
  effective_from  DATE         NOT NULL,
  legal_ref       VARCHAR(160),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT chk_country_param_one_value CHECK ((value_numeric IS NULL) <> (value_json IS NULL)),
  CONSTRAINT uq_country_param UNIQUE (country_code, key, effective_from)
);
COMMENT ON TABLE country_pack_parameters IS
  'G6-06 (mig 606) : paramètres légaux datés d''un pack pays ; valeur en vigueur = plus grande date d''effet <= date.';

INSERT INTO country_packs (code, name, default_currency, declarative_formats, notes)
VALUES ('MA', 'Maroc', 'MAD',
        ARRAY['ebds', 'edi_tva_deductions', 'edi_9421', 'edi_liasse_is', 'liasse', 'vat_deduction_statement'],
        'Code du travail (loi 65-99), CGI, CNSS/AMO. Barème de paie daté : payroll_tax_scales ; TVA datée : tax_codes.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO country_pack_parameters (country_code, key, category, label, value_numeric, value_json, effective_from, legal_ref)
SELECT 'MA', v.key, v.category, v.label, v.num, v.js::jsonb, DATE '2000-01-01', v.ref
  FROM (VALUES
    ('paie.base_days',             'paie',      'Base journalière : jours par mois',                 26::numeric,  NULL, 'Usage CNSS (26 jours déclarés)'),
    ('paie.legal_monthly_hours',   'paie',      'Durée légale mensuelle (heures)',                   191,          NULL, 'C. trav. art. 184 (2 288 h / an)'),
    ('paie.legal_weekly_hours',    'paie',      'Durée légale hebdomadaire (heures)',                44,           NULL, 'C. trav. art. 184'),
    ('paie.ot_rates',              'paie',      'Majorations des heures supplémentaires',            NULL,         '{"day": 0.25, "night": 0.5, "restDay": 0.5, "restNight": 1}', 'C. trav. art. 201'),
    ('paie.night_window',          'paie',      'Plage du travail de nuit',                          NULL,         '{"start": "21:00", "end": "06:00"}', 'C. trav. art. 201'),
    ('paie.holiday_worked_rate',   'paie',      'Indemnité d''un jour férié travaillé (en jours)',   1,            NULL, 'C. trav. art. 217-220'),
    ('paie.ot_annual_quota_hours', 'paie',      'Contingent annuel d''heures supplémentaires',      100,          NULL, 'Décret 2-04-570'),
    ('paie.seniority_brackets',    'paie',      'Prime d''ancienneté (taux par années de service)',  NULL,         '[{"minYears": 2, "rate": 0.05}, {"minYears": 5, "rate": 0.10}, {"minYears": 12, "rate": 0.15}, {"minYears": 20, "rate": 0.20}, {"minYears": 25, "rate": 0.25}]', 'C. trav. art. 350-352'),
    ('fiscalite.vat_rates',        'fiscalite', 'Taux de TVA légaux (%)',                            NULL,         '[7, 10, 14, 20]', 'CGI art. 98-100'),
    ('formats.rib_length',         'formats',   'RIB bancaire : nombre de chiffres',                 24,           NULL, 'Bank Al-Maghrib'),
    ('formats.ice_length',         'formats',   'ICE : nombre de chiffres',                          15,           NULL, 'Décret 2-11-13')
  ) AS v (key, category, label, num, js, ref)
ON CONFLICT (country_code, key, effective_from) DO NOTHING;
