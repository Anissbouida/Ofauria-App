-- Migration 300 : traçabilité complète des lots (lot 3)
--
-- POURQUOI
--   1. production_lot_usage n'était alimentée que par l'ancien chemin sans bon de
--      sortie : la traçabilité « quels lots d'ingrédients dans cette production »
--      et le coût FIFO étaient vides pour tous les plans passés par un BSI.
--   2. Repeser une ligne écrasait les 8 champs de pesée : aucun historique.
--   3. Deux numérotations de lots produits sans lien (LOT-AAMMJJ-NNN par article
--      à la confirmation, LOT-YYYYMMDD-NNNNN par événement de production).
--   4. Les semi-finis n'avaient pas d'identité de lot : la chaîne ingrédient →
--      semi-fini → produit fini était coupée au milieu.
--
-- QUOI
--   1. production_lot_usage.bon_ligne_id / created_by : alimentée au prélèvement
--      (bon-sortie.repository consumeBonLines) et par FEFO sans BSI.
--   2. bsi_weighing_history + trigger : chaque modification de pesée d'une ligne.
--   3. product_lots.plan_item_id ; le numéro de lot produit reprend celui attribué
--      à l'article du plan (production_lot_numbers) — une seule numérotation.
--   4. semi_finished_lots + semi_finished_lot_usage : un lot par production de
--      semi-fini, consommé FEFO par les réservations des plans parents.
--   5. Index manquants relevés à l'audit (requêtes BSI et traçabilité).

-- ─── 1. Usage des lots d'ingrédients ───
ALTER TABLE production_lot_usage
  ADD COLUMN IF NOT EXISTS bon_ligne_id uuid REFERENCES production_bons_sortie_lignes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_production_lot_usage_plan ON production_lot_usage (production_plan_id);
CREATE INDEX IF NOT EXISTS idx_production_lot_usage_lot  ON production_lot_usage (ingredient_lot_id);

-- Reprise de l'existant : les prélèvements passés ont écrit inventory_transactions
-- avec le lot et le plan ; on en reconstruit l'usage pour que la traçabilité des
-- plans déjà produits ne reste pas vide. Idempotent (NOT EXISTS).
INSERT INTO production_lot_usage (production_plan_id, ingredient_lot_id, ingredient_id, quantity_used, created_by, created_at)
SELECT it.production_plan_id, it.ingredient_lot_id, it.ingredient_id, ABS(it.quantity_change), it.performed_by, it.created_at
  FROM inventory_transactions it
 WHERE it.type = 'production'
   AND it.ingredient_lot_id IS NOT NULL
   AND it.production_plan_id IS NOT NULL
   AND it.quantity_change < 0
   AND NOT EXISTS (
     SELECT 1 FROM production_lot_usage plu
      WHERE plu.production_plan_id = it.production_plan_id
        AND plu.ingredient_lot_id = it.ingredient_lot_id
        AND plu.ingredient_id = it.ingredient_id
   );

