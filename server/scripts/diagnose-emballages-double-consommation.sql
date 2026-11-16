-- G0-22 (plan d'action 2026-11) — emballages consommés deux fois : rapport de rattrapage.
--
-- CONTEXTE
--   Avant le correctif, la déclaration de production (produceItems) consommait les
--   emballages d'une recette dans deux blocs successifs. Le premier écrivait un
--   mouvement noté « Production: <produit> x<quantité> », le second un mouvement
--   identique noté « Production partielle: <produit> x<quantité> ». Seuls les plans
--   SANS bon de sortie étaient touchés (produit assemblé sans matière propre) : avec un
--   bon de sortie, les emballages sortent au prélèvement et ces blocs sont sautés.
--
-- LECTURE SEULE. Ce script n'écrit rien. La sur-consommation est le mouvement
-- « Production partielle: » qui double un mouvement « Production: » du même plan, du
-- même emballage et du même libellé. L'ajustement correctif (ré-entrée de stock motivée)
-- ne se passe qu'après accord du gérant, article par article.
--
-- USAGE : psql "$DATABASE_URL" -f scripts/diagnose-emballages-double-consommation.sql

\echo '═══ Mouvements d''emballage en double, par plan ═══'
WITH doubles AS (
  SELECT t2.id, t2.packaging_id, t2.store_id, t2.reference_id AS plan_id, t2.created_at,
         -t2.quantity_change AS qty, COALESCE(t2.unit_cost, 0) AS unit_cost, t2.note
    FROM packaging_stock_transactions t2
   WHERE t2.type = 'consumption' AND t2.reference_type = 'production_plan'
     AND t2.note LIKE 'Production partielle: %'
     AND EXISTS (
       SELECT 1 FROM packaging_stock_transactions t1
        WHERE t1.type = 'consumption' AND t1.reference_type = 'production_plan'
          AND t1.reference_id = t2.reference_id AND t1.packaging_id = t2.packaging_id
          AND t1.note = 'Production: ' || substr(t2.note, length('Production partielle: ') + 1)
          AND t1.quantity_change = t2.quantity_change)
)
SELECT pp.plan_date, d.plan_id, pi.name AS emballage, d.qty AS sur_consommation, pi.unit,
       ROUND(d.qty * d.unit_cost, 2) AS valeur_dh, d.note
  FROM doubles d
  JOIN packaging_items pi ON pi.id = d.packaging_id
  LEFT JOIN production_plans pp ON pp.id = d.plan_id
 ORDER BY pp.plan_date, pi.name;

\echo '═══ Sur-consommation par emballage (quantité à ré-entrer en stock, après accord) ═══'
WITH doubles AS (
  SELECT t2.packaging_id, t2.store_id, -t2.quantity_change AS qty, COALESCE(t2.unit_cost, 0) AS unit_cost
    FROM packaging_stock_transactions t2
   WHERE t2.type = 'consumption' AND t2.reference_type = 'production_plan'
     AND t2.note LIKE 'Production partielle: %'
     AND EXISTS (
       SELECT 1 FROM packaging_stock_transactions t1
        WHERE t1.type = 'consumption' AND t1.reference_type = 'production_plan'
          AND t1.reference_id = t2.reference_id AND t1.packaging_id = t2.packaging_id
          AND t1.note = 'Production: ' || substr(t2.note, length('Production partielle: ') + 1)
          AND t1.quantity_change = t2.quantity_change)
)
SELECT pi.name AS emballage, pi.unit, COUNT(*) AS mouvements, SUM(d.qty) AS sur_consommation,
       ROUND(SUM(d.qty * d.unit_cost), 2) AS valeur_dh,
       (SELECT stock_quantity FROM packaging_store_stock s WHERE s.packaging_id = d.packaging_id AND s.store_id = d.store_id) AS stock_actuel
  FROM doubles d JOIN packaging_items pi ON pi.id = d.packaging_id
 GROUP BY pi.name, pi.unit, d.packaging_id, d.store_id
 ORDER BY valeur_dh DESC;

\echo '═══ Total ═══'
SELECT COUNT(*) AS mouvements_en_double, COALESCE(SUM(-t2.quantity_change), 0) AS quantite,
       COALESCE(ROUND(SUM(-t2.quantity_change * COALESCE(t2.unit_cost, 0)), 2), 0) AS valeur_dh
  FROM packaging_stock_transactions t2
 WHERE t2.type = 'consumption' AND t2.reference_type = 'production_plan'
   AND t2.note LIKE 'Production partielle: %'
   AND EXISTS (
     SELECT 1 FROM packaging_stock_transactions t1
      WHERE t1.type = 'consumption' AND t1.reference_type = 'production_plan'
        AND t1.reference_id = t2.reference_id AND t1.packaging_id = t2.packaging_id
        AND t1.note = 'Production: ' || substr(t2.note, length('Production partielle: ') + 1)
        AND t1.quantity_change = t2.quantity_change);
