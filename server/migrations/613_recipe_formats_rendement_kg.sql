-- Rendement d'un format en pièces OU en kilos (scénario 1, fiche Baguette / Cornes de gazelle).
--
-- Jusqu'ici le rendement d'un format était un nombre entier de pièces (nb_par_defaut).
-- Un article vendu au poids (cornes de gazelle au kilo, pâte vendue au poids, préparation
-- de base) ne pouvait pas déclarer « cette plaque donne 2,10 kg » : le coût restait par
-- pièce, ou était approché par le poids brut de la composition (sans les pertes).
--
-- Décision (2026-11-19) : au choix, pièces OU kilos, par format.
--   - rendement_unite = 'unit' (défaut) : comportement inchangé, nb_par_defaut pièces ;
--   - rendement_unite = 'kg' : la fournée donne rendement_kg kilos ; tous les coûts « par
--     unité » du format (matière, MO, énergie, structure, prix) deviennent des coûts au kilo.
--     nb_par_defaut est conservé tel quel (non affiché) pour ne pas casser la planification.
--
-- fn_recipe_cost (mig 409), source unique du coût unitaire par format (PDF de fiche, coût
-- théorique de production), divise désormais par rendement_kg pour un format au kilo.
-- Le reste de la fonction est repris à l'identique.
--
-- INVERSION :
--   (recréer fn_recipe_cost depuis 409_fn_recipe_cost.sql)
--   ALTER TABLE recipe_formats DROP CONSTRAINT chk_recipe_formats_rendement_kg_requis,
--     DROP COLUMN rendement_kg, DROP COLUMN rendement_unite;

ALTER TABLE recipe_formats
  ADD COLUMN IF NOT EXISTS rendement_unite varchar(10) NOT NULL DEFAULT 'unit'
    CHECK (rendement_unite IN ('unit', 'kg')),
  ADD COLUMN IF NOT EXISTS rendement_kg numeric(12,3)
    CHECK (rendement_kg IS NULL OR rendement_kg > 0);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_recipe_formats_rendement_kg_requis') THEN
    ALTER TABLE recipe_formats
      ADD CONSTRAINT chk_recipe_formats_rendement_kg_requis
      CHECK (rendement_unite <> 'kg' OR rendement_kg IS NOT NULL);
  END IF;
END $$;

COMMENT ON COLUMN recipe_formats.rendement_unite IS
  'Unité du rendement du format : unit (nb_par_defaut pièces) ou kg (rendement_kg kilos). Mig 613.';
COMMENT ON COLUMN recipe_formats.rendement_kg IS
  'Rendement en kilos d''une fournée quand rendement_unite = kg. Mig 613.';

CREATE OR REPLACE FUNCTION fn_recipe_cost(p_recipe_id uuid, p_format_id uuid)
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
           COALESCE((SELECT sum((s->>'duree_estimee_min')::numeric)
                     FROM jsonb_array_elements(COALESCE(rec.etapes, '[]'::jsonb)) s), 0) AS duree_etapes
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

COMMENT ON FUNCTION fn_recipe_cost(uuid, uuid) IS
  'Coût unitaire unique par (recette, format). Unité = pièce, ou kilo pour un format au kilo (mig 613). Matière = composants du format (perte_pct) ou repli coût recette ; MO = main_oeuvre_min ?? Σ étapes ; prix arrondi (company_settings).';
