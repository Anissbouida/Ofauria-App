-- 398 — Capacité des postes & charge planifiée (Production, roadmap lot 3)
--
-- Permet de confronter la CHARGE d'un plan (temps requis par poste) à la CAPACITÉ
-- disponible du poste, pour détecter les goulets (four, pétrin, chariots).
--
-- Base de charge choisie : « par fournée (lot) ».
--   - routings.batch_size = nombre d'unités (pièces équivalentes) produites par UN
--     passage de la gamme (ex. 1 cadre, 18 plaques). Défaut 1.
--   - nb_fournées d'un article = CEIL(planned_quantity / batch_size).
--   - charge d'un poste pour un plan = Σ sur les articles : nb_fournées × Σ(durée des
--     opérations de la gamme sur ce poste).
--   Gamme résolue comme en mig 396 : explicite sur l'article, sinon gamme active du produit.
--
-- Capacité : work_centers.capacity_minutes_per_day = minutes disponibles par jour sur
--   le poste (NULL = pas de plafond connu → charge affichée sans % d'utilisation).
--   Modèle simple volontaire ; un calendrier horaire + jours fériés pourra l'affiner.
--
-- INVERSION :
--   DROP VIEW IF EXISTS v_production_work_center_load;
--   ALTER TABLE work_centers DROP COLUMN IF EXISTS capacity_minutes_per_day;
--   ALTER TABLE routings      DROP COLUMN IF EXISTS batch_size;

ALTER TABLE routings
  ADD COLUMN IF NOT EXISTS batch_size NUMERIC(10,3) NOT NULL DEFAULT 1 CHECK (batch_size > 0);

ALTER TABLE work_centers
  ADD COLUMN IF NOT EXISTS capacity_minutes_per_day NUMERIC(10,1)
    CHECK (capacity_minutes_per_day IS NULL OR capacity_minutes_per_day > 0);

COMMENT ON COLUMN routings.batch_size IS
  'Taille de fournée : unités (pièces équivalentes) produites par un passage de la gamme (mig 398).';
COMMENT ON COLUMN work_centers.capacity_minutes_per_day IS
  'Capacité du poste en minutes disponibles par jour (NULL = non définie) (mig 398).';

CREATE OR REPLACE VIEW v_production_work_center_load AS
WITH item_routing AS (
  SELECT ppi.id            AS plan_item_id,
         ppi.plan_id,
         ppi.planned_quantity,
         COALESCE(
           ppi.routing_id,
           (SELECT r.id FROM routings r
             WHERE r.product_id = ppi.product_id AND r.is_active
             ORDER BY r.created_at DESC
             LIMIT 1)
         ) AS routing_id
  FROM production_plan_items ppi
  WHERE ppi.status <> 'cancelled'
),
item_batches AS (
  SELECT ir.plan_id,
         ir.routing_id,
         CEIL(ir.planned_quantity::numeric / NULLIF(r.batch_size, 0)) AS nb_fournees
  FROM item_routing ir
  JOIN routings r ON r.id = ir.routing_id
)
SELECT
  ib.plan_id,
  ro.work_center_id,
  wc.name                                        AS work_center_name,
  wc.capacity_minutes_per_day,
  SUM(ib.nb_fournees * ro.duration_min)::numeric AS minutes_required
FROM item_batches ib
JOIN routing_operations ro ON ro.routing_id = ib.routing_id
JOIN work_centers wc       ON wc.id = ro.work_center_id
GROUP BY ib.plan_id, ro.work_center_id, wc.name, wc.capacity_minutes_per_day;

COMMENT ON VIEW v_production_work_center_load IS
  'Charge (minutes requises) par poste et par plan, base « par fournée » (roadmap production lot 3).';
