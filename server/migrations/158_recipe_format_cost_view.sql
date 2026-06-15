-- Migration 158 : v_recipe_format_cost — Cout calcule par format de production
--
-- Probleme : avec la table recipe_formats (mig 157), une recette peut produire
-- plusieurs formats simultanement. Il faut un cout par format pour le prix de
-- vente. Le calcul doit absorber les pertes dans le cout (sinon la boulangerie
-- perd de l'argent sur les pertes).
--
-- Formule :
--   poids_format_ligne     = quantite_par_format_g * nb_par_defaut
--   poids_utilise_recette  = SUM(poids_format_ligne) sur toutes les lignes de la recette
--   cout_matiere_format    = cout_total_recette * poids_format_ligne / poids_utilise_recette
--   cout_unitaire_format   = (cout_matiere_format / nb_par_defaut) + cout_emballage_unitaire
--   prix_vente_unitaire    = cout_unitaire_format * margin_multiplier
--
-- Note : on divise par poids_utilise (et non par v_recipe_total_weight_kg) pour
-- absorber les pertes. La vue de synthese v_recipe_format_summary expose la
-- perte (calculee vs utilise) pour affichage cote UI.

CREATE OR REPLACE VIEW v_recipe_format_cost AS
WITH format_lines AS (
  SELECT rf.id,
         rf.recipe_id,
         rf.contenant_id,
         rf.quantite_par_format_g,
         rf.nb_par_defaut,
         rf.cout_emballage_unitaire,
         rf.ordre,
         rf.is_active,
         (rf.quantite_par_format_g * rf.nb_par_defaut) AS poids_format_g
  FROM recipe_formats rf
),
recipe_totals AS (
  SELECT fl.recipe_id,
         SUM(fl.poids_format_g) AS poids_utilise_g
  FROM format_lines fl
  GROUP BY fl.recipe_id
)
SELECT fl.id,
       fl.recipe_id,
       fl.contenant_id,
       fl.quantite_par_format_g,
       fl.nb_par_defaut,
       fl.cout_emballage_unitaire,
       fl.ordre,
       fl.is_active,
       fl.poids_format_g,
       rt.poids_utilise_g,
       -- Cout matiere alloue a ce format (proportionnel au poids)
       CASE WHEN COALESCE(rt.poids_utilise_g, 0) > 0
            THEN COALESCE(vtc.total_cost, 0) * fl.poids_format_g / rt.poids_utilise_g
            ELSE 0
       END AS cout_matiere_format,
       -- Cout matiere par unite de ce format
       CASE WHEN COALESCE(rt.poids_utilise_g, 0) > 0 AND fl.nb_par_defaut > 0
            THEN (COALESCE(vtc.total_cost, 0) * fl.poids_format_g / rt.poids_utilise_g) / fl.nb_par_defaut
            ELSE 0
       END AS cout_matiere_unitaire,
       -- Cout complet par unite (matiere + emballage)
       CASE WHEN COALESCE(rt.poids_utilise_g, 0) > 0 AND fl.nb_par_defaut > 0
            THEN ((COALESCE(vtc.total_cost, 0) * fl.poids_format_g / rt.poids_utilise_g) / fl.nb_par_defaut)
                 + fl.cout_emballage_unitaire
            ELSE fl.cout_emballage_unitaire
       END AS cout_unitaire_complet,
       -- Prix de vente unitaire = cout complet * marge recette
       CASE WHEN COALESCE(rt.poids_utilise_g, 0) > 0 AND fl.nb_par_defaut > 0
            THEN (((COALESCE(vtc.total_cost, 0) * fl.poids_format_g / rt.poids_utilise_g) / fl.nb_par_defaut)
                 + fl.cout_emballage_unitaire)
                 * COALESCE(r.margin_multiplier, 3)
            ELSE fl.cout_emballage_unitaire * COALESCE(r.margin_multiplier, 3)
       END AS prix_vente_unitaire
FROM format_lines fl
JOIN recipes r ON r.id = fl.recipe_id
LEFT JOIN recipe_totals rt ON rt.recipe_id = fl.recipe_id
LEFT JOIN v_recipe_total_cost vtc ON vtc.id = fl.recipe_id;

COMMENT ON VIEW v_recipe_format_cost IS
  'Cout par format calcule a la volee (cout matiere proportionnel au poids, + emballage, * marge recette). Les pertes sont absorbees.';

-- Vue de synthese recette : compare poids reel vs poids utilise -> exposer la perte
CREATE OR REPLACE VIEW v_recipe_format_summary AS
SELECT r.id AS recipe_id,
       COALESCE(vtw.total_weight_kg, 0) AS poids_calcule_kg,
       COALESCE(SUM(rf.quantite_par_format_g * rf.nb_par_defaut), 0) / 1000.0 AS poids_utilise_kg,
       COALESCE(vtw.total_weight_kg, 0)
         - (COALESCE(SUM(rf.quantite_par_format_g * rf.nb_par_defaut), 0) / 1000.0) AS perte_kg,
       CASE WHEN COALESCE(vtw.total_weight_kg, 0) > 0
            THEN ((COALESCE(vtw.total_weight_kg, 0)
                   - (COALESCE(SUM(rf.quantite_par_format_g * rf.nb_par_defaut), 0) / 1000.0))
                  / vtw.total_weight_kg) * 100
            ELSE 0
       END AS perte_pct,
       COUNT(rf.id) AS nb_formats
FROM recipes r
LEFT JOIN recipe_formats rf ON rf.recipe_id = r.id
LEFT JOIN v_recipe_total_weight_kg vtw ON vtw.id = r.id
GROUP BY r.id, vtw.total_weight_kg;

COMMENT ON VIEW v_recipe_format_summary IS
  'Synthese recette : poids calcule depuis les ingredients vs poids utilise dans les formats, et la perte.';
