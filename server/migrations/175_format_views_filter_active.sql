-- Migration 175 : Filtrer recipe_formats.is_active = true dans les vues.
--
-- Suite a l'ajout du soft-delete des formats dans recipe.repository.ts.update()
-- (mig accompagnante), les formats inactifs sont conserves en DB pour preserver
-- les plan_items historiques. Mais ils ne doivent PAS apparaitre dans :
--   - le sommaire de poids alloue (v_recipe_format_summary)
--   - les couts/prix actuels par format (v_recipe_format_cost)
--
-- Sans ce filtre, on a un faux "sur-allocation" et des prix fantomes pour les
-- formats supprimes logiquement.
--
-- Note : v_plan_item_rendement reste exposee (recreee a l'identique) car elle
-- JOIN v_recipe_format_cost par format_id ; les plan_items historiques avec un
-- format_id devenu inactif perdent leur ligne dans v_recipe_format_cost. C'est
-- acceptable car le cout reel des productions est deja stocke dans
-- production_cout_reel.

-- ─── 1. v_recipe_format_summary ───
DROP VIEW IF EXISTS v_recipe_format_summary;
CREATE VIEW v_recipe_format_summary AS
SELECT r.id AS recipe_id,
       COALESCE(vtw.total_weight_kg, 0::numeric) AS poids_calcule_kg,
       COALESCE(SUM(
         rf.quantite_par_format_g
           * CASE rf.quantite_par_format_unite
               WHEN 'g'::text  THEN 1
               WHEN 'kg'::text THEN 1000
               WHEN 'ml'::text THEN 1
               WHEN 'l'::text  THEN 1000
               ELSE 1
             END::numeric
           * rf.nb_par_defaut::numeric
       ), 0::numeric) / 1000.0 AS poids_utilise_kg,
       COALESCE(vtw.total_weight_kg, 0::numeric) - COALESCE(SUM(
         rf.quantite_par_format_g
           * CASE rf.quantite_par_format_unite
               WHEN 'g'::text  THEN 1
               WHEN 'kg'::text THEN 1000
               WHEN 'ml'::text THEN 1
               WHEN 'l'::text  THEN 1000
               ELSE 1
             END::numeric
           * rf.nb_par_defaut::numeric
       ), 0::numeric) / 1000.0 AS perte_kg,
       CASE
         WHEN COALESCE(vtw.total_weight_kg, 0::numeric) > 0::numeric THEN
           (COALESCE(vtw.total_weight_kg, 0::numeric) - COALESCE(SUM(
             rf.quantite_par_format_g
               * CASE rf.quantite_par_format_unite
                   WHEN 'g'::text  THEN 1
                   WHEN 'kg'::text THEN 1000
                   WHEN 'ml'::text THEN 1
                   WHEN 'l'::text  THEN 1000
                   ELSE 1
                 END::numeric
               * rf.nb_par_defaut::numeric
           ), 0::numeric) / 1000.0) / vtw.total_weight_kg * 100::numeric
         ELSE 0::numeric
       END AS perte_pct,
       COUNT(rf.id) AS nb_formats
FROM recipes r
LEFT JOIN recipe_formats rf ON rf.recipe_id = r.id AND rf.is_active = true
LEFT JOIN v_recipe_total_weight_kg vtw ON vtw.id = r.id
GROUP BY r.id, vtw.total_weight_kg;

COMMENT ON VIEW v_recipe_format_summary IS
  'Sommaire poids alloue aux formats actifs (is_active=true). Filtre ajoute en mig 175.';

-- ─── 2. v_recipe_format_cost (avec dependance v_plan_item_rendement) ───
DROP VIEW IF EXISTS v_recipe_format_cost CASCADE;
CREATE VIEW v_recipe_format_cost AS
WITH settings AS (
  SELECT prix_arrondi_strategie, prix_arrondi_sens
  FROM company_settings WHERE id = 1 LIMIT 1
),
format_lines AS (
  SELECT rf.id, rf.recipe_id, rf.contenant_id,
         rf.quantite_par_format_g, rf.quantite_par_format_unite,
         rf.nb_par_defaut, rf.cout_emballage_unitaire, rf.ordre, rf.is_active,
         rf.prix_vente_unitaire_override, rf.margin_multiplier_override,
         (rf.quantite_par_format_g
            * CASE rf.quantite_par_format_unite
                WHEN 'g'  THEN 1 WHEN 'kg' THEN 1000
                WHEN 'ml' THEN 1 WHEN 'l'  THEN 1000
                ELSE 1
              END
            * rf.nb_par_defaut) AS poids_format_g
  FROM recipe_formats rf
  WHERE rf.is_active = true     -- mig 175 : exclure les formats soft-deletes
),
recipe_totals AS (
  SELECT fl.recipe_id, SUM(fl.poids_format_g) AS poids_utilise_g
  FROM format_lines fl GROUP BY fl.recipe_id
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
),
format_costs AS (
  SELECT fl.id, fl.recipe_id, fl.contenant_id, fl.quantite_par_format_g, fl.quantite_par_format_unite,
         fl.nb_par_defaut, fl.cout_emballage_unitaire, fl.ordre, fl.is_active,
         fl.prix_vente_unitaire_override, fl.margin_multiplier_override,
         fl.poids_format_g, rt.poids_utilise_g,
         CASE WHEN COALESCE(rt.poids_utilise_g, 0) > 0
              THEN fl.poids_format_g / rt.poids_utilise_g ELSE 0
         END AS ratio_poids,
         CASE WHEN COALESCE(rt.poids_utilise_g, 0) > 0
              THEN COALESCE(vtc.total_cost, 0) * fl.poids_format_g / rt.poids_utilise_g ELSE 0
         END AS cout_matiere_format,
         CASE WHEN COALESCE(rt.poids_utilise_g, 0) > 0
              THEN ci.cout_mo_recette * fl.poids_format_g / rt.poids_utilise_g ELSE 0
         END AS cout_mo_format,
         CASE WHEN COALESCE(rt.poids_utilise_g, 0) > 0
              THEN ci.cout_energie_recette * fl.poids_format_g / rt.poids_utilise_g ELSE 0
         END AS cout_energie_format,
         CASE WHEN COALESCE(rt.poids_utilise_g, 0) > 0
              THEN ci.cout_struct_recette * fl.poids_format_g / rt.poids_utilise_g ELSE 0
         END AS cout_struct_format,
         CASE WHEN COALESCE(rt.poids_utilise_g, 0) > 0 AND fl.nb_par_defaut > 0
              THEN (COALESCE(vtc.total_cost, 0) * fl.poids_format_g / rt.poids_utilise_g) / fl.nb_par_defaut ELSE 0
         END AS cout_matiere_unitaire,
         CASE WHEN COALESCE(rt.poids_utilise_g, 0) > 0 AND fl.nb_par_defaut > 0
              THEN ((COALESCE(vtc.total_cost, 0) + ci.cout_mo_recette + ci.cout_energie_recette + ci.cout_struct_recette
                    ) * fl.poids_format_g / rt.poids_utilise_g) / fl.nb_par_defaut + fl.cout_emballage_unitaire
              ELSE fl.cout_emballage_unitaire
         END AS cout_unitaire_complet,
         COALESCE(fl.margin_multiplier_override, r.margin_multiplier, 3) AS marge_resolue
  FROM format_lines fl
  JOIN recipes r ON r.id = fl.recipe_id
  LEFT JOIN recipe_totals rt ON rt.recipe_id = fl.recipe_id
  LEFT JOIN recipe_couts_indirects ci ON ci.recipe_id = fl.recipe_id
  LEFT JOIN v_recipe_total_cost vtc ON vtc.id = fl.recipe_id
)
SELECT fc.id, fc.recipe_id, fc.contenant_id, fc.quantite_par_format_g, fc.quantite_par_format_unite,
       fc.nb_par_defaut, fc.cout_emballage_unitaire, fc.ordre, fc.is_active,
       fc.prix_vente_unitaire_override, fc.margin_multiplier_override,
       fc.poids_format_g, fc.poids_utilise_g, fc.ratio_poids,
       fc.cout_matiere_format, fc.cout_mo_format, fc.cout_energie_format, fc.cout_struct_format,
       fc.cout_matiere_unitaire, fc.cout_unitaire_complet, fc.marge_resolue,
       CASE
         WHEN fc.prix_vente_unitaire_override IS NOT NULL THEN fc.prix_vente_unitaire_override
         ELSE fc.cout_unitaire_complet * fc.marge_resolue
       END AS prix_vente_brut,
       apply_price_rounding(
         CASE
           WHEN fc.prix_vente_unitaire_override IS NOT NULL THEN fc.prix_vente_unitaire_override
           ELSE fc.cout_unitaire_complet * fc.marge_resolue
         END,
         COALESCE(s.prix_arrondi_strategie, 'aucun'),
         COALESCE(s.prix_arrondi_sens, 'superieur')
       ) AS prix_vente_unitaire
FROM format_costs fc
LEFT JOIN settings s ON true;

COMMENT ON VIEW v_recipe_format_cost IS
  'mig 175 : ajoute filter is_active=true sur format_lines. Les formats inactifs ne sont plus exposes dans les calculs courants.';

-- ─── 3. Recreer v_plan_item_rendement (drop par CASCADE ci-dessus) ───
CREATE VIEW v_plan_item_rendement AS
WITH plan_format AS (
  SELECT ppi.id AS plan_item_id, ppi.plan_id, ppi.product_id, ppi.format_id,
         ppi.contenant_id AS contenant_id_legacy, ppi.planned_quantity, ppi.actual_quantity, ppi.status,
         rf.recipe_id AS recipe_id_via_format,
         rf.quantite_par_format_g, rf.quantite_par_format_unite, rf.nb_par_defaut,
         pcf.id AS format_contenant_id, pcf.nom AS format_nom,
         pcf.seuil_rendement_defaut AS format_seuil_rendement,
         pcf.pertes_fixes AS format_pertes_fixes,
         pcl.nom AS legacy_contenant_nom,
         pcl.seuil_rendement_defaut AS legacy_seuil_rendement
  FROM production_plan_items ppi
  LEFT JOIN recipe_formats rf ON rf.id = ppi.format_id
  LEFT JOIN production_contenants pcf ON pcf.id = rf.contenant_id
  LEFT JOIN production_contenants pcl ON pcl.id = ppi.contenant_id
),
recipe_resolu AS (
  SELECT pf.*, COALESCE(pf.recipe_id_via_format, r.id) AS recipe_id
  FROM plan_format pf
  LEFT JOIN recipes r ON r.product_id = pf.product_id AND r.is_base = false
)
SELECT rr.plan_item_id, rr.plan_id, rr.product_id, rr.recipe_id, rr.format_id, rr.format_nom,
       rr.legacy_contenant_nom, rr.planned_quantity, rr.actual_quantity, rr.status,
       CASE WHEN rr.format_id IS NOT NULL THEN
         rr.quantite_par_format_g * CASE rr.quantite_par_format_unite
           WHEN 'g' THEN 1 WHEN 'kg' THEN 1000 WHEN 'ml' THEN 1 WHEN 'l' THEN 1000 ELSE 1 END
         * rr.planned_quantity
       ELSE NULL END AS theorique_brut_g,
       CASE WHEN rr.format_id IS NOT NULL THEN
         ROUND(rr.planned_quantity * COALESCE(rr.format_seuil_rendement, 90) / 100.0, 2)
       WHEN rr.contenant_id_legacy IS NOT NULL THEN
         ROUND(rr.planned_quantity * COALESCE(rr.legacy_seuil_rendement, 90) / 100.0, 2)
       ELSE NULL END AS theorique_net_unites,
       COALESCE(rr.format_seuil_rendement, rr.legacy_seuil_rendement) AS seuil_rendement_pct,
       pr.quantite_brute AS quantite_brute_kg, pr.quantite_nette_reelle,
       pr.pertes_total, pr.pertes_detail, pr.recorded_at,
       CASE WHEN pr.quantite_brute IS NOT NULL AND rr.format_id IS NOT NULL
              AND rr.quantite_par_format_g > 0 AND rr.planned_quantity > 0 THEN
         (pr.quantite_brute * 1000) / (rr.quantite_par_format_g
           * CASE rr.quantite_par_format_unite
               WHEN 'g' THEN 1 WHEN 'kg' THEN 1000 WHEN 'ml' THEN 1 WHEN 'l' THEN 1000 ELSE 1 END
           * rr.planned_quantity) * 100
       ELSE NULL END AS rendement_brut_pct,
       CASE WHEN rr.actual_quantity IS NOT NULL AND rr.planned_quantity > 0 THEN
         rr.actual_quantity::numeric / rr.planned_quantity * 100
       ELSE NULL END AS rendement_net_unites_pct,
       vfc.cout_unitaire_complet AS cout_prevu_unite,
       CASE WHEN vfc.cout_unitaire_complet IS NOT NULL THEN
         vfc.cout_unitaire_complet * rr.planned_quantity ELSE NULL END AS cout_prevu_total,
       vfc.prix_vente_unitaire AS prix_vente_prevu,
       CASE WHEN vfc.cout_unitaire_complet IS NOT NULL
              AND rr.actual_quantity IS NOT NULL AND rr.actual_quantity > 0 THEN
         vfc.cout_unitaire_complet * rr.planned_quantity / rr.actual_quantity
       ELSE NULL END AS cout_reel_unite_estime,
       CASE WHEN vfc.cout_unitaire_complet IS NOT NULL
              AND rr.actual_quantity IS NOT NULL AND rr.actual_quantity > 0 THEN
         (vfc.cout_unitaire_complet * rr.planned_quantity / rr.actual_quantity
           - vfc.cout_unitaire_complet) * rr.actual_quantity
       ELSE NULL END AS ecart_cout_estime
FROM recipe_resolu rr
LEFT JOIN production_rendement pr ON pr.plan_item_id = rr.plan_item_id
LEFT JOIN v_recipe_format_cost vfc ON vfc.id = rr.format_id;

COMMENT ON VIEW v_plan_item_rendement IS
  'Recreee mig 175 apres DROP CASCADE de v_recipe_format_cost. Les plan_items pointant vers un format soft-delete perdent leur ligne dans vfc (acceptable car production_cout_reel stocke deja le cout reel historique).';
