-- ═══════════════════════════════════════════════════════════════════════
-- 656 — Coût prévu d'une ligne de plan : toujours par le format de la fiche
-- ═══════════════════════════════════════════════════════════════════════
-- POURQUOI
--   Au lancement, le coût théorique d'une ligne SANS format passait par
--   « coût de la recette ÷ yield_quantity ». Les fiches « compose » décrivent une
--   fournée et portent le nombre de pièces sur leur format (nb_par_defaut) ;
--   yield_quantity y vaut 1. Résultat : baguette prévue à 92,19 DH (une fournée de
--   120) au lieu de 0,77 DH, et un écart « réel / prévu » de −97 % sur tous les
--   plans de pain. Les besoins en matières (bons de sortie), eux, divisaient déjà
--   par les pièces du format : seul le coût était faux.
--
-- QUOI
--   1. fn_plan_item_theo(ligne) : coût unitaire théorique d'une ligne de plan par
--      fn_recipe_cost, sur le format de la ligne, sinon le format lié au produit,
--      sinon le format par défaut de la fiche ; « recette ÷ rendement » seulement
--      pour une fiche sans format. Utilisée au lancement et par le calcul du coût.
--   2. Les coûts prévus déjà figés et manifestement faux (plus du double du coût par
--      format) sont refigés, et le prévu des plans chiffrés concernés recalculé.
--
-- INVERSION
--   DROP FUNCTION fn_plan_item_theo(uuid) ; les valeurs refigées ne se restaurent pas
--   (elles étaient fausses).
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_plan_item_theo(p_item uuid)
RETURNS TABLE (matiere_u numeric, complet_u numeric, prix_u numeric, source text)
LANGUAGE sql STABLE AS $$
  WITH it AS (
    SELECT ppi.product_id, ppi.format_id, ppi.alt_recipe_id FROM production_plan_items ppi WHERE ppi.id = p_item
  ), rec AS (
    SELECT COALESCE(it.alt_recipe_id,
             (SELECT r.id FROM recipes r WHERE r.product_id = it.product_id ORDER BY r.archived_at NULLS FIRST LIMIT 1),
             (SELECT rf.recipe_id FROM recipe_formats rf WHERE rf.product_id = it.product_id AND rf.is_active LIMIT 1)) AS recipe_id,
           it.format_id, it.product_id
      FROM it
  ), fmt AS (
    SELECT rec.recipe_id,
           COALESCE(
             (SELECT f.id FROM recipe_formats f WHERE f.id = rec.format_id AND f.recipe_id = rec.recipe_id),
             (SELECT f.id FROM recipe_formats f WHERE f.recipe_id = rec.recipe_id AND f.product_id = rec.product_id AND f.is_active LIMIT 1),
             (SELECT f.id FROM recipe_formats f WHERE f.recipe_id = rec.recipe_id AND f.is_active ORDER BY f.is_default DESC, f.ordre LIMIT 1)
           ) AS format_id
      FROM rec WHERE rec.recipe_id IS NOT NULL
  )
  SELECT * FROM (
    SELECT fc.matiere_u, fc.complet_u + fc.emballage_u, fc.prix_u, 'fn_recipe_cost'::text
      FROM fmt CROSS JOIN LATERAL fn_recipe_cost(fmt.recipe_id, fmt.format_id) fc
     WHERE fmt.format_id IS NOT NULL
    UNION ALL
    SELECT vtc.total_cost / r.yield_quantity, vtc.total_cost / r.yield_quantity, NULL::numeric, 'v_recipe_total_cost_v2'::text
      FROM fmt JOIN recipes r ON r.id = fmt.recipe_id
      LEFT JOIN v_recipe_total_cost_v2 vtc ON vtc.id = r.id
     WHERE fmt.format_id IS NULL AND r.yield_quantity > 0
  ) x LIMIT 1
$$;
COMMENT ON FUNCTION fn_plan_item_theo(uuid) IS
  'Mig 656 : coût unitaire théorique d''une ligne de plan (matière, complet = fiche + emballage, prix) par le format de la fiche ; recette ÷ rendement seulement sans format.';

-- Refigeage des coûts prévus faux (legacy ÷ yield_quantity sur une fiche à format).
-- Deux instructions : une même instruction lirait les lignes avant leur mise à jour.
CREATE TEMP TABLE tmp_656_plans (plan_id uuid PRIMARY KEY) ON COMMIT DROP;

WITH fix AS (
  SELECT ppi.id, t.matiere_u, t.complet_u, t.prix_u
    FROM production_plan_items ppi
    CROSS JOIN LATERAL fn_plan_item_theo(ppi.id) t
   WHERE ppi.theo_snapshot_at IS NOT NULL
     AND ppi.theo_source_view = 'v_recipe_total_cost_v2'
     AND t.source = 'fn_recipe_cost'
     AND t.matiere_u > 0
     AND ppi.theo_cout_matiere_u > 2 * t.matiere_u
), upd AS (
  UPDATE production_plan_items ppi
     SET theo_cout_matiere_u = fix.matiere_u, theo_cout_complet_u = fix.complet_u,
         theo_prix_u = COALESCE(ppi.theo_prix_u, fix.prix_u), theo_source_view = 'fn_recipe_cost'
    FROM fix WHERE fix.id = ppi.id
  RETURNING ppi.plan_id
)
INSERT INTO tmp_656_plans SELECT DISTINCT plan_id FROM upd ON CONFLICT DO NOTHING;

UPDATE production_cout_reel pcr
   SET cout_prevu = p.prevu, cout_prevu_mix_reel = p.mix,
       ecart_mix = ROUND(p.prevu - p.mix, 2),
       ecart_pct = CASE WHEN p.prevu > 0 THEN ROUND((pcr.cout_total - p.prevu) / p.prevu * 100, 2) END,
       updated_at = now()
  FROM (
    SELECT ppi.plan_id,
           ROUND(SUM(ppi.theo_cout_complet_u * ppi.planned_quantity), 2) AS prevu,
           ROUND(SUM(ppi.theo_cout_complet_u * COALESCE(ppi.actual_quantity, ppi.planned_quantity)), 2) AS mix
      FROM production_plan_items ppi JOIN tmp_656_plans t ON t.plan_id = ppi.plan_id
     WHERE ppi.status <> 'cancelled'
     GROUP BY ppi.plan_id
  ) p
 WHERE pcr.plan_id = p.plan_id;
