-- 616 — Rendement d'une préparation de base au kilo (scénario 1, atelier viennoiserie).
--
-- Une base employée dans une autre fiche se coûte sur recipes.yield_quantity (listSources,
-- v_recipe_component_cost, v_recipe_total_cost). Depuis la mig 613, le rendement d'un format
-- peut être saisi en kilos, mais l'éditeur ne touchait pas yield_quantity, resté à 1 kg (valeur
-- de création) : 60 g de pâte feuilletée coûtaient 6 % de la fournée entière au lieu de
-- 60 g ÷ 9,7 kg. L'enregistrement du format par défaut recopie désormais le rendement kilo
-- (recipe-component.repository, replaceForFormat) ; on rattrape ici les bases déjà saisies.
-- Les bases en pièces ne sont pas touchées.

UPDATE recipes r
SET yield_quantity = f.rendement_kg,
    yield_unit = 'kg',
    updated_at = NOW()
FROM recipe_formats f
WHERE f.recipe_id = r.id
  AND f.is_default
  AND r.is_base
  AND f.rendement_unite = 'kg'
  AND f.rendement_kg > 0
  AND (r.yield_quantity IS DISTINCT FROM f.rendement_kg OR r.yield_unit IS DISTINCT FROM 'kg');
