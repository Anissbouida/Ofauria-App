-- 397 — Allocation du coût de revient aux sorties de coupe (Production, roadmap lot 2)
--
-- Les sorties d'un même cadre (mig 302 : production_item_outputs — tranches,
-- entremets…) portaient une quantité et une équivalence en pièces, mais AUCUN
-- coût : impossible de connaître le coût de revient d'une tranche vs d'un
-- entremets issus du même cadre.
--
-- MODÈLE (rappel mig 302) :
--   - equiv_pieces = équivalence PAR UNITÉ de la sortie (base = 1, un entremets = 8).
--   - actual_quantity de l'article = Σ (quantity × equiv_pieces)  [pièces équivalentes].
--   - theo_cout_complet_u (mig 261) = coût de revient complet PAR PIÈCE ÉQUIVALENTE.
--
-- ALLOCATION (exacte, au prorata des pièces équivalentes) :
--   unit_cost  = coût_par_équiv × equiv_pieces              (par unité physique de la sortie)
--   cost_share = coût_par_équiv × quantity × equiv_pieces   (coût total alloué à la sortie)
--   => Σ cost_share sur les sorties = coût théorique complet de l'article.
--
-- Coût par pièce équivalente = snapshot theo_cout_complet_u (mig 261) ; repli sur
-- le coût recette / rendement (v_recipe_total_cost) quand le snapshot est absent,
-- comme le panneau de coût de revient. NULL si ni l'un ni l'autre (rien d'inventé).
--
-- Choix : une VUE (pas de colonnes persistées). Le coût de base est déjà figé au
-- moment de la confirmation (snapshot mig 261), donc la vue est de fait stable,
-- sans write-path ni backfill, et toujours cohérente avec le coût de revient.
--
-- INVERSION : DROP VIEW IF EXISTS v_production_output_cost;

CREATE OR REPLACE VIEW v_production_output_cost AS
SELECT
  io.id                                                            AS output_id,
  io.plan_item_id,
  ppi.plan_id,
  io.product_id,
  io.label,
  io.quantity,
  io.equiv_pieces,
  ROUND(io.quantity * io.equiv_pieces, 3)                          AS equiv_total,
  cpe.cost_per_equiv,
  ROUND(cpe.cost_per_equiv * io.equiv_pieces, 4)                   AS unit_cost,
  ROUND(cpe.cost_per_equiv * io.quantity * io.equiv_pieces, 2)     AS cost_share
FROM production_item_outputs io
JOIN production_plan_items ppi ON ppi.id = io.plan_item_id
LEFT JOIN LATERAL (
  -- Coût de revient complet par pièce équivalente : snapshot sinon coût recette / rendement.
  SELECT COALESCE(
    ppi.theo_cout_complet_u,
    (SELECT vtc.total_cost / NULLIF(r.yield_quantity, 0)
       FROM recipes r
       JOIN v_recipe_total_cost vtc ON vtc.id = r.id
      WHERE r.product_id = ppi.product_id AND r.yield_quantity > 0
      ORDER BY r.id
      LIMIT 1)
  ) AS cost_per_equiv
) cpe ON true;

COMMENT ON VIEW v_production_output_cost IS
  'Coût de revient théorique alloué à chaque sortie de coupe (mig 302) au prorata des pièces équivalentes (roadmap production lot 2).';
