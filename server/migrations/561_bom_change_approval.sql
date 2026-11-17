-- M4-03 (plan d'action 2026-11) — approbation d'une modification de nomenclature.
--
-- Une demande d'activation fige le contenu demandé dans une version « brouillon » (au plus
-- une par fiche) puis passe par le moteur d'approbation (type de pièce bom_change :
-- écart de coût en %, ordres ouverts concernés). Sans règle applicable : activation
-- directe, comportement d'avant. Approuvée : le brouillon devient la version active ;
-- refusée : le brouillon est retiré.
--
-- INVERSION : DROP INDEX uq_bom_versions_one_draft;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bom_versions_one_draft ON bom_versions (recipe_id) WHERE status = 'brouillon';
