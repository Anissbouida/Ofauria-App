-- Migration 163 : v_plan_item_rendement — croisement theorique / reel / cout par format
--
-- Probleme : on a aujourd'hui :
--   - production_plan_items (planifie : product, format, planned_quantity)
--   - production_rendement   (reel : quantite_brute, quantite_nette_reelle, pertes)
--   - v_recipe_format_cost   (cout previsionnel par format)
--
-- Mais aucune vue qui croise les 3 pour donner par plan_item :
--   theorique brut/net → reel brut/net → ecart → cout previsionnel vs reel
--
-- Cette vue sert l'UI du PlanDetailPage (Phase D) et tout reporting analytique.
--
-- Conventions :
--   - poids_theorique_brut_g = format.qte_par_format (en g via conversion d'unite) × planned_quantity
--   - rendement_brut_%       = quantite_brute_kg / theorique_brut_kg × 100
--   - rendement_net_unites_% = actual_quantity / planned_quantity × 100
--   - cout_prevu_total       = vfc.cout_unitaire_complet × planned_quantity
--   - ecart_cout_estime      = (cout_reel_unite_estime − cout_prevu_unite) × actual_quantity
--     (ou NULL tant que actual_quantity et quantite_brute ne sont pas saisis)
--
-- Pour les plan_items legacy (format_id NULL), on essaie de retomber sur le
-- contenant_id du plan_item lui-meme. Si ni l'un ni l'autre, theorique = NULL.

CREATE OR REPLACE VIEW v_plan_item_rendement AS
WITH plan_format AS (
  -- Pour chaque plan_item, on resout :
  --   - format (recipe_formats) si format_id present
  --   - sinon le contenant legacy (production_contenants direct) si contenant_id present
  -- + recipe_id du produit (via produit_profil_production ou recipes.product_id)
  SELECT ppi.id AS plan_item_id,
         ppi.plan_id,
         ppi.product_id,
         ppi.format_id,
         ppi.contenant_id AS contenant_id_legacy,
         ppi.planned_quantity,
         ppi.actual_quantity,
         ppi.status,
         -- Format (multi-format)
         rf.recipe_id AS recipe_id_via_format,
         rf.quantite_par_format_g,
         rf.quantite_par_format_unite,
         rf.nb_par_defaut,
         pcf.id AS format_contenant_id,
         pcf.nom AS format_nom,
         pcf.seuil_rendement_defaut AS format_seuil_rendement,
         pcf.pertes_fixes AS format_pertes_fixes,
         -- Contenant legacy (si pas de format)
         pcl.nom AS legacy_contenant_nom,
         pcl.seuil_rendement_defaut AS legacy_seuil_rendement
  FROM production_plan_items ppi
  LEFT JOIN recipe_formats rf ON rf.id = ppi.format_id
  LEFT JOIN production_contenants pcf ON pcf.id = rf.contenant_id
  LEFT JOIN production_contenants pcl ON pcl.id = ppi.contenant_id
),
recipe_resolu AS (
  -- Resoud le recipe_id : prioritairement via format, sinon via product_id → recipes.product_id
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

       -- THEORIQUE
       -- Poids brut total attendu (g) : qte_par_format converti en g × planned_quantity
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
         ELSE NULL  -- legacy : pas de poids theorique calculable sans recipe_formats
       END AS theorique_brut_g,
       -- Net theorique = planned × seuil_rendement / 100 (nb unites acceptables attendues)
       CASE
         WHEN rr.format_id IS NOT NULL THEN
           ROUND(rr.planned_quantity * COALESCE(rr.format_seuil_rendement, 90) / 100.0, 2)
         WHEN rr.contenant_id_legacy IS NOT NULL THEN
           ROUND(rr.planned_quantity * COALESCE(rr.legacy_seuil_rendement, 90) / 100.0, 2)
         ELSE NULL
       END AS theorique_net_unites,
       COALESCE(rr.format_seuil_rendement, rr.legacy_seuil_rendement) AS seuil_rendement_pct,

       -- REEL (depuis production_rendement, NULL si pas encore saisi)
       pr.quantite_brute AS quantite_brute_kg,
       pr.quantite_nette_reelle,
       pr.pertes_total,
       pr.pertes_detail,
       pr.recorded_at,

       -- TAUX DE RENDEMENT
       -- Rendement brut % = (quantite_brute_kg × 1000) / theorique_brut_g × 100
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
       -- Rendement net unites % = actual_quantity / planned_quantity × 100
       CASE
         WHEN rr.actual_quantity IS NOT NULL AND rr.planned_quantity > 0 THEN
           rr.actual_quantity::numeric / rr.planned_quantity * 100
         ELSE NULL
       END AS rendement_net_unites_pct,

       -- COUT PREVU (depuis v_recipe_format_cost si format, sinon NULL)
       vfc.cout_unitaire_complet AS cout_prevu_unite,
       CASE
         WHEN vfc.cout_unitaire_complet IS NOT NULL THEN
           vfc.cout_unitaire_complet * rr.planned_quantity
         ELSE NULL
       END AS cout_prevu_total,
       vfc.prix_vente_unitaire AS prix_vente_prevu,

       -- ECART (cout reel estime - cout prevu) — basique, sera affine en Phase D
       -- Approximation : si rendement net < 100%, le cout reel par unite produite augmente.
       -- cout_reel_unite_estime = cout_prevu_unite × planned / actual
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
  'Croise theorique (format/contenant) × reel (production_rendement) × cout previsionnel (v_recipe_format_cost). Une ligne par plan_item.';
