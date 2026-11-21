-- 622 — Main-d'œuvre par défaut = temps actif des étapes (scénario 1, constat 110).
--
-- POURQUOI
--   Sans « Temps / fournée » saisi, la main-d'œuvre valait la durée TOTALE des étapes,
--   temps d'attente compris (pointage, apprêt, cuisson, refroidissement) : 162 min sur la
--   Baguette et un prix calculé de 5,01 DH au lieu de 3,01 DH. La vue v_recipe_format_cost
--   ignorait même le temps saisi et prenait toujours la durée totale.
--
-- CE QUI CHANGE
--   - Types d'étape (ref_entries production_step_types) : metadata.attente = true pour les
--     temps où le chef n'est pas mobilisé (pointage, apprêt, cuisson, refroidissement),
--     réglable dans le référentiel.
--   - fn_etapes_duree_active(etapes) : somme des durées des étapes hors attente.
--   - fn_recipe_cost et v_recipe_format_cost : MO = main_oeuvre_min ?? temps actif.
--
-- INVERSION
--   Rejouer fn_recipe_cost de la mig 613 et v_recipe_format_cost de la mig 269 (somme
--   de toutes les étapes), DROP FUNCTION fn_etapes_duree_active, retirer metadata.attente.

UPDATE ref_entries
   SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"attente": true}'::jsonb
 WHERE table_id = 'production_step_types'
   AND code IN ('pointage', 'appret', 'cuisson', 'refroidissement')
   AND NOT (COALESCE(metadata, '{}'::jsonb) ? 'attente');

CREATE OR REPLACE FUNCTION fn_etapes_duree_active(p_etapes jsonb)
RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(NULLIF(s->>'duree_estimee_min', '')::numeric), 0)
    FROM jsonb_array_elements(COALESCE(p_etapes, '[]'::jsonb)) s
   WHERE NOT EXISTS (
     SELECT 1 FROM ref_entries re
      WHERE re.table_id = 'production_step_types'
        AND re.code = s->>'type'
        AND COALESCE((re.metadata->>'attente')::boolean, false))
$$;

COMMENT ON FUNCTION fn_etapes_duree_active(jsonb) IS
  'Durée des étapes hors temps d''attente (types d''étape metadata.attente, mig 622) : main-d''œuvre par défaut.';

CREATE OR REPLACE FUNCTION public.fn_recipe_cost(p_recipe_id uuid, p_format_id uuid)
 RETURNS TABLE(pieces numeric, matiere_u numeric, mo_u numeric, energie_u numeric, struct_u numeric, complet_u numeric, emballage_u numeric, prix_u numeric)
 LANGUAGE sql
 STABLE
AS $function$
  WITH r AS (
    SELECT rec.id,
           rec.compo_par_piece,
           rec.main_oeuvre_min,
           COALESCE(rec.taux_main_oeuvre_dh_h, 0) AS taux_mo,
           COALESCE(rec.cout_energie_fournee, 0)  AS energie_batch,
           COALESCE(rec.taux_frais_structure_pct, 0) AS taux_struct,
           COALESCE(rec.margin_multiplier, 3) AS margin,
           fn_etapes_duree_active(rec.etapes) AS duree_etapes
    FROM recipes rec WHERE rec.id = p_recipe_id
  ),
  f AS (
    SELECT fo.id,
           -- Mig 613 : unités de rendement = kilos pour un format au kilo, sinon pièces.
           CASE WHEN fo.rendement_unite = 'kg' AND fo.rendement_kg > 0
                THEN fo.rendement_kg
                ELSE GREATEST(COALESCE(fo.nb_par_defaut, 1), 1)::numeric END AS pieces,
           COALESCE(fo.cout_emballage_unitaire, 0) AS emb,
           fo.prix_vente_unitaire_override AS ovr,
           COALESCE(fo.margin_multiplier_override, (SELECT margin FROM r)) AS marge
    FROM recipe_formats fo WHERE fo.id = p_format_id AND fo.recipe_id = p_recipe_id
  ),
  -- Matière du lot : composants du format si présents, sinon coût recette (bases legacy).
  mat AS (
    SELECT CASE
             WHEN EXISTS (SELECT 1 FROM recipe_format_components rfc WHERE rfc.format_id = p_format_id)
               THEN (SELECT COALESCE(sum(cc.cout_dh), 0) FROM v_recipe_component_cost cc WHERE cc.format_id = p_format_id)
             ELSE (SELECT COALESCE(vtc.total_cost, 0) FROM v_recipe_total_cost vtc WHERE vtc.id = p_recipe_id)
           END AS material_batch
  ),
  s AS (
    SELECT COALESCE(prix_arrondi_strategie, 'aucun') AS strat,
           COALESCE(prix_arrondi_sens, 'superieur') AS sens
    FROM company_settings WHERE id = 1
  ),
  calc AS (
    SELECT
      f.pieces,
      CASE WHEN r.compo_par_piece THEN mat.material_batch
           ELSE mat.material_batch / f.pieces END AS matiere_u,
      ((COALESCE(r.main_oeuvre_min, r.duree_etapes) / 60.0) * r.taux_mo) / f.pieces AS mo_u,
      r.energie_batch / f.pieces AS energie_u,
      f.emb, f.ovr, f.marge, r.taux_struct,
      COALESCE((SELECT strat FROM s), 'aucun') AS strat,
      COALESCE((SELECT sens FROM s), 'superieur') AS sens
    FROM r, f, mat
  )
  SELECT
    pieces,
    matiere_u,
    mo_u,
    energie_u,
    (matiere_u + mo_u + energie_u) * taux_struct / 100.0 AS struct_u,
    (matiere_u + mo_u + energie_u) * (1 + taux_struct / 100.0) AS complet_u,
    emb AS emballage_u,
    apply_price_rounding(
      CASE WHEN ovr IS NOT NULL THEN ovr
           ELSE (matiere_u + mo_u + energie_u) * (1 + taux_struct / 100.0) * marge END,
      strat, sens) AS prix_u
  FROM calc;
