-- ═══════════════════════════════════════════════════════════════════════
-- 318 — Paie mensuelle marocaine, lot 1 de la refonte RH
--   1. Barème versionné (payroll_tax_scales, mig 241) enfin LU par le moteur,
--      et remis à jour : réforme IR (LF 2025, art. 73 CGI) et frais
--      professionnels 35 % / 25 % (seuil 78 000 DH, plafond 35 000 DH/an).
--   2. Salarié déclaré (CNSS + IR) par employé, à la place du drapeau
--      APPLY_SOCIAL_DEDUCTIONS codé en dur (l'établissement est déclaré).
--   3. Rubriques de paie (primes, indemnités, retenues) avec leur régime :
--      soumise CNSS / IR, part exonérée plafonnée (ex. transport 500 DH).
--   4. Éléments fixes par employé (rubrique + montant + période de validité)
--      et lignes de bulletin (fixes reprises à la génération + manuelles).
--   5. Clôture de période : un mois clôturé ne se régénère ni ne s'édite.
--   6. Snapshot sur le bulletin : barème utilisé, bases CNSS et IR.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Barème ──────────────────────────────────────────────────────────
-- Les anciennes colonnes frais_pro_rate / frais_pro_plafond / deduction_famille
-- (mensuelles, règle 20 % / 2 500 DH) sont conservées pour l'historique ;
-- le moteur lit les colonnes annuelles ci-dessous.
ALTER TABLE payroll_tax_scales
  ADD COLUMN IF NOT EXISTS frais_pro_rate_haut        DECIMAL(6,4),
  ADD COLUMN IF NOT EXISTS frais_pro_seuil_annuel     DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS frais_pro_plafond_annuel   DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS deduction_famille_annuelle DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS max_personnes_charge       SMALLINT NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_by                 UUID REFERENCES users(id);

-- Le barème 2025 seedé en 241 n'a jamais servi (déductions désactivées) et
-- reprenait l'ancien barème : on le corrige en place.
-- ir_brackets : [{upTo, rate, deduction}] — IR annuel = RNI × rate − deduction
-- sur la tranche où RNI ≤ upTo (upTo null = au-delà).
UPDATE payroll_tax_scales SET
  label = 'Barème marocain — LF 2025 (art. 73 CGI)',
  cnss_plafond = 6000, cnss_rate_employee = 0.0448, cnss_rate_employer = 0.0898,
  amo_rate_employee = 0.0226, amo_rate_employer = 0.0411,
  alloc_familiales_rate = 0.064, taxe_fp_rate = 0.016,
  frais_pro_rate = 0.35, frais_pro_rate_haut = 0.25,
  frais_pro_seuil_annuel = 78000, frais_pro_plafond_annuel = 35000,
  deduction_famille_annuelle = 500, max_personnes_charge = 6,
  ir_brackets = '[
    {"upTo": 40000,  "rate": 0.00, "deduction": 0},
    {"upTo": 60000,  "rate": 0.10, "deduction": 4000},
    {"upTo": 80000,  "rate": 0.20, "deduction": 10000},
    {"upTo": 100000, "rate": 0.30, "deduction": 18000},
    {"upTo": 180000, "rate": 0.34, "deduction": 22000},
    {"upTo": null,   "rate": 0.37, "deduction": 27400}
  ]'::jsonb,
  notes = 'CNSS 4,48 % / 8,98 % (court + long terme, plafond 6 000 DH) ; AMO 2,26 % / 4,11 % '
       || '(dont participation 1,85 %) ; alloc. familiales 6,40 % ; TFP 1,60 %. '
       || 'Frais pro : 35 % si brut imposable annuel <= 78 000 DH, sinon 25 %, plafond 35 000 DH/an. '
       || 'Charges de famille : montant annuel par personne a confirmer avec le comptable (500 DH LF 2025).'
WHERE effective_from = '2025-01-01';

-- ─── 2. Employeur et salarié déclarés ──────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_settings (
  id                     SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  employer_cnss_number   VARCHAR(30),
  -- Base journalière de la paie mensuelle (convention marocaine 26 jours).
  monthly_base_days      SMALLINT NOT NULL DEFAULT 26 CHECK (monthly_base_days BETWEEN 20 AND 31),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by             UUID REFERENCES users(id)
);
INSERT INTO payroll_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Déclaré = soumis CNSS/AMO/CIMR et IR. Les extras non déclarés (stagiaires
-- conventionnés, journaliers) restent payés au brut.
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS is_declared BOOLEAN NOT NULL DEFAULT true;

