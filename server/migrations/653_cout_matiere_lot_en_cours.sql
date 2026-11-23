-- 653 — Coût d'une matière = prix du lot en cours d'utilisation.
--
-- POURQUOI
--   Décision utilisateur (2026-11-23) : le coût de revient se calcule sur le prix du lot
--   réellement utilisé, pas sur une moyenne ni sur un prix saisi. ingredients.unit_cost (lu par
--   toutes les vues de coût, l'éditeur de fiche, les prix de vente) valait jusqu'ici le coût
--   moyen pondéré calculé à la réception (CMUP), et toute saisie sur la fiche matière le
--   remplaçait (Farine T55 saisie à 3,50 DH alors que ses lots étaient à 5,42 et 5,50).
--   Le coût RÉEL d'un ordre restait, lui, valorisé lot par lot (production_lot_usage).
--
-- CE QUI CHANGE
--   fn_ingredient_lot_cost(matière) : prix du lot qui sort en premier, dans l'ordre de sortie
--   du stock de l'application — contenant déjà ouvert au poste de pesée d'abord, puis DLC la
--   plus proche, puis lot reçu le plus tôt — parmi les lots actifs restants à prix connu.
--   - Toute écriture de ingredients.unit_cost (réception, frais d'approche, fusion, correction,
--     import, fiche matière) est ramenée à ce prix tant qu'un tel lot existe (trigger BEFORE).
--   - Toute entrée, sortie, ouverture ou correction de prix d'un lot recalcule le coût de sa
--     matière (trigger AFTER sur ingredient_lots) : quand le lot en cours s'épuise, le suivant
--     prend le relais.
--   - Sans lot en stock, unit_cost garde sa dernière valeur (prix du dernier lot utilisé) ou le
--     prix prévisionnel saisi.
--   Rattrapage : chaque matière en stock reçoit le prix de son lot en cours.
--
-- RETOUR ARRIÈRE
--   DROP TRIGGER trg_ingredient_cost_from_lot ON ingredients;
--   DROP TRIGGER trg_lot_refresh_ingredient_cost ON ingredient_lots;
--   DROP FUNCTION fn_ingredient_cost_from_lot(), fn_lot_refresh_ingredient_cost(), fn_ingredient_lot_cost(uuid);
--   (les coûts restent ceux du lot en cours jusqu'à la prochaine réception, qui recalcule le CMUP)

CREATE OR REPLACE FUNCTION fn_ingredient_lot_cost(p_ingredient uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT l.unit_cost
    FROM ingredient_lots l
   WHERE l.ingredient_id = p_ingredient
     AND l.status = 'active'
     AND l.quantity_remaining > 0
     AND l.unit_cost IS NOT NULL AND l.unit_cost::text <> 'NaN' AND l.unit_cost > 0
   ORDER BY (COALESCE(l.pesage_quantity, 0) > 0) DESC,
            l.expiration_date ASC NULLS LAST,
            l.received_at ASC NULLS LAST,
            l.created_at ASC
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION fn_ingredient_cost_from_lot()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v numeric;
BEGIN
  v := fn_ingredient_lot_cost(NEW.id);
  IF v IS NOT NULL THEN NEW.unit_cost := v; END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_ingredient_cost_from_lot ON ingredients;
CREATE TRIGGER trg_ingredient_cost_from_lot
  BEFORE UPDATE OF unit_cost ON ingredients
  FOR EACH ROW EXECUTE FUNCTION fn_ingredient_cost_from_lot();

CREATE OR REPLACE FUNCTION fn_lot_refresh_ingredient_cost()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ing uuid := COALESCE(NEW.ingredient_id, OLD.ingredient_id);
  v numeric;
BEGIN
  v := fn_ingredient_lot_cost(ing);
  IF v IS NOT NULL THEN
    UPDATE ingredients SET unit_cost = v WHERE id = ing AND unit_cost IS DISTINCT FROM v;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.ingredient_id IS DISTINCT FROM NEW.ingredient_id THEN
    v := fn_ingredient_lot_cost(OLD.ingredient_id);
    IF v IS NOT NULL THEN
      UPDATE ingredients SET unit_cost = v WHERE id = OLD.ingredient_id AND unit_cost IS DISTINCT FROM v;
    END IF;
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_lot_refresh_ingredient_cost ON ingredient_lots;
CREATE TRIGGER trg_lot_refresh_ingredient_cost
  AFTER INSERT OR DELETE OR UPDATE OF quantity_remaining, status, unit_cost, pesage_quantity, expiration_date, ingredient_id
  ON ingredient_lots
  FOR EACH ROW EXECUTE FUNCTION fn_lot_refresh_ingredient_cost();

-- Rattrapage.
UPDATE ingredients i SET unit_cost = fn_ingredient_lot_cost(i.id)
 WHERE fn_ingredient_lot_cost(i.id) IS NOT NULL
   AND i.unit_cost IS DISTINCT FROM fn_ingredient_lot_cost(i.id);
