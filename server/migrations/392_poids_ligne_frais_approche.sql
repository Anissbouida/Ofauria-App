-- 392 — Socle « poids fiable par ligne » + frais d'approche répartis au poids
--
-- POURQUOI
--   Les frais d'approche (mig 361) se répartissaient au prorata de la VALEUR ou de
--   la QUANTITÉ. Or transport, douane et manutention sont le plus souvent facturés
--   au poids : une palette de farine (lourde, peu chère) doit porter plus de frais
--   qu'un carton d'arômes (léger, cher). Pour répartir au poids il faut un poids
--   fiable par ligne de réception — c'est le socle que pose cette migration.
--
-- QUOI
--   1. ingredients.poids_piece_kg : poids net d'UNE pièce, en kg, pour les articles
--      comptés/stockés à la pièce (unit = 'unit'). NULL = inconnu.
--      - masse (g/kg/mg)   : le poids se déduit de la quantité (fn_unit_conv) ;
--      - volume (ml/cl/dl/l): via la densité déjà saisie (densite_kg_l, mig 227) ;
--      - pièce (unit)      : via poids_piece_kg (nouveau).
--   2. fn_ingredient_weight_kg(ingredient_id, quantity) : poids en kg d'une quantité
--      pour un ingrédient, ou NULL si non déterminable (volume sans densité, pièce
--      sans poids pièce, unité inconnue). NULL = la ligne ne peut pas porter de frais
--      au poids (signalée à l'utilisateur, exclue de la base de répartition).
--   3. landed_cost_vouchers.allocation_method accepte désormais 'weight'.
--
-- INVERSION
--   ALTER TABLE landed_cost_vouchers DROP CONSTRAINT landed_cost_vouchers_allocation_method_check;
--   ALTER TABLE landed_cost_vouchers ADD CONSTRAINT landed_cost_vouchers_allocation_method_check
--     CHECK (allocation_method IN ('value','quantity'));
--   DROP FUNCTION fn_ingredient_weight_kg(uuid, numeric);
--   ALTER TABLE ingredients DROP COLUMN poids_piece_kg;

-- 1. Poids net d'une pièce (kg), pour les articles comptés à la pièce.
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS poids_piece_kg NUMERIC(10,4)
  CHECK (poids_piece_kg IS NULL OR poids_piece_kg > 0);
COMMENT ON COLUMN ingredients.poids_piece_kg IS
  'Poids net d''une pièce en kg (articles à l''unité). Sert à convertir une quantité en pièces vers un poids (frais d''approche au poids). NULL = poids pièce inconnu.';

-- 2. Poids en kg d'une quantité d'un ingrédient, ou NULL si non déterminable.
CREATE OR REPLACE FUNCTION fn_ingredient_weight_kg(p_ingredient_id uuid, p_quantity numeric)
RETURNS numeric
LANGUAGE sql
STABLE
AS $function$
  SELECT CASE
    WHEN p_quantity IS NULL THEN NULL
    -- masse : conversion directe vers kg
    WHEN lower(i.unit) IN ('mg','g','kg') THEN p_quantity * fn_unit_conv(i.unit, 'kg')
    -- volume : nécessite la densité (kg/L)
    WHEN lower(i.unit) IN ('ml','cl','dl','l') THEN
      CASE WHEN COALESCE(i.densite_kg_l, 0) > 0
           THEN p_quantity * fn_unit_conv(i.unit, 'kg', i.densite_kg_l)
           ELSE NULL END
    -- pièce : nécessite le poids d'une pièce
    WHEN lower(i.unit) IN ('unit','unité','unite','u','pièce','piece','pce','pc','pcs') THEN
      CASE WHEN COALESCE(i.poids_piece_kg, 0) > 0
           THEN p_quantity * i.poids_piece_kg
           ELSE NULL END
    ELSE NULL
  END
  FROM ingredients i WHERE i.id = p_ingredient_id;
$function$;
COMMENT ON FUNCTION fn_ingredient_weight_kg(uuid, numeric) IS
  'Poids en kg d''une quantité d''un ingrédient (masse directe, volume via densité, pièce via poids_piece_kg). NULL = non déterminable (mig 392).';

-- 3. Méthode de répartition au poids pour les frais d'approche.
ALTER TABLE landed_cost_vouchers DROP CONSTRAINT IF EXISTS landed_cost_vouchers_allocation_method_check;
ALTER TABLE landed_cost_vouchers ADD CONSTRAINT landed_cost_vouchers_allocation_method_check
  CHECK (allocation_method IN ('value', 'quantity', 'weight'));