-- ─── 2. Historique des pesées ───
CREATE TABLE IF NOT EXISTS bsi_weighing_history (
  id                bigserial PRIMARY KEY,
  ligne_id          uuid NOT NULL REFERENCES production_bons_sortie_lignes(id) ON DELETE CASCADE,
  bon_id            uuid NOT NULL,
  ingredient_id     uuid,
  packaging_id      uuid,
  old_status        text,
  new_status        text,
  old_actual        numeric,
  new_actual        numeric,
  old_lot_id        uuid,
  new_lot_id        uuid,
  ecart_quantity    numeric,
  ecart_reason      text,
  tare_quantity     numeric,
  weighing_source   text,
  tolerance_applied numeric,
  changed_by        uuid REFERENCES users(id),
  changed_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bsi_weighing_history_ligne ON bsi_weighing_history (ligne_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_bsi_weighing_history_bon   ON bsi_weighing_history (bon_id);

CREATE OR REPLACE FUNCTION trg_fn_bsi_ligne_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO bsi_weighing_history
    (ligne_id, bon_id, ingredient_id, packaging_id, old_status, new_status, old_actual, new_actual,
     old_lot_id, new_lot_id, ecart_quantity, ecart_reason, tare_quantity, weighing_source, tolerance_applied, changed_by)
  VALUES
    (NEW.id, NEW.bon_id, NEW.ingredient_id, NEW.packaging_id, OLD.status, NEW.status, OLD.actual_quantity, NEW.actual_quantity,
     COALESCE(OLD.substitute_lot_id, OLD.ingredient_lot_id), COALESCE(NEW.substitute_lot_id, NEW.ingredient_lot_id),
     NEW.ecart_quantity, NEW.ecart_reason, NEW.tare_quantity, NEW.weighing_source, NEW.tolerance_applied,
     COALESCE(fn_production_current_actor(), NEW.weighed_by, NEW.transferred_by));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bsi_ligne_history ON production_bons_sortie_lignes;
CREATE TRIGGER trg_bsi_ligne_history
  AFTER UPDATE ON production_bons_sortie_lignes
  FOR EACH ROW
  WHEN (OLD.actual_quantity IS DISTINCT FROM NEW.actual_quantity
     OR OLD.status IS DISTINCT FROM NEW.status
     OR OLD.ecart_reason IS DISTINCT FROM NEW.ecart_reason
     OR OLD.substitute_lot_id IS DISTINCT FROM NEW.substitute_lot_id
     OR OLD.ingredient_lot_id IS DISTINCT FROM NEW.ingredient_lot_id
     OR OLD.tare_quantity IS DISTINCT FROM NEW.tare_quantity)
  EXECUTE FUNCTION trg_fn_bsi_ligne_history();

-- ─── 3. Lot produit lié à l'article du plan ───
ALTER TABLE product_lots
  ADD COLUMN IF NOT EXISTS plan_item_id uuid REFERENCES production_plan_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_product_lots_plan_item ON product_lots (plan_item_id) WHERE plan_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_production_lot_numbers_item ON production_lot_numbers (plan_item_id);

-- ─── 4. Lots de semi-finis ───
CREATE TABLE IF NOT EXISTS semi_finished_lots (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id          uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  store_id           uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  lot_number         varchar(40) NOT NULL,
  production_plan_id uuid REFERENCES production_plans(id) ON DELETE SET NULL,
  plan_item_id       uuid REFERENCES production_plan_items(id) ON DELETE SET NULL,
  quantity_produced  numeric(12,4) NOT NULL CHECK (quantity_produced >= 0),
  quantity_remaining numeric(12,4) NOT NULL CHECK (quantity_remaining >= 0),
  unit               varchar(20),
  produced_at        timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz,
  status             varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'depleted', 'expired', 'disposed')),
  created_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lot_number, store_id)
);
CREATE INDEX IF NOT EXISTS idx_semi_finished_lots_fefo ON semi_finished_lots (recipe_id, store_id, status, expires_at, produced_at);

CREATE TABLE IF NOT EXISTS semi_finished_lot_usage (
  id                   bigserial PRIMARY KEY,
  semi_finished_lot_id uuid NOT NULL REFERENCES semi_finished_lots(id) ON DELETE CASCADE,
  parent_plan_id       uuid NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  quantity             numeric(12,4) NOT NULL CHECK (quantity > 0),
  released_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_semi_finished_lot_usage_parent ON semi_finished_lot_usage (parent_plan_id) WHERE released_at IS NULL;

-- ─── 5. Index relevés à l'audit ───
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_plan ON inventory_transactions (production_plan_id) WHERE production_plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ingredient_lots_ing_store_status ON ingredient_lots (ingredient_id, store_id, status);
CREATE INDEX IF NOT EXISTS idx_bsi_lignes_bon_lot ON production_bons_sortie_lignes (bon_id, ingredient_lot_id);
CREATE INDEX IF NOT EXISTS idx_bsi_lignes_bon_eco_lot ON production_bons_sortie_lignes (bon_id, suggested_economat_lot_id);
CREATE INDEX IF NOT EXISTS idx_production_plans_store_date ON production_plans (store_id, plan_date);
