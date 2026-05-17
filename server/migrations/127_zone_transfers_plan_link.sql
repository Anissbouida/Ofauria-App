-- Migration 127 : lien direct plan_production_id sur ingredient_stock_zone_transfers
--
-- Contexte (cf. prompt_delta_production_v1.docx, point 4) :
-- Le spec demande "plan_production_id : FK obligatoire. Lien obligatoire. Transfert
-- non enregistre sans plan lie."
-- Aujourd'hui le lien existe indirectement via bon_sortie_id -> plan_id, mais
-- bon_sortie_id est NULLable (ON DELETE SET NULL) et l'agregation cote reporting
-- est lourde. On ajoute donc une colonne explicite plan_production_id, on backfille
-- depuis le BSI lie.
--
-- IMPORTANT : la contrainte NOT NULL n'est PAS posee dans cette migration pour
-- permettre une coexistence ancien-code / nouveau-code pendant un deploiement
-- progressif (zero downtime). Une fois tous les serveurs deployes avec le nouveau
-- code qui remplit la colonne, une migration ulterieure pourra ajouter NOT NULL.
--
-- Compatibilite : bon_sortie_id et bon_sortie_ligne_id sont conserves pour la
-- tracabilite ligne par ligne.

-- Etape 1 : colonne nullable + index
ALTER TABLE ingredient_stock_zone_transfers
  ADD COLUMN IF NOT EXISTS plan_production_id uuid REFERENCES production_plans(id);

CREATE INDEX IF NOT EXISTS idx_zone_transfers_plan
  ON ingredient_stock_zone_transfers(plan_production_id, transferred_at DESC);

-- Etape 2 : backfill depuis bon_sortie_id
UPDATE ingredient_stock_zone_transfers ist
   SET plan_production_id = bs.plan_id
  FROM production_bons_sortie bs
 WHERE ist.bon_sortie_id = bs.id
   AND ist.plan_production_id IS NULL;

COMMENT ON COLUMN ingredient_stock_zone_transfers.plan_production_id IS
  'FK vers le plan de production a l''origine du transfert (delta v1 point 4). Nullable pour zero downtime ; sera NOT NULL apres deploiement complet.';
