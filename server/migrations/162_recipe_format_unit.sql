-- Migration 162 : Unite choisissable pour la quantite par format
--
-- Probleme : recipe_formats.quantite_par_format_g est fige en grammes. Le chef
-- veut pouvoir saisir "0.6 kg" plutot que "600 g" pour les recettes en kg,
-- ou "300 ml" pour les cremes. La valeur est conservee telle que saisie, et
-- la vue v_recipe_format_cost convertit en grammes pour la proration.
--
-- Densite 1 pour les liquides (approximation standard en patisserie). 'unit'
-- n'est pas supporte ici car sans poids intrinseque -> pas de proration possible.

ALTER TABLE recipe_formats
  ADD COLUMN IF NOT EXISTS quantite_par_format_unite VARCHAR(10) NOT NULL DEFAULT 'g'
    CHECK (quantite_par_format_unite IN ('g', 'kg', 'ml', 'l'));

COMMENT ON COLUMN recipe_formats.quantite_par_format_unite IS
  'Unite de mesure de quantite_par_format_g (mal nommee, peut contenir kg/ml/l aussi). La vue v_recipe_format_cost convertit en grammes pour la proration.';
COMMENT ON COLUMN recipe_formats.quantite_par_format_g IS
  'Quantite par format dans l''unite quantite_par_format_unite (g par defaut). La conversion vers grammes est faite par v_recipe_format_cost.';

-- Mise a jour de la vue v_recipe_format_cost pour appliquer la conversion d'unite.
DROP VIEW IF EXISTS v_recipe_format_cost;
CREATE VIEW v_recipe_format_cost AS
WITH format_lines AS (
  SELECT rf.id,
         rf.recipe_id,
         rf.contenant_id,
         rf.quantite_par_format_g,
         rf.quantite_par_format_unite,
         rf.nb_par_defaut,
         rf.cout_emballage_unitaire,
         rf.ordre,
         rf.is_active,
         -- Conversion vers grammes (densite 1 pour les liquides)
         (rf.quantite_par_format_g
            * CASE rf.quantite_par_format_unite
                WHEN 'g'  THEN 1
                WHEN 'kg' THEN 1000
                WHEN 'ml' THEN 1
                WHEN 'l'  THEN 1000
                ELSE 1
              END
            * rf.nb_par_defaut) AS poids_format_g
  FROM recipe_formats rf
),
recipe_totals AS (
  SELECT fl.recipe_id,
         SUM(fl.poids_format_g) AS poids_utilise_g
  FROM format_lines fl
  GROUP BY fl.recipe_id
),
recipe_duree AS (
  SELECT r.id AS recipe_id,
         COALESCE(SUM((step->>'duree_estimee_min')::numeric), 0) AS duree_totale_min
  FROM recipes r
  LEFT JOIN LATERAL jsonb_array_elements(COALESCE(r.etapes, '[]'::jsonb)) AS step ON true
  GROUP BY r.id
),
recipe_couts_indirects AS (
  SELECT r.id AS recipe_id,
         (rd.duree_totale_min / 60.0) * COALESCE(r.taux_main_oeuvre_dh_h, 0) AS cout_mo_recette,
         COALESCE(r.cout_energie_fournee, 0) AS cout_energie_recette,
         (COALESCE(vtc.total_cost, 0)
          + (rd.duree_totale_min / 60.0) * COALESCE(r.taux_main_oeuvre_dh_h, 0)
          + COALESCE(r.cout_energie_fournee, 0))
          * COALESCE(r.taux_frais_structure_pct, 0) / 100.0 AS cout_struct_recette
  FROM recipes r
  LEFT JOIN recipe_duree rd ON rd.recipe_id = r.id
  LEFT JOIN v_recipe_total_cost vtc ON vtc.id = r.id
)
SELECT fl.id,
       fl.recipe_id,
       fl.contenant_id,
       fl.quantite_par_format_g,
       fl.quantite_par_format_unite,
       fl.nb_par_defaut,
       fl.cout_emballage_unitaire,
       fl.ordre,
       fl.is_active,
       fl.poids_format_g,
       rt.poids_utilise_g,
       CASE WHEN COALESCE(rt.poids_utilise_g, 0) > 0
            THEN fl.poids_format_g / rt.poids_utilise_g
            ELSE 0
       END AS ratio_poids,
       CASE WHEN COALESCE(rt.poids_utilise_g, 0) > 0
            THEN COALESCE(vtc.total_cost, 0) * fl.poids_format_g / rt.poids_utilise_g
            ELSE 0
       END AS cout_matiere_format,
       CASE WHEN COALESCE(rt.poids_utilise_g, 0) > 0
            THEN ci.cout_mo_recette * fl.poids_format_g / rt.poids_utilise_g
            ELSE 0
       END AS cout_mo_format,
       CASE WHEN COALESCE(rt.poids_utilise_g, 0) > 0
            THEN ci.cout_energie_recette * fl.poids_format_g / rt.poids_utilise_g
            ELSE 0
       END AS cout_energie_format,
       CASE WHEN COALESCE(rt.poids_utilise_g, 0) > 0
            THEN ci.cout_struct_recette * fl.poids_format_g / rt.poids_utilise_g
            ELSE 0
       END AS cout_struct_format,
       CASE WHEN COALESCE(rt.poids_utilise_g, 0) > 0 AND fl.nb_par_defaut > 0
            THEN (COALESCE(vtc.total_cost, 0) * fl.poids_format_g / rt.poids_utilise_g) / fl.nb_par_defaut
            ELSE 0
       END AS cout_matiere_unitaire,
       CASE WHEN COALESCE(rt.poids_utilise_g, 0) > 0 AND fl.nb_par_defaut > 0
            THEN ((COALESCE(vtc.total_cost, 0)
                    + ci.cout_mo_recette
                    + ci.cout_energie_recette
                    + ci.cout_struct_recette
                  ) * fl.poids_format_g / rt.poids_utilise_g) / fl.nb_par_defaut
                 + fl.cout_emballage_unitaire
            ELSE fl.cout_emballage_unitaire
       END AS cout_unitaire_complet,
       CASE WHEN COALESCE(rt.poids_utilise_g, 0) > 0 AND fl.nb_par_defaut > 0
            THEN (((COALESCE(vtc.total_cost, 0)
                    + ci.cout_mo_recette
                    + ci.cout_energie_recette
                    + ci.cout_struct_recette
                  ) * fl.poids_format_g / rt.poids_utilise_g) / fl.nb_par_defaut
                 + fl.cout_emballage_unitaire)
                 * COALESCE(r.margin_multiplier, 3)
            ELSE fl.cout_emballage_unitaire * COALESCE(r.margin_multiplier, 3)
       END AS prix_vente_unitaire
