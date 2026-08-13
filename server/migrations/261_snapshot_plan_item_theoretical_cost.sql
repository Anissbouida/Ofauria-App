-- Migration 261 : Snapshot du cout theorique au lancement du plan (audit A6b, P0)
--
-- POURQUOI
--   Les vues v_recipe_format_cost / v_recipe_total_cost sont LIVE : elles
--   recalculent en direct a chaque lecture. Or production-cout.calculateFor()
--   compare le cout REEL constate au cout prevu qu'il obtient de ces memes vues,
--   AU MOMENT du calcul. Si une recette a ete modifiee entre le lancement du
--   plan et le calcul du cout reel (nouveau fournisseur, changement de quantite,
--   ajout de composant), le « prevu » bouge -> l'ecart standard/reel n'a plus
--   de sens : on compare le reel d'hier au theorique d'aujourd'hui.
--
--   On fige donc, au moment du startItems() (transition pending -> in_progress),
--   3 chiffres unitaires par ligne de plan :
--     - theo_cout_matiere_u : cout matiere / piece produite (v_recipe_format_cost
--       si format renseigne, sinon v_recipe_total_cost / yield_quantity) ;
--     - theo_cout_complet_u : cout matiere + MO + energie + structure + emballage ;
--     - theo_prix_u         : prix de vente calcule (avec overrides).
--   theo_snapshot_at trace quand le snapshot a ete pose ; theo_source_view
--   dit d'ou il vient (utile pour l'audit et pour differencier « pas encore
--   snapshotte » de « snapshotte a zero »).
--
--   Les colonnes sont NULLABLES : les items existants (lances avant la
--   migration) restent NULL, production-cout leur applique le calcul live
--   par repli (comportement actuel). Le nouvel etat est utilise des le
--   prochain lancement.
--
-- PORTEE
--   ALTER TABLE production_plan_items : 4 colonnes. Aucune donnee modifiee.
--
-- INVERSION
--   ALTER TABLE production_plan_items
--     DROP COLUMN theo_cout_matiere_u, DROP COLUMN theo_cout_complet_u,
--     DROP COLUMN theo_prix_u, DROP COLUMN theo_snapshot_at, DROP COLUMN theo_source_view;

ALTER TABLE production_plan_items
  ADD COLUMN IF NOT EXISTS theo_cout_matiere_u NUMERIC(12,4),
  ADD COLUMN IF NOT EXISTS theo_cout_complet_u NUMERIC(12,4),
  ADD COLUMN IF NOT EXISTS theo_prix_u         NUMERIC(12,4),
  ADD COLUMN IF NOT EXISTS theo_snapshot_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS theo_source_view    VARCHAR(30);

COMMENT ON COLUMN production_plan_items.theo_cout_matiere_u IS
  'Cout matiere theorique par piece, fige au startItems (mig 261). NULL = pas encore snapshotte, l''appli repli sur le calcul live.';
COMMENT ON COLUMN production_plan_items.theo_cout_complet_u IS
  'Cout complet theorique par piece (matiere + MO + energie + structure + emballage), fige au startItems.';
COMMENT ON COLUMN production_plan_items.theo_prix_u IS
  'Prix de vente theorique par piece, fige au startItems (utilise pour comparer marge prevue / marge reelle).';
COMMENT ON COLUMN production_plan_items.theo_snapshot_at IS
  'Timestamp du snapshot (= started_at en principe, mais dissocie pour tracer les eventuels re-snapshots).';
COMMENT ON COLUMN production_plan_items.theo_source_view IS
  'Vue utilisee pour le snapshot : v_recipe_format_cost si format_id renseigne, sinon v_recipe_total_cost. Sert d''audit.';

CREATE INDEX IF NOT EXISTS idx_plan_items_theo_snapshotted
  ON production_plan_items(theo_snapshot_at)
  WHERE theo_snapshot_at IS NOT NULL;
