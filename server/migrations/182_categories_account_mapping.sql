-- Migration 182 : Mapping des categories de depenses/recettes vers le plan CGNC
--
-- POURQUOI
--   Pour generer une ecriture comptable a partir d'une facture, on a besoin
--   du compte de charge correspondant. Aujourd'hui les factures portent un
--   category_id (expense_categories) mais aucun lien vers le CGNC. On ajoute
--   ce lien et on backfille le mapping pour les top-level categories.
--
-- PORTEE
--   - ALTER TABLE expense_categories ADD COLUMN account_id (nullable)
--   - ALTER TABLE revenue_categories ADD COLUMN account_id (nullable)
--   - Backfill : mapping nom top-level -> compte CGNC
--   - Les sous-categories heritent du compte de leur parent (resolu a la
--     volee par le JournalGenerator via recursion sur parent_id)
--
-- NON-IMPACT
--   La colonne est nullable, AUCUN code existant ne lit cette colonne pour
--   le moment. Le generateur est branche derriere un feature flag.

ALTER TABLE expense_categories
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id);

ALTER TABLE revenue_categories
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id);

-- ============================================================================
-- Backfill : mapping top-level expense_categories -> CGNC
-- ============================================================================
-- Strategie : on mappe uniquement les top-level (parent_id IS NULL). Les enfants
-- heritent via parent_id lors de l'usage. La normalisation NULLIF/lower est juste
-- pour matcher de maniere robuste les accents (Énergie, Matières...).

UPDATE expense_categories ec SET account_id = a.id
FROM accounts a
WHERE ec.parent_id IS NULL
  AND ec.account_id IS NULL
  AND (
       (LOWER(ec.name) LIKE 'matieres%' OR LOWER(ec.name) LIKE 'matières%')  AND a.code = '61121'
    OR (LOWER(ec.name) LIKE 'emballages%')                                    AND a.code = '61221'
    OR (LOWER(ec.name) LIKE 'energie%' OR LOWER(ec.name) LIKE 'énergie%')    AND a.code = '6125'
    OR (LOWER(ec.name) LIKE 'loyer%')                                         AND a.code = '6131'
    OR (LOWER(ec.name) LIKE 'entretien%')                                     AND a.code = '6133'
    OR (LOWER(ec.name) LIKE 'transport%')                                     AND a.code = '6142'
    OR (LOWER(ec.name) LIKE 'frais admin%')                                   AND a.code = '6181'
    OR (LOWER(ec.name) LIKE 'charges de personnel%')                          AND a.code = '6171'
    OR (LOWER(ec.name) LIKE 'equipements%' OR LOWER(ec.name) LIKE 'équipements%') AND a.code = '6181'
    OR (LOWER(ec.name) LIKE 'divers%')                                        AND a.code = '6181'
  );

-- ============================================================================
-- Backfill : mapping top-level revenue_categories -> CGNC
-- ============================================================================
UPDATE revenue_categories rc SET account_id = a.id
FROM accounts a
WHERE rc.parent_id IS NULL
  AND rc.account_id IS NULL
  AND (
       (LOWER(rc.name) LIKE 'ventes directes%')   AND a.code = '7111'
    OR (LOWER(rc.name) LIKE 'commandes%')          AND a.code = '7121'
    OR (LOWER(rc.name) LIKE 'autres revenus%')     AND a.code = '7585'
  );

COMMENT ON COLUMN expense_categories.account_id IS
  'Compte CGNC associe a cette categorie. Les enfants heritent via parent_id (resolu a la volee).';
COMMENT ON COLUMN revenue_categories.account_id IS
  'Compte CGNC associe a cette categorie. Les enfants heritent via parent_id.';
