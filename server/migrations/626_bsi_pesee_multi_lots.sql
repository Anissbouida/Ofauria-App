-- 626 — Bons de sortie : pesée d'une ligne sur plusieurs lots (scénario 2, constat 142).
--
-- POURQUOI
--   Une ligne de bon ne puisait que dans UN lot. Quand le lot proposé ne couvrait pas la
--   quantité pesée (fond de sac, lot entamé, réappro dans un lot neuf), la pesée était
--   refusée « le lot … ne couvre pas la pesée » (plus de 400 refus sur six mois : fraises,
--   crème, farines, levure), alors que le stock existait sur les lots suivants. Suite du
--   constat F-073 (février), qui n'avait traité que la génération du bon.
--
-- CE QUI CHANGE
--   Nouvelle table production_bons_sortie_ligne_lots : pour chaque ligne pesée, la quantité
--   prise sur chaque lot (complément FEFO sur les lots valides suivants, contenants ouverts
--   au besoin). La somme des quantités d'une ligne = sa quantité pesée. Réécrite à chaque
--   (re)pesée ; lue à la remise du bon pour décrémenter CHAQUE lot et alimenter
--   production_lot_usage (traçabilité / rappel de lot). La ligne garde son lot principal
--   dans ingredient_lot_id. Les lignes pesées avant cette migration n'ont pas de détail :
--   elles restent consommées sur leur lot unique, comme avant.
--
-- INVERSION
--   DROP TABLE production_bons_sortie_ligne_lots; (les lignes pesées sur plusieurs lots et
--   pas encore remises seraient alors consommées sur leur seul lot principal).

CREATE TABLE IF NOT EXISTS production_bons_sortie_ligne_lots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ligne_id          uuid NOT NULL REFERENCES production_bons_sortie_lignes(id) ON DELETE CASCADE,
  ingredient_lot_id uuid NOT NULL REFERENCES ingredient_lots(id) ON DELETE CASCADE,
  quantity          numeric(12,4) NOT NULL CHECK (quantity > 0),
  opened_quantity   numeric(12,4) NOT NULL DEFAULT 0 CHECK (opened_quantity >= 0),
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (ligne_id, ingredient_lot_id)
);

CREATE INDEX IF NOT EXISTS idx_bsi_ligne_lots_lot ON production_bons_sortie_ligne_lots (ingredient_lot_id);

COMMENT ON TABLE production_bons_sortie_ligne_lots IS
  'Lots réellement pesés pour une ligne de bon de sortie (pesée multi-lots FEFO, mig 626). Somme = actual_quantity de la ligne.';
COMMENT ON COLUMN production_bons_sortie_ligne_lots.opened_quantity IS
  'Quantité ouverte (économat -> pesage) sur ce lot au moment de la pesée ; le reliquat reste au pesage.';
