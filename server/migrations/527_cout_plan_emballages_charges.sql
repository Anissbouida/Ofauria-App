-- G0-23 (plan d'action 2026-11) — coût de revient d'un plan : une seule définition.
--
-- 1. Les emballages consommés par un plan entrent dans son coût (ils étaient sortis
--    du stock mais absents du coût de revient).
-- 2. cout_total, colonne calculée, devient LA définition du coût de revient :
--    matières + emballages + main-d'œuvre + énergie + charges. Le tableau de bord
--    additionnait lui-même les termes et oubliait l'énergie.
-- 3. Les charges mensuelles saisies (loyer, énergie, autres) peuvent enfin être
--    réparties sur les plans du mois. Le mode reste « taux sur les matières » tant
--    que le gérant ne choisit pas « charges mensuelles » : aucun chiffre ne change
--    sans décision.
ALTER TABLE production_cout_reel ADD COLUMN IF NOT EXISTS cout_emballages   numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE production_cout_reel ADD COLUMN IF NOT EXISTS detail_emballages jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Une colonne calculée ne se modifie pas : elle est recréée (aucune vue n'en dépend).
ALTER TABLE production_cout_reel DROP COLUMN IF EXISTS cout_total;
ALTER TABLE production_cout_reel ADD COLUMN cout_total numeric(12,2)
  GENERATED ALWAYS AS (cout_matieres + cout_emballages + cout_main_oeuvre + cout_energie + COALESCE(cout_charges_fixes, 0)) STORED;

ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS production_charges_method varchar(10) NOT NULL DEFAULT 'rate';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_company_settings_charges_method') THEN
    ALTER TABLE company_settings ADD CONSTRAINT chk_company_settings_charges_method
      CHECK (production_charges_method IN ('rate', 'monthly'));
  END IF;
END $$;
COMMENT ON COLUMN company_settings.production_charges_method IS
  'Charges indirectes d''un plan : rate = taux × matières (production_charges_fixes_pct) ; monthly = charges mensuelles saisies, réparties au prorata des matières des plans du mois. G0-23';
