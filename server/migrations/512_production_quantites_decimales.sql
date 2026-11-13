-- 512 — Quantités de production décimales (plan Production générique, lot P3).
--
-- Les quantités des plans étaient des ENTIERS : impossible de planifier 12,5 kg ou
-- 3,2 m. On passe en DOUBLE PRECISION (et non en NUMERIC) les quantités qui circulent
-- du plan au transfert : node-pg renvoie un DOUBLE PRECISION comme un NOMBRE JS,
-- comme l'entier d'avant, alors qu'un NUMERIC arriverait en TEXTE (« 12.000 ») et
-- casserait les ~170 calculs existants (`planned + x` deviendrait une concaténation).
-- Une quantité n'est pas un montant : la précision binaire suffit, et le code arrondit
-- à 3 décimales à l'écriture.
--
--   production_plan_items     : planned_quantity, actual_quantity, qty_from_frigo, surplus_frigo
--   production_transfer_items : transferred_quantity, received_quantity
--   order_items               : qty_from_stock, qty_to_produce (la quantité commandée est
--                               décimale depuis la mig 471 ; sa ventilation restait entière)
-- nb_contenants reste entier (on compte des contenants).
--
-- Deux vues lisent ces colonnes : leur définition COURANTE est relue, elles sont
-- supprimées puis recréées à l'identique (mêmes colonnes, types élargis).
-- Les entiers existants sont conservés tels quels. Retour arrière : ALTER ... TYPE
-- INTEGER USING round(col)::int (perte des décimales saisies entre-temps).

-- ROUND(x, n) n'existe que pour NUMERIC : des fonctions et requêtes existantes font
-- ROUND(... * actual_quantity ..., 4) (ex. fn_plan_item_unit_cost, mig 452, appelée à la
-- création d'un lot). Avec une quantité DOUBLE PRECISION l'expression devient flottante
-- et l'appel échouerait. On AJOUTE la variante flottante (rendue en NUMERIC, comme
-- avant) au lieu de réécrire ces fonctions anciennes (propriétaire différent en prod).
CREATE OR REPLACE FUNCTION public.round(double precision, integer) RETURNS numeric
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  AS $fn$ SELECT pg_catalog.round($1::numeric, $2) $fn$;

DO $$
DECLARE
  def_rendement TEXT := CASE WHEN to_regclass('public.v_plan_item_rendement') IS NOT NULL
                             THEN pg_get_viewdef('public.v_plan_item_rendement'::regclass, true) END;
  def_charge    TEXT := CASE WHEN to_regclass('public.v_production_work_center_load') IS NOT NULL
                             THEN pg_get_viewdef('public.v_production_work_center_load'::regclass, true) END;
BEGIN
  DROP VIEW IF EXISTS v_production_work_center_load;
  DROP VIEW IF EXISTS v_plan_item_rendement;

  ALTER TABLE production_plan_items
    ALTER COLUMN planned_quantity TYPE DOUBLE PRECISION,
    ALTER COLUMN actual_quantity  TYPE DOUBLE PRECISION,
    ALTER COLUMN qty_from_frigo   TYPE DOUBLE PRECISION,
    ALTER COLUMN surplus_frigo    TYPE DOUBLE PRECISION;

  ALTER TABLE production_transfer_items
    ALTER COLUMN transferred_quantity TYPE DOUBLE PRECISION,
    ALTER COLUMN received_quantity    TYPE DOUBLE PRECISION;

  ALTER TABLE order_items
    ALTER COLUMN qty_from_stock TYPE DOUBLE PRECISION,
    ALTER COLUMN qty_to_produce TYPE DOUBLE PRECISION;

  IF def_rendement IS NOT NULL THEN EXECUTE 'CREATE VIEW v_plan_item_rendement AS ' || def_rendement; END IF;
  IF def_charge    IS NOT NULL THEN EXECUTE 'CREATE VIEW v_production_work_center_load AS ' || def_charge; END IF;
END $$;
