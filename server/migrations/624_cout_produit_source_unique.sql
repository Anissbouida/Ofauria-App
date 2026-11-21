-- 624 — Coût matière d'un produit : source unique fn_recipe_cost (scénario 1, constat 115).
--
-- POURQUOI
--   v_product_unit_cost (mig 317) lisait le coût matière dans v_recipe_format_cost, l'ancien
--   calcul au prorata du poids que la mig 409 a remplacé par fn_recipe_cost (« coût unitaire
--   unique »). Pour une fiche composée de préparations de base, ce prorata s'effondre :
--   croissant 0,04 DH au lieu de 1,76 DH, pain au chocolat 0,09 au lieu de 3,41, éclair 0,14
--   au lieu de 4,25, pizza 0,14 au lieu de 4,17. Or cette vue valorise les marges de gestion,
--   le coût des ventes à la clôture, les pertes et les invendus.
--   Un format vendu au kilo (cornes de gazelle) recevait aussi un coût à la pièce (2,59 DH)
--   face à un prix au kilo ; fn_recipe_cost rend le coût au kilo (77,55 DH).
--
-- CE QUI CHANGE
--   Branche « format » : matière unitaire de fn_recipe_cost (recette, format) pour le format
--   par défaut du produit (format attribué au produit, sinon format par défaut de sa fiche),
--   fiches actives d'abord. Branches « recette » et « fiche_produit » inchangées.
--   Colonnes identiques (product_id, unit_cost, cost_source).
--
-- INVERSION
--   Rejouer la définition de la mig 452 (branche fmt sur v_recipe_format_cost.cout_matiere_unitaire).

CREATE OR REPLACE VIEW v_product_unit_cost AS
WITH fmt AS (
  SELECT DISTINCT ON (COALESCE(rf.product_id, r.product_id))
         COALESCE(rf.product_id, r.product_id) AS product_id,
         fc.matiere_u AS cost
    FROM recipes r
    JOIN recipe_formats rf ON rf.recipe_id = r.id AND rf.is_active
    CROSS JOIN LATERAL fn_recipe_cost(r.id, rf.id) fc
   WHERE COALESCE(rf.product_id, r.product_id) IS NOT NULL
     AND fc.matiere_u > 0
   ORDER BY COALESCE(rf.product_id, r.product_id), r.archived_at NULLS FIRST, rf.is_default DESC NULLS LAST, rf.ordre
), rec AS (
  SELECT DISTINCT ON (r.product_id) r.product_id,
         t.total_cost / NULLIF(r.yield_quantity, 0::numeric) AS cost
    FROM v_recipe_total_cost t
    JOIN recipes r ON r.id = t.id
   WHERE t.total_cost > 0::numeric AND r.product_id IS NOT NULL
   ORDER BY r.product_id, r.archived_at NULLS FIRST
), manual AS (
  SELECT products.id AS product_id, products.cost_price AS cost
    FROM products
   WHERE products.cost_price > 0::numeric
     AND (products.price IS NULL OR products.price = 0::numeric OR products.cost_price < products.price)
)
SELECT p.id AS product_id,
       COALESCE(f.cost, rc.cost, m.cost) AS unit_cost,
       CASE
         WHEN f.cost IS NOT NULL THEN 'format'::text
         WHEN rc.cost IS NOT NULL THEN 'recette'::text
         WHEN m.cost IS NOT NULL THEN 'fiche_produit'::text
         ELSE NULL::text
       END AS cost_source
  FROM products p
  LEFT JOIN manual m ON m.product_id = p.id
  LEFT JOIN fmt f ON f.product_id = p.id
  LEFT JOIN rec rc ON rc.product_id = p.id;

COMMENT ON VIEW v_product_unit_cost IS
  'Coût matière unitaire d''un produit (mig 624) : fn_recipe_cost du format par défaut, sinon coût recette, sinon coût saisi sur la fiche produit.';
