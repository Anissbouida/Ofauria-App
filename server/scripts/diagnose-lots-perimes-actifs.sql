-- G1-10 (plan d'action 2026-11) — lots de produits finis périmés mais encore « actifs ».
--
-- CONTEXTE
--   La péremption automatique des lots (DLC ou DLV dépassée) échouait à chaque appel
--   depuis le correctif de valorisation des pertes : sa requête était invalide et
--   l'erreur était avalée. Les lots périmés sont donc restés « actifs », avec leur
--   quantité toujours comptée dans le stock du magasin et de la vitrine.
--
--   La tâche planifiée `lots_expire`, une fois activée, les sortira TOUS à sa première
--   exécution : perte enregistrée au coût matière, stock du magasin diminué.
--
-- LECTURE SEULE. Ce script n'écrit rien. Il chiffre ce que la première exécution fera,
-- pour décider avant d'activer la tâche (Paramètres › Tâches planifiées).
--
-- USAGE : psql "$DATABASE_URL" -f scripts/diagnose-lots-perimes-actifs.sql

\echo '═══ Lots périmés encore actifs, par magasin ═══'
SELECT COALESCE(s.name, '(sans magasin)') AS magasin, COUNT(*) AS lots,
       SUM(pl.backroom_qty) AS en_reserve, SUM(pl.vitrine_qty) AS en_vitrine,
       ROUND(SUM((pl.backroom_qty + pl.vitrine_qty) * COALESCE(v.unit_cost, p.cost_price, 0)), 2) AS valeur_dh,
       MIN(COALESCE(pl.expires_at, pl.display_expires_at::date)) AS plus_ancienne_echeance
  FROM product_lots pl
  JOIN products p ON p.id = pl.product_id
  LEFT JOIN stores s ON s.id = pl.store_id
  LEFT JOIN v_product_unit_cost v ON v.product_id = pl.product_id
 WHERE pl.status = 'active' AND (pl.backroom_qty + pl.vitrine_qty) > 0
   AND ((pl.expires_at IS NOT NULL AND pl.expires_at <= CURRENT_DATE)
     OR (pl.display_expires_at IS NOT NULL AND pl.display_expires_at <= NOW()))
 GROUP BY s.name ORDER BY valeur_dh DESC;

\echo '═══ Détail par produit ═══'
SELECT p.name AS produit, COUNT(*) AS lots, SUM(pl.backroom_qty + pl.vitrine_qty) AS quantite,
       ROUND(SUM((pl.backroom_qty + pl.vitrine_qty) * COALESCE(v.unit_cost, p.cost_price, 0)), 2) AS valeur_dh,
       MIN(COALESCE(pl.expires_at, pl.display_expires_at::date)) AS plus_ancienne_echeance
  FROM product_lots pl
  JOIN products p ON p.id = pl.product_id
  LEFT JOIN v_product_unit_cost v ON v.product_id = pl.product_id
 WHERE pl.status = 'active' AND (pl.backroom_qty + pl.vitrine_qty) > 0
   AND ((pl.expires_at IS NOT NULL AND pl.expires_at <= CURRENT_DATE)
     OR (pl.display_expires_at IS NOT NULL AND pl.display_expires_at <= NOW()))
 GROUP BY p.name ORDER BY valeur_dh DESC LIMIT 100;

\echo '═══ Total ═══'
SELECT COUNT(*) AS lots, COALESCE(SUM(pl.backroom_qty + pl.vitrine_qty), 0) AS quantite,
       COALESCE(ROUND(SUM((pl.backroom_qty + pl.vitrine_qty) * COALESCE(v.unit_cost, p.cost_price, 0)), 2), 0) AS valeur_dh
  FROM product_lots pl
  JOIN products p ON p.id = pl.product_id
  LEFT JOIN v_product_unit_cost v ON v.product_id = pl.product_id
 WHERE pl.status = 'active' AND (pl.backroom_qty + pl.vitrine_qty) > 0
   AND ((pl.expires_at IS NOT NULL AND pl.expires_at <= CURRENT_DATE)
     OR (pl.display_expires_at IS NOT NULL AND pl.display_expires_at <= NOW()));
