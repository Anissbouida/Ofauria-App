-- M4-06 — Co-produits déclarés : généralisation des sorties de coupe (mig 302/397).
--
-- Une sortie d'article a désormais un TYPE :
--   principal       la pièce de l'article (équivalence 1) ;
--   co_produit      un autre produit issu du même lot de fabrication, coût réparti
--                   au prorata des pièces équivalentes (cas de la coupe : entremets
--                   d'un cadre de tranches) ;
--   sous_produit / dechet_valorise
--                   produit secondaire valorisé à prix fixe : son montant vient en
--                   déduction du coût des sorties principales et co-produits ; il
--                   n'entre pas dans la quantité produite de l'article.
-- La fiche peut DÉCLARER ses sorties (recipe_outputs) : elles sont proposées à la
-- déclaration. Sans déclaration, la coupe se décide toujours dans l'ordre.

CREATE TABLE IF NOT EXISTS recipe_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  output_type VARCHAR(20) NOT NULL CHECK (output_type IN ('co_produit', 'sous_produit', 'dechet_valorise')),
  quantity_per_unit NUMERIC(12,4) CHECK (quantity_per_unit IS NULL OR quantity_per_unit > 0),
  equiv_pieces NUMERIC(8,3) CHECK (equiv_pieces IS NULL OR equiv_pieces > 0),
  fixed_unit_value NUMERIC(12,4) CHECK (fixed_unit_value IS NULL OR fixed_unit_value >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_recipe_outputs_key CHECK (
    (output_type = 'co_produit' AND equiv_pieces IS NOT NULL)
    OR (output_type <> 'co_produit' AND fixed_unit_value IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_recipe_outputs ON recipe_outputs (recipe_id, product_id, output_type);

ALTER TABLE production_item_outputs
  ADD COLUMN IF NOT EXISTS output_type VARCHAR(20) NOT NULL DEFAULT 'principal',
  ADD COLUMN IF NOT EXISTS fixed_unit_value NUMERIC(12,4);
DO $$ BEGIN
  ALTER TABLE production_item_outputs ADD CONSTRAINT chk_pio_output_type
    CHECK (output_type IN ('principal', 'co_produit', 'sous_produit', 'dechet_valorise'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Reprise : une sortie d'un autre produit que celui de l'article est un co-produit
-- (coupe : entremets prélevé dans un cadre de tranches). Libellé seulement, coût inchangé.
UPDATE production_item_outputs io SET output_type = 'co_produit'
  FROM production_plan_items ppi
 WHERE ppi.id = io.plan_item_id AND io.product_id IS DISTINCT FROM ppi.product_id AND io.output_type = 'principal';

-- Coût par sortie, clé de répartition = pièces équivalentes, déduction des sorties
-- valorisées à prix fixe. Sans sous-produit, identique à v_production_output_cost (397).
CREATE VIEW v_production_output_cost_v2 AS
WITH base AS (
  SELECT io.*, ppi.plan_id, v1.cost_per_equiv,
         SUM(CASE WHEN io.output_type IN ('principal', 'co_produit') THEN io.quantity * io.equiv_pieces ELSE 0 END)
           OVER (PARTITION BY io.plan_item_id) AS equiv_sum,
         SUM(CASE WHEN io.output_type IN ('sous_produit', 'dechet_valorise') THEN io.quantity * COALESCE(io.fixed_unit_value, 0) ELSE 0 END)
           OVER (PARTITION BY io.plan_item_id) AS fixed_deduction
    FROM production_item_outputs io
    JOIN production_plan_items ppi ON ppi.id = io.plan_item_id
    JOIN v_production_output_cost v1 ON v1.output_id = io.id
)
SELECT id AS output_id, plan_item_id, plan_id, product_id, label, output_type, quantity, equiv_pieces,
       CASE WHEN output_type IN ('principal', 'co_produit') THEN ROUND(quantity * equiv_pieces, 3) ELSE 0 END AS equiv_total,
       cost_per_equiv, fixed_deduction,
       CASE WHEN output_type IN ('principal', 'co_produit')
            THEN ROUND((cost_per_equiv * quantity * equiv_pieces - fixed_deduction * quantity * equiv_pieces / NULLIF(equiv_sum, 0)) / quantity, 4)
            ELSE fixed_unit_value END AS unit_cost,
       CASE WHEN output_type IN ('principal', 'co_produit')
            THEN ROUND(cost_per_equiv * quantity * equiv_pieces - fixed_deduction * quantity * equiv_pieces / NULLIF(equiv_sum, 0), 2)
            ELSE ROUND(quantity * COALESCE(fixed_unit_value, 0), 2) END AS cost_share
  FROM base;

COMMENT ON VIEW v_production_output_cost_v2 IS
  'M4-06 : coût par sortie d''article (principal, co-produit au prorata des pièces équivalentes, sous-produit / déchet valorisé à prix fixe déduit). Remplace v_production_output_cost (397).';
