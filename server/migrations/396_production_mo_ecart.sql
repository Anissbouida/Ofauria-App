-- 396 — Écart de main-d'œuvre standard ↔ réel (Production, roadmap lot 1)
--
-- Branche les gammes/postes (mig 388, coût standard autonome) sur le flux de
-- production réel (étapes mig 089, coût réel mig 090) pour produire un écart de
-- main-d'œuvre PRÉVU (gamme) vs RÉEL (temps passé sur les étapes), comme l'écart
-- de mix matière existe déjà (mig 268).
--
-- Trois apports :
--   1) production_plan_items.routing_id : gamme explicitement rattachée à l'item
--      de plan (optionnel ; à défaut, la vue retombe sur la gamme active du produit).
--   2) work_centers.equipement_id : articulation poste de travail (coût MO, mig 388)
--      ↔ équipement (coût énergie, mig 090). Les deux rôles restent distincts.
--   3) v_production_mo_ecart : par item de plan, minutes/coût STANDARD (gamme) vs
--      minutes/coût RÉEL (étapes complétées), et l'écart. Gamme optionnelle : si
--      aucune gamme ne s'applique, les colonnes standard sont NULL (pas d'écart).
--
-- La base RÉELLE reproduit EXACTEMENT le calcul MO de production-cout.repository.ts
-- (étapes status='completed', duree_reelle_min, taux = hourly_rate sinon
-- monthly_salary/191), pour rester cohérent avec le coût réel affiché.
--
-- INVERSION :
--   DROP VIEW IF EXISTS v_production_mo_ecart;
--   ALTER TABLE work_centers DROP COLUMN IF EXISTS equipement_id;
--   ALTER TABLE production_plan_items DROP COLUMN IF EXISTS routing_id;

ALTER TABLE production_plan_items
  ADD COLUMN IF NOT EXISTS routing_id UUID REFERENCES routings(id) ON DELETE SET NULL;

ALTER TABLE work_centers
  ADD COLUMN IF NOT EXISTS equipement_id UUID REFERENCES production_equipements(id) ON DELETE SET NULL;

COMMENT ON COLUMN production_plan_items.routing_id IS
  'Gamme de production (mig 388) rattachée à cet item. NULL = gamme active du produit (fallback de v_production_mo_ecart).';
COMMENT ON COLUMN work_centers.equipement_id IS
  'Équipement (mig 090) associé au poste : articule coût MO (poste) et coût énergie (équipement).';

CREATE OR REPLACE VIEW v_production_mo_ecart AS
WITH routing_std AS (
  -- Coût MO standard d'une gamme = Σ (durée opération × coût horaire du poste).
  SELECT ro.routing_id,
         SUM(ro.duration_min)                                                      AS std_minutes,
         SUM(ro.duration_min::numeric / 60 * COALESCE(wc.hourly_cost, 0))          AS std_cost
  FROM routing_operations ro
  LEFT JOIN work_centers wc ON wc.id = ro.work_center_id
  GROUP BY ro.routing_id
),
item_routing AS (
  -- Gamme applicable : explicite sur l'item, sinon gamme active la plus récente du produit.
  SELECT ppi.id         AS plan_item_id,
         ppi.plan_id,
         ppi.product_id,
         COALESCE(
           ppi.routing_id,
           (SELECT r.id FROM routings r
             WHERE r.product_id = ppi.product_id AND r.is_active
             ORDER BY r.created_at DESC
             LIMIT 1)
         ) AS routing_id
  FROM production_plan_items ppi
),
reel AS (
  -- Coût MO réel = Σ (durée réelle d'étape complétée × taux horaire de l'exécutant).
  -- Taux : hourly_rate sinon monthly_salary/191 (norme 44 h/sem), comme le coût réel.
  SELECT pie.plan_item_id,
         SUM(pie.duree_reelle_min)                                                                     AS reel_minutes,
         SUM(pie.duree_reelle_min::numeric / 60
             * COALESCE(e.hourly_rate, ROUND(e.monthly_salary / 191.0, 2), 0))                          AS reel_cost
  FROM production_item_etapes pie
  JOIN users u     ON u.id = pie.completed_by
  JOIN employees e ON e.user_id = u.id
  WHERE pie.status = 'completed'
    AND pie.duree_reelle_min IS NOT NULL
    AND pie.completed_by IS NOT NULL
  GROUP BY pie.plan_item_id
)
SELECT
  ir.plan_item_id,
  ir.plan_id,
  ir.product_id,
  ir.routing_id,
  rs.std_minutes,
  ROUND(rs.std_cost, 2)                                               AS std_cost,
  COALESCE(r.reel_minutes, 0)                                         AS reel_minutes,
  ROUND(COALESCE(r.reel_cost, 0), 2)                                  AS reel_cost,
  CASE WHEN rs.std_minutes IS NULL THEN NULL
       ELSE COALESCE(r.reel_minutes, 0) - rs.std_minutes END          AS ecart_minutes,
  CASE WHEN rs.std_cost IS NULL THEN NULL
       ELSE ROUND(COALESCE(r.reel_cost, 0) - rs.std_cost, 2) END      AS ecart_cost
FROM item_routing ir
LEFT JOIN routing_std rs ON rs.routing_id = ir.routing_id
LEFT JOIN reel       r  ON r.plan_item_id = ir.plan_item_id;

COMMENT ON VIEW v_production_mo_ecart IS
  'Écart MO standard (gamme mig 388) ↔ réel (étapes mig 089) par item de plan (roadmap production lot 1).';
