-- 409 (L2, étape 1) : fonction de coût UNIQUE par (recette, format).
--
-- Source de vérité unique du coût par pièce d'un format, pour TOUTES les recettes
-- (produits composés ET préparations de base de l'ancien modèle). Reproduit la
-- logique de computeFinance / v_recipe_format_cost sur les données actuelles, mais
-- en calculant la matière à partir des VRAIS composants du format (pas d'une
-- répartition au prorata du poids, fausse dès qu'une recette a plusieurs formats).
--
--   - matière batch = Σ composants DU FORMAT (v_recipe_component_cost, avec perte_pct
--     mig 408) si le format en a ; SINON repli sur le coût recette (v_recipe_total_cost)
--     pour les bases encore en ancien modèle (recipe_ingredients) ;
--   - matière/pièce = matière batch ÷ rendement du format (nb_par_defaut), sauf si la
--     composition est saisie « par pièce » (compo_par_piece) ;
--   - MO = (durée/60 × taux) ÷ rendement, durée = main_oeuvre_min saisi sinon Σ étapes ;
--   - énergie = cout_energie_fournee ÷ rendement ;
--   - structure = (matière+MO+énergie) × taux_structure% ; complet = base + structure ;
--   - prix = override, sinon complet × marge, puis arrondi selon company_settings.
--
-- L'emballage (emballage_u) est exposé à part : « complet » ne l'inclut pas (comme
-- l'éditeur) ; les consommateurs qui veulent le coût emballé l'ajoutent (ex. figeage
-- theo_*). Additive : les branchements (theo_*, client) suivent.
CREATE OR REPLACE FUNCTION fn_recipe_cost(p_recipe_id uuid, p_format_id uuid)
RETURNS TABLE(
  pieces         numeric,
  matiere_u      numeric,
  mo_u           numeric,
  energie_u      numeric,
  struct_u       numeric,
  complet_u      numeric,
  emballage_u    numeric,
  prix_u         numeric
)
LANGUAGE sql STABLE AS $$
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
           GREATEST(COALESCE(fo.nb_par_defaut, 1), 1) AS pieces,
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
$$;

COMMENT ON FUNCTION fn_recipe_cost(uuid, uuid) IS
  'L2 : coût unitaire unique par (recette, format), produits composés ET bases legacy. Matière = composants du format (perte_pct) ou repli coût recette ; MO = main_oeuvre_min ?? Σ étapes ; prix arrondi (company_settings). Additive — branchements theo_*/client à venir.';
