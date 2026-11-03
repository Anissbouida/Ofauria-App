-- Migration 458 : notation multi-critères des devis (demande de prix)
--
-- POURQUOI
--   Le module « appel d'offres » (mig 360, renommé « demande de prix ») retenait
--   le devis le MOINS CHER. Le client veut une NOTATION multi-critères :
--   prix + qualité + note du fournisseur, pondérés, pour recommander le devis à
--   retenir (l'acheteur reste libre d'attribuer un autre devis).
--
-- MODÈLE
--   - prix       : calculé automatiquement (le moins cher = 100, les autres au
--                  prorata inverse du total HT).
--   - qualité    : note MANUELLE saisie par l'acheteur sur chaque devis
--                  (supplier_quotations.quality_score, 0 à 100) — appréciation de
--                  la qualité de l'offre / du produit proposé.
--   - fournisseur: dernière note d'évaluation du fournisseur (mig 362,
--                  supplier_score_snapshots.score) ; 50 par défaut si non évalué.
--   Pondérations : paramètre global purchasing.rfq_scoring (module_parameters),
--   réglable dans Paramètres › Achats (défaut prix 50 / qualité 25 / fournisseur 25).
--   Le score pondéré et le devis recommandé sont calculés à l'affichage
--   (rfq.repository.findById) ; rien n'est figé ici hormis la note qualité saisie.
--
-- INVERSION
--   ALTER TABLE supplier_quotations DROP COLUMN quality_score ;
--   DELETE FROM module_parameters WHERE key = 'purchasing.rfq_scoring'.

ALTER TABLE supplier_quotations
  ADD COLUMN IF NOT EXISTS quality_score NUMERIC(5,1)
    CHECK (quality_score IS NULL OR (quality_score >= 0 AND quality_score <= 100));

COMMENT ON COLUMN supplier_quotations.quality_score IS
  'Note qualité de l''offre (0-100), saisie par l''acheteur, critère de la notation multi-critères (mig 458). NULL = non notée (traitée comme neutre à l''affichage).';
