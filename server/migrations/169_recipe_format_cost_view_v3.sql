-- Migration 169 : v_recipe_format_cost v3 — Resolution des overrides
--
-- Suite a la migration 168 (overrides par format), la vue doit appliquer la
-- regle de priorite suivante pour le prix de vente :
--
--   1) Si recipe_formats.prix_vente_unitaire_override est renseigne -> ce prix
--   2) Sinon : cout_unitaire_complet × COALESCE(margin_multiplier_override, recipes.margin_multiplier)
--
-- Pas d'arrondi a cette etape : c'est la migration 170 qui ajoutera la fonction
-- apply_price_rounding() et l'utilisera ici.
--
-- Structure identique a la v2 (mig 162), seule la colonne prix_vente_unitaire
-- change. Toutes les autres colonnes (cout_matiere, cout_mo, etc.) restent
-- identiques pour ne pas casser les composants existants qui les lisent.

-- v_plan_item_rendement (mig 163) depend de v_recipe_format_cost. DROP CASCADE
-- la retire, puis on la recree a l'identique apres la nouvelle vue.
DROP VIEW IF EXISTS v_recipe_format_cost CASCADE;
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
         rf.prix_vente_unitaire_override,
         rf.margin_multiplier_override,
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
),
-- Couts complets par format pour reutilisation dans le calcul prix
format_costs AS (
  SELECT fl.id,
         fl.recipe_id,
         fl.contenant_id,
         fl.quantite_par_format_g,
         fl.quantite_par_format_unite,
         fl.nb_par_defaut,
         fl.cout_emballage_unitaire,
         fl.ordre,
         fl.is_active,
         fl.prix_vente_unitaire_override,
         fl.margin_multiplier_override,
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
         -- Marge resolue : override par format si renseignee, sinon marge recette
         COALESCE(fl.margin_multiplier_override, r.margin_multiplier, 3) AS marge_resolue
  FROM format_lines fl
  JOIN recipes r ON r.id = fl.recipe_id
  LEFT JOIN recipe_totals rt ON rt.recipe_id = fl.recipe_id
  LEFT JOIN recipe_couts_indirects ci ON ci.recipe_id = fl.recipe_id
  LEFT JOIN v_recipe_total_cost vtc ON vtc.id = fl.recipe_id
)
SELECT id,
       recipe_id,
       contenant_id,
       quantite_par_format_g,
       quantite_par_format_unite,
       nb_par_defaut,
       cout_emballage_unitaire,
       ordre,
       is_active,
       prix_vente_unitaire_override,
       margin_multiplier_override,
       poids_format_g,
       poids_utilise_g,
       ratio_poids,
       cout_matiere_format,
       cout_mo_format,
       cout_energie_format,
       cout_struct_format,
       cout_matiere_unitaire,
       cout_unitaire_complet,
       marge_resolue,
       -- Prix de vente final : override prioritaire, sinon cout × marge resolue
       CASE
         WHEN prix_vente_unitaire_override IS NOT NULL
           THEN prix_vente_unitaire_override
         ELSE cout_unitaire_complet * marge_resolue
       END AS prix_vente_unitaire
FROM format_costs;

COMMENT ON VIEW v_recipe_format_cost IS
  'v3 : ajoute la resolution des overrides recipe_formats.prix_vente_unitaire_override et margin_multiplier_override. La marge_resolue est exposee pour debug. Le prix final n''est pas encore arrondi (cf migration 170 + apply_price_rounding).';

