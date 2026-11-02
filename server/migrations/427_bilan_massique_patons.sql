-- 427 — Bilan massique et pâtons par fournée (épic labo L3)
--
-- POURQUOI
--   production_rendement (mig 089) compte des PIÈCES (vers magasin/frigo) et des
--   pertes DÉCLARÉES par catégorie, mais pas les MASSES : impossible de mesurer la
--   freinte réelle (pâte pétrie → produit cuit) et de la comparer au standard du
--   format (poids_cru_g → poids_cuit_g, mig 199). La freinte reste une catégorie
--   saisie, pas une mesure (écart F5.4, P1).
--
-- QUOI
--   - production_rendement : masse pétrie, division en pâtons (nombre + poids
--     unitaire), masse cuite, et freinte réelle calculée (= (pétrie − cuite)/pétrie).
--   - recipe_formats.freinte_par_etape : ventilation STANDARD de la freinte par
--     type d'étape (JSONB [{etape, pct}]). Le total standard reste dérivé de
--     poids_cru_g/poids_cuit_g ; cette clé le répartit (cuisson, ressuage…).
--
-- INVERSION :
--   ALTER TABLE production_rendement DROP COLUMN masse_petrie_kg, patons_nombre,
--     patons_poids_unitaire_g, masse_cuite_kg, freinte_reelle_pct;
--   ALTER TABLE recipe_formats DROP COLUMN freinte_par_etape;

ALTER TABLE production_rendement
  ADD COLUMN IF NOT EXISTS masse_petrie_kg          NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS patons_nombre            INTEGER CHECK (patons_nombre IS NULL OR patons_nombre >= 0),
  ADD COLUMN IF NOT EXISTS patons_poids_unitaire_g  NUMERIC(10,2) CHECK (patons_poids_unitaire_g IS NULL OR patons_poids_unitaire_g >= 0),
  ADD COLUMN IF NOT EXISTS masse_cuite_kg           NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS freinte_reelle_pct       NUMERIC(6,2);

COMMENT ON COLUMN production_rendement.masse_petrie_kg IS
  'Masse de pâte pétrie engagée dans la fournée (kg), épic labo L3 (mig 427). Rappel : somme des pesées BSI.';
COMMENT ON COLUMN production_rendement.freinte_reelle_pct IS
  'Freinte réelle mesurée (%) = (masse_petrie - masse_cuite) / masse_petrie × 100 (mig 427).';

ALTER TABLE recipe_formats
  ADD COLUMN IF NOT EXISTS freinte_par_etape JSONB NOT NULL DEFAULT '[]';
COMMENT ON COLUMN recipe_formats.freinte_par_etape IS
  'Ventilation standard de la freinte par type d''étape : [{"etape":"cuisson","pct":15}] (mig 427). Total cohérent avec poids_cru_g→poids_cuit_g.';
