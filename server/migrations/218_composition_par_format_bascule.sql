-- Migration 218 : Bascule vers la composition PAR FORMAT (préparation)
--
-- POURQUOI
--   Une recette se décline en plusieurs contenants avec des quantités différentes.
--   La composition doit donc vivre par FORMAT (recipe_format_components, mig 200),
--   pas au niveau recette. Cette migration GARANTIT le socle :
--     - chaque produit composé a EXACTEMENT un format par défaut actif ;
--     - la BOM de ce format par défaut = la composition recette actuelle
--       (recipe_components) → bascule NEUTRE (même coût).
--   recipe_components reste ensuite le MIROIR du format par défaut (resync côté
--   service), pour ne pas toucher v_recipe_total_cost (lue partout).
--
-- NEUTRALITÉ
--   nb_par_defaut des formats créés = round(yield_quantity) = le rendement déjà
--   utilisé en repli ⇒ coût/pièce inchangé. recipe_components inchangé ⇒
--   v_recipe_total_cost inchangée.
--
-- INVERSION : supprimer les formats 'Assemblage' créés ici ; vider
--   recipe_format_components des formats par défaut. (recipe_components intact.)

-- A. Réactiver un format pour les composés sans AUCUN format actif (mais en ayant un).
UPDATE recipe_formats f SET is_active = true, updated_at = NOW()
WHERE f.id IN (
  SELECT DISTINCT ON (x.recipe_id) x.id
  FROM recipe_formats x
  JOIN recipes r ON r.id = x.recipe_id
  WHERE r.is_base = false AND r.mode_cout = 'compose'
    AND NOT EXISTS (SELECT 1 FROM recipe_formats a WHERE a.recipe_id = x.recipe_id AND a.is_active)
  ORDER BY x.recipe_id, x.is_default DESC, x.ordre, x.created_at
);

-- B. Créer un format « Assemblage » pour les composés SANS aucun format.
--    nb_par_defaut = rendement courant (round yield_quantity), pour rester neutre.
INSERT INTO recipe_formats
  (recipe_id, contenant_id, quantite_par_format_g, quantite_par_format_unite,
   nb_par_defaut, is_default, ordre, is_active)
SELECT r.id, '11111111-1111-4111-8111-111111111111', 1, 'g',
       GREATEST(1, round(COALESCE(NULLIF(r.yield_quantity, 0), 1))::int), false, 0, true
FROM recipes r
WHERE r.is_base = false AND r.mode_cout = 'compose'
  AND NOT EXISTS (SELECT 1 FROM recipe_formats f WHERE f.recipe_id = r.id);

-- C. Garantir UN is_default actif par recette composée.
-- C1. libérer un éventuel is_default INACTIF si aucun actif n'est défaut.
UPDATE recipe_formats f SET is_default = false, updated_at = NOW()
WHERE f.is_default AND NOT f.is_active
  AND f.recipe_id IN (SELECT id FROM recipes WHERE is_base = false AND mode_cout = 'compose')
  AND NOT EXISTS (SELECT 1 FROM recipe_formats a
                  WHERE a.recipe_id = f.recipe_id AND a.is_active AND a.is_default);
-- C2. désigner le 1er format actif comme défaut là où il en manque un.
UPDATE recipe_formats f SET is_default = true, updated_at = NOW()
WHERE f.id IN (
  SELECT DISTINCT ON (x.recipe_id) x.id
  FROM recipe_formats x
  JOIN recipes r ON r.id = x.recipe_id
  WHERE r.is_base = false AND r.mode_cout = 'compose' AND x.is_active
    AND NOT EXISTS (SELECT 1 FROM recipe_formats d WHERE d.recipe_id = x.recipe_id AND d.is_default)
  ORDER BY x.recipe_id, x.ordre, x.created_at
);

-- D. Synchroniser la BOM du format par défaut = recipe_components (écrase le stale mig 202).
DELETE FROM recipe_format_components c
USING recipe_formats f
WHERE c.format_id = f.id AND f.is_default
  AND f.recipe_id IN (SELECT id FROM recipes WHERE is_base = false AND mode_cout = 'compose');

INSERT INTO recipe_format_components
  (format_id, role, source_recipe_id, source_ingredient_id, quantite, unite, ordre)
SELECT f.id, rc.role, rc.source_recipe_id, rc.source_ingredient_id, rc.quantite, rc.unite, rc.ordre
FROM recipe_components rc
JOIN recipe_formats f ON f.recipe_id = rc.recipe_id AND f.is_default
JOIN recipes r ON r.id = rc.recipe_id
WHERE r.is_base = false AND r.mode_cout = 'compose';