-- Re-creer v_plan_item_rendement (drop par CASCADE ci-dessus). Definition
-- IDENTIQUE a migration 163 — aucun changement de semantique. Les colonnes
-- cout_unitaire_complet et prix_vente_unitaire de la nouvelle v_recipe_format_cost
-- sont compatibles avec les usages de v_plan_item_rendement.
CREATE VIEW v_plan_item_rendement AS
WITH plan_format AS (
  SELECT ppi.id AS plan_item_id,
         ppi.plan_id,
         ppi.product_id,
         ppi.format_id,
         ppi.contenant_id AS contenant_id_legacy,
         ppi.planned_quantity,
         ppi.actual_quantity,
         ppi.status,
         rf.recipe_id AS recipe_id_via_format,
         rf.quantite_par_format_g,
         rf.quantite_par_format_unite,
         rf.nb_par_defaut,
         pcf.id AS format_contenant_id,
         pcf.nom AS format_nom,
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
  SELECT pf.*,
         COALESCE(pf.recipe_id_via_format, r.id) AS recipe_id
  FROM plan_format pf
  LEFT JOIN recipes r ON r.product_id = pf.product_id AND r.is_base = false
)
SELECT rr.plan_item_id,
       rr.plan_id,
       rr.product_id,
       rr.recipe_id,
       rr.format_id,
       rr.format_nom,
       rr.legacy_contenant_nom,
       rr.planned_quantity,
       rr.actual_quantity,
       rr.status,
       CASE
         WHEN rr.format_id IS NOT NULL THEN
           rr.quantite_par_format_g
             * CASE rr.quantite_par_format_unite
                 WHEN 'g'  THEN 1
                 WHEN 'kg' THEN 1000
                 WHEN 'ml' THEN 1
                 WHEN 'l'  THEN 1000
                 ELSE 1
               END
             * rr.planned_quantity
         ELSE NULL
       END AS theorique_brut_g,
       CASE
         WHEN rr.format_id IS NOT NULL THEN
           ROUND(rr.planned_quantity * COALESCE(rr.format_seuil_rendement, 90) / 100.0, 2)
         WHEN rr.contenant_id_legacy IS NOT NULL THEN
           ROUND(rr.planned_quantity * COALESCE(rr.legacy_seuil_rendement, 90) / 100.0, 2)
         ELSE NULL
       END AS theorique_net_unites,
       COALESCE(rr.format_seuil_rendement, rr.legacy_seuil_rendement) AS seuil_rendement_pct,
       pr.quantite_brute AS quantite_brute_kg,
       pr.quantite_nette_reelle,
       pr.pertes_total,
       pr.pertes_detail,
       pr.recorded_at,
       CASE
         WHEN pr.quantite_brute IS NOT NULL AND rr.format_id IS NOT NULL
              AND rr.quantite_par_format_g > 0 AND rr.planned_quantity > 0 THEN
           (pr.quantite_brute * 1000)
             / (rr.quantite_par_format_g
                * CASE rr.quantite_par_format_unite
                    WHEN 'g'  THEN 1 WHEN 'kg' THEN 1000
                    WHEN 'ml' THEN 1 WHEN 'l'  THEN 1000
                    ELSE 1
                  END
                * rr.planned_quantity)
             * 100
         ELSE NULL
       END AS rendement_brut_pct,
       CASE
         WHEN rr.actual_quantity IS NOT NULL AND rr.planned_quantity > 0 THEN
           rr.actual_quantity::numeric / rr.planned_quantity * 100
         ELSE NULL
       END AS rendement_net_unites_pct,
       vfc.cout_unitaire_complet AS cout_prevu_unite,
       CASE
         WHEN vfc.cout_unitaire_complet IS NOT NULL THEN
           vfc.cout_unitaire_complet * rr.planned_quantity
         ELSE NULL
       END AS cout_prevu_total,
       vfc.prix_vente_unitaire AS prix_vente_prevu,
       CASE
         WHEN vfc.cout_unitaire_complet IS NOT NULL
              AND rr.actual_quantity IS NOT NULL AND rr.actual_quantity > 0 THEN
           vfc.cout_unitaire_complet * rr.planned_quantity / rr.actual_quantity
         ELSE NULL
       END AS cout_reel_unite_estime,
       CASE
         WHEN vfc.cout_unitaire_complet IS NOT NULL
              AND rr.actual_quantity IS NOT NULL AND rr.actual_quantity > 0 THEN
           (vfc.cout_unitaire_complet * rr.planned_quantity / rr.actual_quantity
             - vfc.cout_unitaire_complet) * rr.actual_quantity
         ELSE NULL
       END AS ecart_cout_estime
FROM recipe_resolu rr
LEFT JOIN production_rendement pr ON pr.plan_item_id = rr.plan_item_id
LEFT JOIN v_recipe_format_cost vfc ON vfc.id = rr.format_id;

COMMENT ON VIEW v_plan_item_rendement IS
  'Croise theorique (format/contenant) × reel (production_rendement) × cout previsionnel (v_recipe_format_cost). Une ligne par plan_item. Recreee identiquement a mig 163 apres DROP CASCADE de v_recipe_format_cost.';