$function$;

CREATE OR REPLACE VIEW v_recipe_format_cost AS
 WITH settings AS (
         SELECT company_settings.prix_arrondi_strategie,
            company_settings.prix_arrondi_sens
           FROM company_settings
          WHERE company_settings.id = 1
         LIMIT 1
        ), format_lines AS (
         SELECT rf.id,
            rf.recipe_id,
            rf.contenant_id,
            rf.quantite_par_format,
            rf.quantite_par_format_unite,
            rf.nb_par_defaut,
            rf.cout_emballage_unitaire,
            rf.ordre,
            rf.is_active,
            rf.prix_vente_unitaire_override,
            rf.margin_multiplier_override,
            rf.quantite_par_format *
                CASE rf.quantite_par_format_unite
                    WHEN 'g'::text THEN 1::numeric
                    WHEN 'kg'::text THEN 1000::numeric
                    WHEN 'ml'::text THEN COALESCE(rf.densite_kg_l, 1::numeric)
                    WHEN 'l'::text THEN COALESCE(rf.densite_kg_l, 1::numeric) * 1000::numeric
                    ELSE 1::numeric
                END * rf.nb_par_defaut::numeric AS poids_format_g
           FROM recipe_formats rf
          WHERE rf.is_active = true
        ), recipe_totals AS (
         SELECT fl.recipe_id,
            sum(fl.poids_format_g) AS poids_utilise_g
           FROM format_lines fl
          GROUP BY fl.recipe_id
        ), recipe_duree AS (
         SELECT r.id AS recipe_id,
            COALESCE(r.main_oeuvre_min::numeric, fn_etapes_duree_active(r.etapes)) AS duree_totale_min
           FROM recipes r
        ), recipe_couts_indirects AS (
         SELECT r.id AS recipe_id,
            rd.duree_totale_min / 60.0 * COALESCE(r.taux_main_oeuvre_dh_h, 0::numeric) AS cout_mo_recette,
            COALESCE(r.cout_energie_fournee, 0::numeric) AS cout_energie_recette,
            (COALESCE(vtc.total_cost, 0::numeric) + rd.duree_totale_min / 60.0 * COALESCE(r.taux_main_oeuvre_dh_h, 0::numeric) + COALESCE(r.cout_energie_fournee, 0::numeric)) * COALESCE(r.taux_frais_structure_pct, 0::numeric) / 100.0 AS cout_struct_recette
           FROM recipes r
             LEFT JOIN recipe_duree rd ON rd.recipe_id = r.id
             LEFT JOIN v_recipe_total_cost vtc ON vtc.id = r.id
        ), format_costs AS (
         SELECT fl.id,
            fl.recipe_id,
            fl.contenant_id,
            fl.quantite_par_format,
            fl.quantite_par_format_unite,
            fl.nb_par_defaut,
            fl.cout_emballage_unitaire,
            fl.ordre,
            fl.is_active,
            fl.prix_vente_unitaire_override,
            fl.margin_multiplier_override,
            fl.poids_format_g,
            rt.poids_utilise_g,
                CASE
                    WHEN COALESCE(rt.poids_utilise_g, 0::numeric) > 0::numeric THEN fl.poids_format_g / rt.poids_utilise_g
                    ELSE 0::numeric
                END AS ratio_poids,
                CASE
                    WHEN COALESCE(rt.poids_utilise_g, 0::numeric) > 0::numeric THEN COALESCE(vtc.total_cost, 0::numeric) * fl.poids_format_g / rt.poids_utilise_g
                    ELSE 0::numeric
                END AS cout_matiere_format,
                CASE
                    WHEN COALESCE(rt.poids_utilise_g, 0::numeric) > 0::numeric THEN ci.cout_mo_recette * fl.poids_format_g / rt.poids_utilise_g
                    ELSE 0::numeric
                END AS cout_mo_format,
                CASE
                    WHEN COALESCE(rt.poids_utilise_g, 0::numeric) > 0::numeric THEN ci.cout_energie_recette * fl.poids_format_g / rt.poids_utilise_g
                    ELSE 0::numeric
                END AS cout_energie_format,
                CASE
                    WHEN COALESCE(rt.poids_utilise_g, 0::numeric) > 0::numeric THEN ci.cout_struct_recette * fl.poids_format_g / rt.poids_utilise_g
                    ELSE 0::numeric
                END AS cout_struct_format,
                CASE
                    WHEN COALESCE(rt.poids_utilise_g, 0::numeric) > 0::numeric AND fl.nb_par_defaut > 0 THEN COALESCE(vtc.total_cost, 0::numeric) * fl.poids_format_g / rt.poids_utilise_g / fl.nb_par_defaut::numeric
                    ELSE 0::numeric
                END AS cout_matiere_unitaire,
                CASE
                    WHEN COALESCE(rt.poids_utilise_g, 0::numeric) > 0::numeric AND fl.nb_par_defaut > 0 THEN (COALESCE(vtc.total_cost, 0::numeric) + ci.cout_mo_recette + ci.cout_energie_recette + ci.cout_struct_recette) * fl.poids_format_g / rt.poids_utilise_g / fl.nb_par_defaut::numeric + fl.cout_emballage_unitaire
                    ELSE fl.cout_emballage_unitaire
                END AS cout_unitaire_complet,
            COALESCE(fl.margin_multiplier_override, r.margin_multiplier, 3::numeric) AS marge_resolue
           FROM format_lines fl
             JOIN recipes r ON r.id = fl.recipe_id
             LEFT JOIN recipe_totals rt ON rt.recipe_id = fl.recipe_id
             LEFT JOIN recipe_couts_indirects ci ON ci.recipe_id = fl.recipe_id
             LEFT JOIN v_recipe_total_cost vtc ON vtc.id = fl.recipe_id
        )
 SELECT fc.id,
    fc.recipe_id,
    fc.contenant_id,
    fc.quantite_par_format,
    fc.quantite_par_format_unite,
    fc.nb_par_defaut,
    fc.cout_emballage_unitaire,
    fc.ordre,
    fc.is_active,
    fc.prix_vente_unitaire_override,
    fc.margin_multiplier_override,
    fc.poids_format_g,
    fc.poids_utilise_g,
    fc.ratio_poids,
    fc.cout_matiere_format,
    fc.cout_mo_format,
    fc.cout_energie_format,
    fc.cout_struct_format,
    fc.cout_matiere_unitaire,
    fc.cout_unitaire_complet,
    fc.marge_resolue,
        CASE
            WHEN fc.prix_vente_unitaire_override IS NOT NULL THEN fc.prix_vente_unitaire_override
            ELSE fc.cout_unitaire_complet * fc.marge_resolue
        END AS prix_vente_brut,
    apply_price_rounding(
        CASE
            WHEN fc.prix_vente_unitaire_override IS NOT NULL THEN fc.prix_vente_unitaire_override
            ELSE fc.cout_unitaire_complet * fc.marge_resolue
        END, COALESCE(s.prix_arrondi_strategie, 'aucun'::character varying), COALESCE(s.prix_arrondi_sens, 'superieur'::character varying)) AS prix_vente_unitaire
   FROM format_costs fc
     LEFT JOIN settings s ON true;
