-- Migration 160 : v_recipe_format_cost v2 — Frais indirects par format
--
-- Probleme : la vue v_recipe_format_cost (mig 158) ne calcule que le cout
-- matiere. Suite a la migration 159 (frais indirects), on doit l'etendre pour
-- exposer la ventilation complete :
--   - cout matiere       (deja la)
--   - cout main d'oeuvre (nouveau)
--   - cout energie       (nouveau)
--   - cout structure     (nouveau, % sur les 3 ci-dessus)
--   - cout complet       (total)
--   - prix vente         (cout complet × marge)
--
-- Calcul :
--   duree_totale_min        = SUM des etapes (jsonb)
--   cout_mo_recette         = duree_totale_min/60 × taux_main_oeuvre_dh_h
--   cout_energie_recette    = cout_energie_fournee
--   cout_struct_recette     = (cout_matiere_recette + cout_mo + cout_energie) × pct/100
--
-- Pour un format donne :
--   ratio_poids = poids_format_g / poids_utilise_g
--   cout_mo_format        = cout_mo_recette × ratio_poids
--   cout_energie_format   = cout_energie_recette × ratio_poids
--   cout_struct_format    = cout_struct_recette × ratio_poids
--   cout_complet_unitaire = (cout_matiere + cout_mo + cout_energie + cout_struct + cout_emballage) / nb
--
-- La ventilation au prorata du poids reste discutable (en pratique la MO est
-- souvent egale pour toute la fournee quelle que soit la taille des formats),
-- mais c'est coherent avec la regle matiere et reste ajustable plus tard.

-- CREATE OR REPLACE VIEW interdit la modification de l'ordre des colonnes.
-- On DROP et recree pour ajouter les colonnes indirects.
DROP VIEW IF EXISTS v_recipe_format_cost;
CREATE VIEW v_recipe_format_cost AS
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
),
recipe_duree AS (
  -- Duree totale des etapes (somme des duree_estimee_min). NULL → 0.
  SELECT r.id AS recipe_id,
         COALESCE(SUM((step->>'duree_estimee_min')::numeric), 0) AS duree_totale_min
  FROM recipes r
  LEFT JOIN LATERAL jsonb_array_elements(COALESCE(r.etapes, '[]'::jsonb)) AS step ON true
  GROUP BY r.id
),
recipe_couts_indirects AS (
  -- Couts MO/energie/structure agreges au niveau recette
  SELECT r.id AS recipe_id,
         (rd.duree_totale_min / 60.0) * COALESCE(r.taux_main_oeuvre_dh_h, 0) AS cout_mo_recette,
         COALESCE(r.cout_energie_fournee, 0) AS cout_energie_recette,
         -- Frais structure : % sur (matiere + MO + energie)
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
       fl.nb_par_defaut,
       fl.cout_emballage_unitaire,
       fl.ordre,
       fl.is_active,
       fl.poids_format_g,
       rt.poids_utilise_g,
       -- Ratio de proration au poids
       CASE WHEN COALESCE(rt.poids_utilise_g, 0) > 0
            THEN fl.poids_format_g / rt.poids_utilise_g
            ELSE 0
       END AS ratio_poids,
       -- Cout matiere alloue a ce format (proportionnel au poids)
       CASE WHEN COALESCE(rt.poids_utilise_g, 0) > 0
            THEN COALESCE(vtc.total_cost, 0) * fl.poids_format_g / rt.poids_utilise_g
            ELSE 0
       END AS cout_matiere_format,
       -- Ventilation indirects au prorata du poids (meme regle que matiere)
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
       -- Cout matiere par unite (legacy : reste expose pour compat)
       CASE WHEN COALESCE(rt.poids_utilise_g, 0) > 0 AND fl.nb_par_defaut > 0
            THEN (COALESCE(vtc.total_cost, 0) * fl.poids_format_g / rt.poids_utilise_g) / fl.nb_par_defaut
            ELSE 0
       END AS cout_matiere_unitaire,
       -- Cout complet par unite = (matiere + MO + energie + struct) prorate + emballage
       CASE WHEN COALESCE(rt.poids_utilise_g, 0) > 0 AND fl.nb_par_defaut > 0
            THEN ((COALESCE(vtc.total_cost, 0)
                    + ci.cout_mo_recette
                    + ci.cout_energie_recette
                    + ci.cout_struct_recette
                  ) * fl.poids_format_g / rt.poids_utilise_g) / fl.nb_par_defaut
                 + fl.cout_emballage_unitaire
            ELSE fl.cout_emballage_unitaire
       END AS cout_unitaire_complet,
       -- Prix de vente unitaire = cout complet * marge recette
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

COMMENT ON VIEW v_recipe_format_cost IS
  'Cout par format (matiere + MO + energie + structure + emballage) recalcule a la volee. Tous les indirects sont prorates au poids du format.';
