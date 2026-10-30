-- 403 — Réglages de production centralisés (Production, roadmap lot 9)
--
-- Deux réglages jusqu'ici codés en dur / absents, regroupés avec les flags et le
-- markup existants dans un écran « Paramétrage » du module Production :
--   - production_charges_fixes_pct : taux forfaitaire de charges fixes appliqué au
--     coût matière dans le coût de revient (mig 090). Était CODÉ EN DUR à 0,40
--     (TAUX_CHARGES_FIXES_ESTIME) ; devient paramétrable sans redéploiement.
--   - production_overproduction_pct : tolérance de surproduction (en %). 0 = pas de
--     contrôle. Au-delà de planifié × (1 + pct/100), la production émet un avertissement.
--
-- Les autres réglages (flags étapes/rendement/coût, markup) existent déjà sur
-- company_settings ; l'écran les regroupe simplement.
--
-- INVERSION :
--   ALTER TABLE company_settings
--     DROP COLUMN IF EXISTS production_overproduction_pct,
--     DROP COLUMN IF EXISTS production_charges_fixes_pct;

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS production_charges_fixes_pct  NUMERIC(5,4) NOT NULL DEFAULT 0.40
    CHECK (production_charges_fixes_pct >= 0),
  ADD COLUMN IF NOT EXISTS production_overproduction_pct NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (production_overproduction_pct >= 0);

COMMENT ON COLUMN company_settings.production_charges_fixes_pct IS
  'Taux de charges fixes (fraction du coût matière) dans le coût de revient (mig 403).';
COMMENT ON COLUMN company_settings.production_overproduction_pct IS
  'Tolérance de surproduction en % ; 0 = aucun contrôle (mig 403).';
