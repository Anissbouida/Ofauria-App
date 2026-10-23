-- Archivage des fiches techniques.
-- Une recette référencée par l'historique de production (production_plan_items,
-- production_plan_dependencies, semi_finished_*) est protégée par FK RESTRICT :
-- la supprimer casserait la traçabilité des lancements passés. L'archivage la
-- retire des listes et des sélecteurs (sous-recettes, composants) sans toucher
-- aux données historiques ; elle reste restaurable.
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
