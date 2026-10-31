-- 406 — Santé des prix d'ingrédients (Achats, lot prix P5 — hygiène)
--
-- Remonte les anomalies de prix catalogue (`ingredients.unit_cost`, le CMUP) pour
-- correction manuelle : prix manquant (0), et surtout écart fort entre le coût
-- catalogue et le coût réel des lots en stock — qui trahit une erreur d'unité /
-- de conditionnement (ex. « Mangue » à 40 DH alors que les lots valent 0,04 DH :
-- facteur 1000). Diagnostic uniquement : aucune correction automatique (la bonne
-- valeur dépend de l'unité voulue, non devinable).
--
-- INVERSION : DROP VIEW IF EXISTS v_ingredient_price_health;

CREATE OR REPLACE VIEW v_ingredient_price_health AS
WITH lots AS (
  SELECT ingredient_id,
         SUM(quantity_remaining)                                              AS qty,
         SUM(quantity_remaining * unit_cost) FILTER (WHERE unit_cost::text <> 'NaN') AS val
  FROM ingredient_lots
  WHERE quantity_remaining > 0
  GROUP BY ingredient_id
)
SELECT
  i.id                                                        AS ingredient_id,
  i.name,
  i.unit,
  i.unit_cost                                                 AS catalogue_cost,
  CASE WHEN l.qty > 0 AND l.val IS NOT NULL THEN ROUND(l.val / l.qty, 4) END AS lot_avg_cost,
  ROUND(COALESCE(l.qty, 0), 3)                                AS lot_qty,
  ROUND(COALESCE(l.val, 0), 2)                                AS lot_value,
  ROUND(COALESCE(l.qty, 0) * COALESCE(i.unit_cost, 0), 2)     AS catalogue_value,
  ROUND(COALESCE(l.qty, 0) * COALESCE(i.unit_cost, 0) - COALESCE(l.val, 0), 2) AS value_gap,
  CASE
    WHEN i.unit_cost IS NULL OR i.unit_cost::text = 'NaN' OR i.unit_cost = 0 THEN 'prix_manquant'
    WHEN l.qty > 0 AND l.val > 0 AND abs(i.unit_cost - l.val / l.qty) / (l.val / l.qty) > 0.30 THEN 'ecart_prix'
    ELSE 'ok'
  END AS flag,
  CASE WHEN l.qty > 0 AND l.val > 0 AND i.unit_cost::text <> 'NaN'
       THEN ROUND((i.unit_cost - l.val / l.qty) / (l.val / l.qty) * 100, 0) END AS divergence_pct,
  EXISTS (SELECT 1 FROM recipe_ingredients ri WHERE ri.ingredient_id = i.id)
    OR EXISTS (SELECT 1 FROM recipe_components rc WHERE rc.source_ingredient_id = i.id) AS used_in_recipe
FROM ingredients i
LEFT JOIN lots l ON l.ingredient_id = i.id;

COMMENT ON VIEW v_ingredient_price_health IS
  'Santé des prix d''ingrédients : prix manquant / écart catalogue↔lots pour correction (mig 406, Achats lot prix P5).';
