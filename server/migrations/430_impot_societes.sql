-- ═══════════════════════════════════════════════════════════════════════
-- 430 — Impôt sur les sociétés (feuille de route compta, lot Bonus 12)
-- ═══════════════════════════════════════════════════════════════════════
-- POURQUOI
--   L'IS (acomptes trimestriels, charge de l'exercice, solde) se calculait et
--   se passait hors de l'application ; le résultat net du CPC restait avant
--   impôt.
--
-- RÈGLES (CGI, circulaire DGI n° 737 ; paramétrables par exercice)
--   - Taux proportionnel sur tout le bénéfice fiscal : 20 % sous 100 M DH,
--     35 % au-delà, 40 % pour les établissements de crédit (régime « crédit »).
--   - Cotisation minimale : 0,25 % (CA, produits accessoires, financiers,
--     subventions, HT), minimum 3 000 DH ; IS dû = max(IS, CM). L'excédent de
--     CM est acquis au Trésor (ni reportable, ni imputable).
--   - Acomptes : 4 × 25 % de l'impôt du dernier exercice clos, avant la fin des
--     3e, 6e, 9e et 12e mois ; exercices 2023-2026 : aux taux de l'exercice en
--     cours (art. 247-XXXVII-B). Solde avant la fin du 3e mois suivant.
--
-- ÉCRITURES (CGNC)
--   acompte : 3453 D / 5141|5161 C ;
--   charge de l'exercice (au dernier jour) : 6701 D / 3453 C (acomptes
--   imputés, dans la limite de l'IS) + 4453 C (reste dû) ;
--   solde : 4453 D / 5141|5161 C. Un excédent d'acomptes reste en 3453
--   (crédit d'impôt imputable sur les acomptes suivants).
--
-- INVERSION
--   DROP TABLE corporate_tax_installments, corporate_tax_adjustments, corporate_tax_years ;
--   (les comptes ajoutés peuvent rester).
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO accounts (code, label, account_class, rubrique, poste, account_type, normal_side) VALUES
  ('3453', 'Acomptes sur impôts sur les résultats', 3, '34', '345', 'asset',     'D'),
  ('4453', 'État - impôts sur les résultats',       4, '44', '445', 'liability', 'C'),
  ('6701', 'Impôts sur les bénéfices',              6, '67', '670', 'expense',   'D')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS corporate_tax_years (
  year              smallint PRIMARY KEY CHECK (year BETWEEN 2000 AND 2100),
  regime            varchar(10) NOT NULL DEFAULT 'standard' CHECK (regime IN ('standard', 'credit')),
  rate_standard     numeric(5,2) NOT NULL DEFAULT 20,
  rate_high         numeric(5,2) NOT NULL DEFAULT 35,
  high_threshold    numeric(16,2) NOT NULL DEFAULT 100000000,
  rate_credit       numeric(5,2) NOT NULL DEFAULT 40,
  cm_rate           numeric(5,3) NOT NULL DEFAULT 0.25,
  cm_minimum        numeric(14,2) NOT NULL DEFAULT 3000,
  cm_exempt         boolean NOT NULL DEFAULT false,      -- 36 premiers mois d'exploitation
  cm_base_override  numeric(16,2),                        -- base de CM saisie (sinon calculée)
  status            varchar(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'booked')),
  -- Figé à la comptabilisation de la charge d'IS
  accounting_result numeric(16,2),
  taxable_result    numeric(16,2),
  rate_applied      numeric(5,2),
  is_amount         numeric(14,2),
  cm_base           numeric(16,2),
  cm_amount         numeric(14,2),
  tax_due           numeric(14,2),
  installments_imputed numeric(14,2),
  charge_entry_id   uuid REFERENCES journal_entries(id),
  booked_at         timestamptz,
  booked_by         uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'booked' OR charge_entry_id IS NOT NULL)
);
COMMENT ON TABLE corporate_tax_years IS 'Mig 430 : paramètres et calcul figé de l''IS d''un exercice.';

CREATE TABLE IF NOT EXISTS corporate_tax_adjustments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year       smallint NOT NULL REFERENCES corporate_tax_years(year) ON DELETE CASCADE,
  kind       varchar(14) NOT NULL CHECK (kind IN ('reintegration', 'deduction')),
  label      varchar(200) NOT NULL,
  amount     numeric(16,2) NOT NULL CHECK (amount > 0),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE corporate_tax_adjustments IS
  'Mig 430 : passage du résultat comptable au résultat fiscal (réintégrations, déductions, déficits imputés).';

CREATE TABLE IF NOT EXISTS corporate_tax_installments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year         smallint NOT NULL REFERENCES corporate_tax_years(year) ON DELETE CASCADE,
  kind         varchar(10) NOT NULL CHECK (kind IN ('acompte', 'solde')),
  quarter      smallint CHECK (quarter BETWEEN 1 AND 4),
  amount       numeric(14,2) NOT NULL CHECK (amount > 0),
  paid_on      date NOT NULL,
  treasury     varchar(5) NOT NULL CHECK (treasury IN ('bank', 'cash')),
  reference    varchar(60),
  entry_id     uuid NOT NULL REFERENCES journal_entries(id),
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'acompte') = (quarter IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cti_quarter ON corporate_tax_installments (year, quarter) WHERE kind = 'acompte';
COMMENT ON TABLE corporate_tax_installments IS 'Mig 430 : acomptes et solde d''IS versés, avec leur écriture.';
