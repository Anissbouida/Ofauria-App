-- 650 — Doublons de nomenclature laissés par la migration 411.
--
-- POURQUOI
--   La mig 411 (unification du modèle de composition, appliquée en production le 2026-11-02)
--   recopiait les sous-recettes de l'ancien modèle dans le format par défaut avec ordre = 100
--   et sans rôle. Pour les fiches qui avaient DÉJÀ une nomenclature, ces lignes se sont
--   AJOUTÉES aux lignes existantes au lieu de les remplacer : chaque base était comptée deux
--   fois dans le coût et les besoins. Pour trois lignes, la copie portait en plus l'unité de
--   rendement de la base au lieu de celle de la ligne (2,11 kg devenu 2,11 g).
--   Mesure en production (2026-11-23, lecture seule) : 91 lignes en double dans 27 fiches
--   actives (Amandine, Opéra noisette, entremets, trompe-l'œil, tartes…), autant dans le
--   miroir recipe_components ; aucune de ces fiches n'a de prix de caisse lié.
--
-- CE QUI CHANGE
--   Supprime une ligne de nomenclature si et seulement si : elle a été créée PAR la mig 411
--   (created_at = instant d'exécution de la 411 dans _migrations — les lignes d'une même
--   transaction partagent now(), vérifié en production à la microseconde), ordre = 100, et une
--   ligne d'ordre inférieur du même format porte la même source. Le rôle n'entre pas dans le
--   critère : la mig 634 remplit les rôles vides et la mig 649 repointe certaines lignes.
--   La ligne d'origine (quantité, unité, perte) est conservée. Les lignes de la 411 sans
--   jumelle (sous-recettes réellement migrées : levain, crème pâtissière dans les bases) sont
--   gardées. Même règle sur le miroir, reconstruit de toute façon par trg_rfc_sync_mirror pour
--   le format par défaut à chaque suppression.
--   Sans ligne de la 411 (installation neuve), la migration ne fait rien.
--
-- RETOUR ARRIÈRE
--   Chaque suppression est tracée par recipe_format_components_bom_audit (recipe_bom_audit).

DELETE FROM recipe_format_components b
 WHERE b.ordre = 100
   AND b.created_at = (SELECT executed_at FROM _migrations WHERE name = '411_unifie_modele_composition.sql')
   AND EXISTS (SELECT 1 FROM recipe_format_components a
                WHERE a.format_id = b.format_id AND a.id <> b.id AND a.ordre < 100
                  AND a.source_recipe_id IS NOT DISTINCT FROM b.source_recipe_id
                  AND a.source_ingredient_id IS NOT DISTINCT FROM b.source_ingredient_id
                  AND a.source_packaging_id IS NOT DISTINCT FROM b.source_packaging_id);

DELETE FROM recipe_components b
 WHERE b.ordre = 100
   AND b.created_at = (SELECT executed_at FROM _migrations WHERE name = '411_unifie_modele_composition.sql')
   AND EXISTS (SELECT 1 FROM recipe_components a
                WHERE a.recipe_id = b.recipe_id AND a.id <> b.id AND a.ordre < 100
                  AND a.source_recipe_id IS NOT DISTINCT FROM b.source_recipe_id
                  AND a.source_ingredient_id IS NOT DISTINCT FROM b.source_ingredient_id);
