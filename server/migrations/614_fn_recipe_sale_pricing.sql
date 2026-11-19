-- Prix de vente et coût de revient d'un produit fabriqué, depuis SA fiche (scénario 1,
-- constat 29).
--
-- Le formulaire produit calculait le coût de revient sur la matière seule (Baguette :
-- 0,92 DH) et le prix = matière × multiplicateur (2,75 DH), alors que la fiche technique
-- calcule un coût de production complet (matière + main-d'œuvre + énergie + structure,
-- 1,05 DH) et un prix conseillé de 3,16 DH. Deux écrans, deux prix pour le même article.
-- La synchro serveur (recipe.repository syncProductPrice), déclenchée quand le coût
-- d'une matière ou d'une base change, faisait de même avec le rendement global de la
-- recette (1 pour une fiche composée par format) : elle aurait réécrit le prix d'un
-- produit avec le coût de toute la fournée.
--
-- Source unique : fn_recipe_cost (mig 409, 613) sur le format par défaut, ramené à
-- l'unité de vente du produit :
--   - à la pièce : coût complet et prix de la fiche (prix arrondi selon les réglages) ;
--   - au kilo : format au kilo (mig 613) → tels quels ; sinon coût de la fournée ÷ poids
--     brut de la fournée (composition : masse, volume × masse volumique, pièce × poids
--     par pièce ; ligne écartée sinon), prix ré-arrondi au kilo.
-- Le prix est HORS TAXES, comme sur la fiche.
--
-- Aucune ligne si la fiche n'a pas de format actif (ancienne composition) : les appelants
-- gardent alors leur calcul historique.
--
-- INVERSION : DROP FUNCTION fn_recipe_sale_pricing(uuid);

CREATE OR REPLACE FUNCTION fn_recipe_sale_pricing(p_recipe_id uuid)
 RETURNS TABLE(format_id uuid, cout_piece numeric, prix_piece numeric,
               cout_kg numeric, prix_kg numeric, poids_brut_kg numeric)
 LANGUAGE sql
 STABLE
AS $function$
  WITH df AS (
    SELECT rf.id, rf.nb_par_defaut, r.compo_par_piece,
           (rf.rendement_unite = 'kg' AND COALESCE(rf.rendement_kg, 0) > 0
            AND r.compo_par_piece IS NOT TRUE) AS en_kg,
           rf.rendement_kg
      FROM recipe_formats rf
      JOIN recipes r ON r.id = rf.recipe_id
     WHERE rf.recipe_id = p_recipe_id AND rf.is_active = true
     ORDER BY rf.is_default DESC, rf.ordre
     LIMIT 1
  ),
  -- Poids brut d'une fournée du format, depuis sa composition (même règle que la liste
  -- des fiches avant cette migration).
  w AS (
    SELECT NULLIF(sum(CASE
             WHEN lower(c.unite) = 'mg' THEN c.quantite / 1000000.0
             WHEN lower(c.unite) = 'g'  THEN c.quantite / 1000.0
             WHEN lower(c.unite) = 'kg' THEN c.quantite
             WHEN lower(c.unite) IN ('ml','cl','dl','l') AND COALESCE(i.densite_kg_l, 0) > 0 THEN
               c.quantite * CASE lower(c.unite) WHEN 'ml' THEN 0.001 WHEN 'cl' THEN 0.01 WHEN 'dl' THEN 0.1 ELSE 1 END * i.densite_kg_l
             WHEN lower(c.unite) IN ('unit','unite','unité','u','piece','pièce','pce','pc','pcs') AND COALESCE(i.poids_piece_kg, 0) > 0 THEN
               c.quantite * i.poids_piece_kg
             ELSE NULL END), 0) AS kg
      FROM recipe_format_components c
      LEFT JOIN ingredients i ON i.id = c.source_ingredient_id
     WHERE c.format_id = (SELECT id FROM df)
  ),
  s AS (
    SELECT COALESCE(prix_arrondi_strategie, 'aucun') AS strat,
           COALESCE(prix_arrondi_sens, 'superieur') AS sens
      FROM company_settings WHERE id = 1
  ),
  b AS (
    SELECT df.id, df.nb_par_defaut, df.compo_par_piece, df.en_kg, df.rendement_kg,
           fc.pieces, fc.complet_u, fc.prix_u, w.kg AS poids,
           COALESCE(s.strat, 'aucun') AS strat, COALESCE(s.sens, 'superieur') AS sens,
           -- Unités de composition dans la fournée pesée : 1 si la composition est
           -- saisie pour une pièce, sinon le rendement en pièces.
           CASE WHEN df.compo_par_piece THEN 1 ELSE fc.pieces END AS lot
      FROM df
      CROSS JOIN LATERAL fn_recipe_cost(p_recipe_id, df.id) fc
      CROSS JOIN w
      LEFT JOIN s ON true
  )
  SELECT
    id,
    CASE WHEN en_kg THEN CASE WHEN nb_par_defaut > 0 THEN complet_u * rendement_kg / nb_par_defaut END
         ELSE complet_u END,
    CASE WHEN en_kg THEN CASE WHEN nb_par_defaut > 0 THEN apply_price_rounding(prix_u * rendement_kg / nb_par_defaut, strat, sens) END
         ELSE prix_u END,
    CASE WHEN en_kg THEN complet_u
         WHEN poids IS NULL THEN NULL
         ELSE complet_u * lot / poids END,
    CASE WHEN en_kg THEN prix_u
         WHEN poids IS NULL THEN NULL
         ELSE apply_price_rounding(prix_u * lot / poids, strat, sens) END,
    poids
  FROM b;
$function$;

COMMENT ON FUNCTION fn_recipe_sale_pricing(uuid) IS
  'Coût complet et prix HT d''un produit fabriqué depuis le format par défaut de sa fiche, à la pièce et au kilo (fn_recipe_cost). Mig 614, constat 29 du scénario 1.';