-- ─── 3. Rubriques ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_rubriques (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          VARCHAR(30) NOT NULL UNIQUE,
  label         VARCHAR(120) NOT NULL,
  -- gain : entre dans le brut ; retenue : déduite du net (prêt, cantine…).
  kind          VARCHAR(10) NOT NULL CHECK (kind IN ('gain', 'retenue')),
  -- Régime d'un gain, appliqué à la part qui DÉPASSE plafond_exoneration
  -- (toute la ligne si le plafond est NULL). Sans effet sur une retenue.
  soumis_cnss   BOOLEAN NOT NULL DEFAULT true,
  soumis_ir     BOOLEAN NOT NULL DEFAULT true,
  plafond_exoneration_mensuel DECIMAL(10,2) CHECK (plafond_exoneration_mensuel IS NULL OR plafond_exoneration_mensuel >= 0),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  sort_order    SMALLINT NOT NULL DEFAULT 100,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO payroll_rubriques (code, label, kind, soumis_cnss, soumis_ir, plafond_exoneration_mensuel, sort_order, notes) VALUES
  ('PRIME_RENDEMENT',  'Prime de rendement',         'gain',    true,  true,  NULL, 10, NULL),
  ('PRIME_EXCEPT',     'Prime exceptionnelle',       'gain',    true,  true,  NULL, 20, NULL),
  ('PRIME_FETE',       'Prime de fête (Aïd)',        'gain',    true,  true,  NULL, 30, NULL),
  ('IND_TRANSPORT',    'Indemnité de transport',     'gain',    true,  true,  500,  40, 'Exonérée CNSS/IR jusqu''à 500 DH/mois (périmètre urbain) ; au-delà, soumise.'),
  ('PRIME_PANIER',     'Prime de panier',            'gain',    true,  true,  NULL, 50, 'Exonération limitée (2 x SMIG horaire par jour) : régler le plafond selon votre cas.'),
  ('AVANTAGE_NATURE',  'Avantage en nature',         'gain',    true,  true,  NULL, 60, NULL),
  ('RAPPEL_SALAIRE',   'Rappel de salaire',          'gain',    true,  true,  NULL, 70, NULL),
  ('RET_PRET',         'Remboursement de prêt',      'retenue', false, false, NULL, 110, 'Retenue après net imposable (hors avances sur salaire, gérées à part).'),
  ('RET_DIVERSE',      'Retenue diverse',            'retenue', false, false, NULL, 120, NULL)
ON CONFLICT (code) DO NOTHING;

-- ─── 4. Éléments fixes et lignes de bulletin ───────────────────────────
CREATE TABLE IF NOT EXISTS employee_payroll_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  rubrique_id  UUID NOT NULL REFERENCES payroll_rubriques(id),
  amount       DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  start_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date     DATE,
  notes        TEXT,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT employee_payroll_items_period CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_employee_payroll_items_emp ON employee_payroll_items(employee_id);

CREATE TABLE IF NOT EXISTS payroll_lines (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_id   UUID NOT NULL REFERENCES payroll(id) ON DELETE CASCADE,
  rubrique_id  UUID NOT NULL REFERENCES payroll_rubriques(id),
  -- Snapshot du régime au moment du calcul (la rubrique peut changer ensuite).
  label        VARCHAR(120) NOT NULL,
  kind         VARCHAR(10) NOT NULL CHECK (kind IN ('gain', 'retenue')),
  amount       DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  exempt_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  cnss_amount  DECIMAL(10,2) NOT NULL DEFAULT 0,
  ir_amount    DECIMAL(10,2) NOT NULL DEFAULT 0,
  -- fixe : reprise d'un élément fixe à chaque génération ; manuel : saisi sur le bulletin.
  source       VARCHAR(10) NOT NULL CHECK (source IN ('fixe', 'manuel')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payroll_lines_payroll ON payroll_lines(payroll_id);

-- ─── 5. Clôture de période ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_periods (
  year       SMALLINT NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  month      SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  status     VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at  TIMESTAMPTZ,
  closed_by  UUID REFERENCES users(id),
  PRIMARY KEY (year, month)
);

-- ─── 6. Snapshot sur le bulletin ───────────────────────────────────────
ALTER TABLE payroll
  ADD COLUMN IF NOT EXISTS tax_scale_id     UUID REFERENCES payroll_tax_scales(id),
  ADD COLUMN IF NOT EXISTS is_declared      BOOLEAN,
  ADD COLUMN IF NOT EXISTS base_cnss        DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS brut_imposable   DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS net_imposable    DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS other_deductions DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seniority_rate   DECIMAL(5,4);

COMMENT ON COLUMN payroll.bonuses IS
  'Somme des gains de rubriques (payroll_lines kind=gain) depuis la mig 318.';
COMMENT ON COLUMN payroll.other_deductions IS
  'Somme des retenues de rubriques (payroll_lines kind=retenue), déduites du net.';

-- ─── 7. Reprise des primes manuelles existantes ────────────────────────
-- Les primes saisies avant 318 (payroll.bonuses) sur des bulletins NON payés
-- deviennent des lignes manuelles « Prime exceptionnelle », sinon la
-- prochaine régénération (bonuses = somme des lignes) les effacerait.
INSERT INTO payroll_lines (payroll_id, rubrique_id, label, kind, amount, cnss_amount, ir_amount, source)
SELECT p.id, r.id, r.label, 'gain', p.bonuses, p.bonuses, p.bonuses, 'manuel'
  FROM payroll p
  JOIN payroll_rubriques r ON r.code = 'PRIME_EXCEPT'
 WHERE p.paid = false AND COALESCE(p.bonuses, 0) > 0
   AND NOT EXISTS (SELECT 1 FROM payroll_lines l WHERE l.payroll_id = p.id);
