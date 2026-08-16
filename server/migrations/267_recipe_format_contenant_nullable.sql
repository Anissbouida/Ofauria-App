-- Migration 267 : contenant_id nullable + suppression du placebo (audit A9, P2)
--
-- POURQUOI
--   La mig 201 a introduit un contenant generique « Assemblage (format à définir) »
--   a id fixe (11111111-1111-4111-8111-111111111111) parce que
--   recipe_formats.contenant_id etait NOT NULL. Un produit compose sans moule
--   propre etait alors artificiellement rattache a ce placebo. Le referentiel
--   production_contenants est pollue par un non-contenant, et l'UI doit le
--   traiter a part (n'apparait pas dans les listes de contenants disponibles,
--   mais s'affiche comme nom du format).
--
--   Cette migration :
--     1. rend contenant_id NULLABLE — un format d'assemblage n'a pas de moule ;
--     2. deplace les formats du placebo vers contenant_id = NULL (51 lignes) ;
--     3. supprime la ligne placebo.
--
--   L'UI de l'editeur affiche deja « Format » comme fallback quand le nom du
--   contenant est absent (LEFT JOIN production_contenants, nom NULL possible).
--   listFormats() / findByFormat() continuent de fonctionner (LEFT JOIN).
--
--   La contrainte UNIQUE(recipe_id, contenant_id) reste : Postgres considere
--   NULL != NULL dans UNIQUE, donc une meme recette peut avoir plusieurs
--   formats d'assemblage sans conflit. C'est le comportement voulu (une meme
--   recette peut avoir « assemblage cadre 20x30 » et « assemblage buche »
--   par exemple).
--
-- PORTEE
--   ALTER TABLE recipe_formats ALTER COLUMN contenant_id DROP NOT NULL
--   + UPDATE + DELETE 1 ligne.
--   Aucune donnee cout modifiee : les LEFT JOIN des vues supportent deja
--   contenant_id NULL (contenant_nom devient NULL).
--
-- INVERSION
--   Re-INSERT du placebo :
--     INSERT INTO production_contenants (id, nom, type_production, unite_lancement, is_active)
--     VALUES ('11111111-1111-4111-8111-111111111111', 'Assemblage (format à définir)',
--             3, 'unit', true);
--   UPDATE recipe_formats SET contenant_id = '11111111-...' WHERE contenant_id IS NULL;
--   ALTER TABLE recipe_formats ALTER COLUMN contenant_id SET NOT NULL;

ALTER TABLE recipe_formats
  ALTER COLUMN contenant_id DROP NOT NULL;

UPDATE recipe_formats
  SET contenant_id = NULL
WHERE contenant_id = '11111111-1111-4111-8111-111111111111';

DELETE FROM production_contenants
WHERE id = '11111111-1111-4111-8111-111111111111';

COMMENT ON COLUMN recipe_formats.contenant_id IS
  'Contenant physique du format (moule, cadre, plaque). NULL = format d''assemblage sans moule (mig 267). Le placebo « Assemblage (format à définir) » n''existe plus.';
