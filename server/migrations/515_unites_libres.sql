-- 515 — Unités de mesure libres (plan Production générique, suite de P4 / P7).
--
-- ingredients.unit était bornée par une contrainte CHECK figée (kg, g, l, ml, unit) :
-- un fabricant ne pouvait pas stocker une matière au mètre ou au m². La liste vient
-- désormais du référentiel `units` (Paramètres › Référentiels, mig 058 / 470) :
--   * deux unités ajoutées : m (longueur) et m2 (surface), metadata au format 470 ;
--   * la contrainte est remplacée par un trigger : à la création, ou quand l'unité
--     change, elle doit être un code actif du référentiel ou une unité historique.
--     Désactiver plus tard une unité ne rend pas invalides les matières existantes.
--
-- Conversions : fn_unit_conv (mig 227) est inchangée. Elle ne convertit que masse et
-- volume ; l'application refuse une ligne de fiche dans une autre unité que l'unité de
-- stock quand l'une des deux est une unité ajoutée (services/unit-referential.ts).
--
-- Additif : aucune matière existante ne change. Retour arrière : supprimer le trigger
-- et recréer la contrainte ingredients_unit_check de la mig 164.

INSERT INTO ref_entries (table_id, code, label, description, display_order, metadata) VALUES
  ('units', 'm',  'Mètre',       'Unité de longueur', 6, '{"category":"length","to_base":1,"is_base":true}'),
  ('units', 'm2', 'Mètre carré', 'Unité de surface',  7, '{"category":"area","to_base":1,"is_base":true}')
ON CONFLICT (table_id, code) DO NOTHING;

CREATE FUNCTION fn_check_ingredient_unit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.unit IS NOT DISTINCT FROM OLD.unit THEN
    RETURN NEW;
  END IF;
  IF NEW.unit IN ('mg', 'g', 'kg', 'ml', 'cl', 'dl', 'l', 'unit')
     OR EXISTS (SELECT 1 FROM ref_entries WHERE table_id = 'units' AND code = NEW.unit AND is_active) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Unité inconnue : % (Paramètres › Référentiels › Unités de mesure)', NEW.unit
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER trg_check_ingredient_unit
  BEFORE INSERT OR UPDATE OF unit ON ingredients
  FOR EACH ROW EXECUTE FUNCTION fn_check_ingredient_unit();

ALTER TABLE ingredients DROP CONSTRAINT IF EXISTS ingredients_unit_check;
