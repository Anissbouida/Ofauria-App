-- Migration 210 : Retenues a la source (RAS) — comptes + configuration
--
-- POURQUOI
--   La loi marocaine impose a l'entreprise de retenir certains impots a la
--   source (sur loyers, salaires, honoraires, dividendes...) et de les reverser
--   a la DGI. Le module TVA existant ne couvrait pas ces retenues.
--
--   Reference : Code General des Impots (CGI) et loi de finances 50-25 (2026).
--   Le CGNC enregistre ces retenues dans le poste 4452 "Etat - Impots, taxes
--   et assimiles" (y compris les retenues effectuees par l'entreprise pour le
--   compte de l'Etat) ; 44525 "Etat, IGR" est le compte officiel de l'impot
--   sur le revenu.
--
-- PORTEE
--   - Comptes RAS (subdivisions de 4452, sens crediteur = dette envers l'Etat).
--   - Table withholding_tax_types : configuration des taux/seuils, MODIFIABLE
--     (les taux ne sont pas figes dans le code -> s'adaptent a la loi de finances).
--   Aucune table existante modifiee.
--
-- INVERSION : DROP TABLE withholding_tax_types; DELETE comptes 4452x ajoutes.

-- ============================================================================
-- 1. Comptes RAS (classe 4, Etat crediteur, sens C)
-- ============================================================================
INSERT INTO accounts (code, label, account_class, rubrique, poste, account_type, normal_side) VALUES
  ('44525', 'Etat, IGR (impot sur le revenu) a verser',                4, '44', '445', 'liability', 'C'),
  ('44526', 'Etat, RAS sur revenus fonciers (loyers) a verser',        4, '44', '445', 'liability', 'C'),
  ('44527', 'Etat, RAS sur honoraires et prestations a verser',        4, '44', '445', 'liability', 'C'),
  ('44528', 'Etat, RAS/TPA sur produits des actions (dividendes) a verser', 4, '44', '445', 'liability', 'C'),
  ('44529', 'Etat, RAS/TPPRF sur produits de placements a verser',     4, '44', '445', 'liability', 'C')
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- 2. Table de configuration des retenues a la source
-- ============================================================================
-- rate / threshold / rate_above : si threshold defini, on applique rate jusqu'au
--   seuil (annuel, par tiers) et rate_above au-dela. Sinon rate seul.
-- base : assiette de la retenue ('brut_ht' ou 'brut_ttc').
-- echeance_jours : delai de reversement a la DGI apres la retenue.
-- Les taux sont des VALEURS PAR DEFAUT modifiables via l'UI (admin/gerant).

CREATE TABLE IF NOT EXISTS withholding_tax_types (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(30) NOT NULL UNIQUE,
  label           VARCHAR(200) NOT NULL,
  legal_ref       VARCHAR(120),
  account_id      UUID NOT NULL REFERENCES accounts(id),
  rate            DECIMAL(5,2),                 -- NULL = calcule ailleurs (ex: IR salaires via paie)
  threshold       DECIMAL(14,2),                -- seuil annuel par tiers, NULL si pas de palier
  rate_above      DECIMAL(5,2),                 -- taux au-dela du seuil
  base            VARCHAR(20) NOT NULL DEFAULT 'brut_ht'
                    CHECK (base IN ('brut_ht', 'brut_ttc')),
  echeance_jours  INT NOT NULL DEFAULT 30,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wht_active ON withholding_tax_types(is_active);

COMMENT ON TABLE withholding_tax_types IS
  'Configuration des retenues a la source (taux/seuils modifiables). Reference CGI/loi de finances.';

-- ============================================================================
-- 3. Seed des types de RAS (taux PAR DEFAUT — a confirmer avec l'expert-comptable)
-- ============================================================================
-- NB : seul le 5% sur produits de location (art. 73-II-A) est confirme par la
-- LF 2026 ; les autres taux sont les taux usuels du CGI, a valider.

INSERT INTO withholding_tax_types (code, label, legal_ref, account_id, rate, threshold, rate_above, base, echeance_jours, notes)
SELECT v.code, v.label, v.legal_ref, a.id, v.rate, v.threshold, v.rate_above, v.base, v.echeance, v.notes
FROM (VALUES
  ('ir_salaires', 'IR sur salaires (retenue mensuelle)', 'CGI art. 56-58, 156, 174', '44525',
    NULL::numeric, NULL::numeric, NULL::numeric, 'brut_ht', 30,
    'Bareme progressif deja calcule par le module paie. Integration comptable uniquement.'),
  ('loyers', 'RAS sur revenus fonciers (loyers)', 'CGI art. 73-II / 160 bis', '44526',
    10.00, 120000.00, 15.00, 'brut_ht', 30,
    'Bailleur personne physique. 10% si loyer annuel <= 120 000 DH, 15% au-dela. A confirmer.'),
  ('honoraires', 'RAS sur honoraires et prestations', 'CGI art. 15, 157', '44527',
    10.00, NULL, NULL, 'brut_ht', 30,
    'Prestataires (notamment non-residents). Taux a confirmer selon nature/residence.'),
  ('tpa', 'TPA sur produits des actions (dividendes)', 'CGI art. 13, 19-IV', '44528',
    15.00, NULL, NULL, 'brut_ht', 30,
    'Taxe sur les produits des actions. A confirmer.'),
  ('tpprf', 'TPPRF sur produits de placements a revenu fixe', 'CGI art. 14', '44529',
    20.00, NULL, NULL, 'brut_ht', 30,
    'Taxe sur les produits de placements a revenu fixe (interets). A confirmer.')
) AS v(code, label, legal_ref, account_code, rate, threshold, rate_above, base, echeance, notes)
JOIN accounts a ON a.code = v.account_code
ON CONFLICT (code) DO NOTHING;