FROM format_lines fl
JOIN recipes r ON r.id = fl.recipe_id
LEFT JOIN recipe_totals rt ON rt.recipe_id = fl.recipe_id
LEFT JOIN recipe_couts_indirects ci ON ci.recipe_id = fl.recipe_id
LEFT JOIN v_recipe_total_cost vtc ON vtc.id = fl.recipe_id;

-- Idem pour v_recipe_format_summary
DROP VIEW IF EXISTS v_recipe_format_summary;
CREATE VIEW v_recipe_format_summary AS
SELECT r.id AS recipe_id,
       COALESCE(vtw.total_weight_kg, 0) AS poids_calcule_kg,
       COALESCE(SUM(
         rf.quantite_par_format_g
           * CASE rf.quantite_par_format_unite
               WHEN 'g'  THEN 1
               WHEN 'kg' THEN 1000
               WHEN 'ml' THEN 1
               WHEN 'l'  THEN 1000
               ELSE 1
             END
           * rf.nb_par_defaut
       ), 0) / 1000.0 AS poids_utilise_kg,
       COALESCE(vtw.total_weight_kg, 0)
         - (COALESCE(SUM(
             rf.quantite_par_format_g
               * CASE rf.quantite_par_format_unite
                   WHEN 'g'  THEN 1
                   WHEN 'kg' THEN 1000
                   WHEN 'ml' THEN 1
                   WHEN 'l'  THEN 1000
                   ELSE 1
                 END
               * rf.nb_par_defaut
           ), 0) / 1000.0) AS perte_kg,
       CASE WHEN COALESCE(vtw.total_weight_kg, 0) > 0
            THEN ((COALESCE(vtw.total_weight_kg, 0)
                   - (COALESCE(SUM(
                       rf.quantite_par_format_g
                         * CASE rf.quantite_par_format_unite
                             WHEN 'g'  THEN 1
                             WHEN 'kg' THEN 1000
                             WHEN 'ml' THEN 1
                             WHEN 'l'  THEN 1000
                             ELSE 1
                           END
                         * rf.nb_par_defaut
                     ), 0) / 1000.0))
                  / vtw.total_weight_kg) * 100
            ELSE 0
       END AS perte_pct,
       COUNT(rf.id) AS nb_formats
FROM recipes r
LEFT JOIN recipe_formats rf ON rf.recipe_id = r.id
LEFT JOIN v_recipe_total_weight_kg vtw ON vtw.id = r.id
GROUP BY r.id, vtw.total_weight_kg;
