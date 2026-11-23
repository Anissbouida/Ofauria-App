-- 649 — Retrait de l'ancien modèle de fiche (plan d'exécution multi-industries, étape 2 bis, pas 2b-1).
--
-- POURQUOI
--   La composition d'une fiche existait sous trois formes. L'ancien modèle (recipe_ingredients,
--   recipe_sub_recipes, recipe_packaging, et la surcharge produit_profil_production) n'est
--   plus écrit par l'écran depuis la génération « composants par format », mais les vues de
--   coût, d'explosion et d'allergènes le lisaient encore.
--   Mesure en production (2026-11-23) : seules 33 lignes de recipe_ingredients subsistaient,
--   toutes sur 8 recettes de base ARCHIVÉES le 24/10 dont la version active (même nom, nouveau
--   modèle) a été reprise ce jour-là. Or 19 lignes de nomenclature de 10 fiches actives
--   (Amandine, Opéra noisette, tartes…) pointaient encore vers ces bases archivées : leur coût
--   et leurs allergènes venaient de l'ancien modèle. Décision (utilisateur, 2026-11-23) :
--   repointer ces lignes vers les bases actives.
--
-- CE QUI CHANGE
--   1. Toute ligne de nomenclature qui pointe vers une base archivée sans nomenclature, mais
--      ayant une seule base active du même nom dotée d'une nomenclature, pointe désormais vers
--      celle-ci (quantité et unité inchangées ; le miroir recipe_components suit par trigger).
--   2. Les vues de coût, de poids, d'explosion, d'allergènes et de contrôle d'unités ne lisent
--      plus l'ancien modèle (mêmes colonnes ; résultat identique pour toute fiche sans ligne
--      dans l'ancien modèle, c'est-à-dire toutes les fiches actives après le point 1).
--      v_recipe_direct_cost(_v2) et v_recipe_direct_weight_kg ne portaient QUE l'ancien
--      modèle : elles restent (des vues en dépendent) et valent 0.
--   3. Instantané de nomenclature (fn_recipe_bom_snapshot) : clés ingredients, sub_recipes et
--      packaging conservées, toujours vides ; la restauration (fn_bom_snapshot_apply) ne les
--      rejoue plus. L'anti-cycle des composants (fn_rfc_no_cycle) ignore l'ancien modèle.
--   4. Les quatre tables passent en lecture seule (trigger) ; la suppression reste permise.
--      Elles seront archivées (supprimées) après un cycle d'observation en production.
--
-- RETOUR ARRIÈRE
--   Le repointage est tracé dans recipe_bom_audit (trigger d'audit des composants). Les vues
--   et fonctions se restaurent depuis leurs migrations d'origine (vues : 255/260/321/343/489/
--   515/559/574…) ; DROP TRIGGER trg_legacy_recipe_model_ro ON <table> pour rouvrir l'écriture.

-- 1. Repointage vers les bases actives -------------------------------------------------
WITH legacy AS (
  SELECT r.id, lower(btrim(r.name)) AS nm
    FROM recipes r
   WHERE r.archived_at IS NOT NULL
     AND (EXISTS (SELECT 1 FROM recipe_ingredients ri WHERE ri.recipe_id = r.id)
          OR EXISTS (SELECT 1 FROM recipe_sub_recipes s WHERE s.recipe_id = r.id))
     AND NOT EXISTS (SELECT 1 FROM recipe_format_components fc JOIN recipe_formats f ON f.id = fc.format_id WHERE f.recipe_id = r.id)
), target AS (
  SELECT l.id AS old_id, (array_agg(a.id))[1] AS new_id
    FROM legacy l
    JOIN recipes a ON lower(btrim(a.name)) = l.nm AND a.archived_at IS NULL AND a.id <> l.id
                  AND EXISTS (SELECT 1 FROM recipe_format_components fc JOIN recipe_formats f ON f.id = fc.format_id WHERE f.recipe_id = a.id)
   GROUP BY l.id
  HAVING count(*) = 1
)
UPDATE recipe_format_components fc
   SET source_recipe_id = t.new_id, updated_at = now()
  FROM target t, recipe_formats pf
 WHERE fc.source_recipe_id = t.old_id
   AND pf.id = fc.format_id AND pf.recipe_id <> t.new_id;

-- Miroir : reconstruit par trg_rfc_sync_mirror pour le format par défaut ; les lignes d'un
-- miroir qui pointeraient encore vers une base repointée sont alignées par sécurité.
WITH legacy AS (
  SELECT r.id, lower(btrim(r.name)) AS nm FROM recipes r
   WHERE r.archived_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM recipe_ingredients ri WHERE ri.recipe_id = r.id)
     AND NOT EXISTS (SELECT 1 FROM recipe_format_components fc JOIN recipe_formats f ON f.id = fc.format_id WHERE f.recipe_id = r.id)
), target AS (
  SELECT l.id AS old_id, (array_agg(a.id))[1] AS new_id
    FROM legacy l
    JOIN recipes a ON lower(btrim(a.name)) = l.nm AND a.archived_at IS NULL AND a.id <> l.id
                  AND EXISTS (SELECT 1 FROM recipe_format_components fc JOIN recipe_formats f ON f.id = fc.format_id WHERE f.recipe_id = a.id)
   GROUP BY l.id HAVING count(*) = 1
)
UPDATE recipe_components rc SET source_recipe_id = t.new_id, updated_at = now()
  FROM target t
 WHERE rc.source_recipe_id = t.old_id AND rc.recipe_id <> t.new_id;

-- 2. Vues -------------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_recipe_direct_cost AS
 SELECT r.id, r.yield_quantity, 0::numeric AS direct_cost FROM recipes r;

CREATE OR REPLACE VIEW v_recipe_direct_cost_v2 AS
 SELECT r.id, r.yield_quantity, 0::numeric AS direct_cost FROM recipes r;

CREATE OR REPLACE VIEW v_recipe_direct_weight_kg AS
 SELECT r.id, r.yield_quantity, 0::numeric AS direct_weight_kg FROM recipes r;

CREATE OR REPLACE VIEW v_recipe_total_weight_kg AS
 SELECT r.id, 0::numeric AS total_weight_kg FROM recipes r;

CREATE OR REPLACE VIEW v_recipe_total_cost AS
 WITH RECURSIVE own AS (
   SELECT r.id,
          CASE WHEN r.mode_cout::text = 'compose' THEN COALESCE((
            SELECT sum(c.quantite * fn_unit_conv(c.unite::text, ing.unit::text, ing.densite_kg_l) * COALESCE(ing.unit_cost, 0::numeric)
                       / NULLIF(1::numeric - COALESCE(c.perte_pct, 0::numeric) / 100::numeric, 0::numeric))
              FROM recipe_components c JOIN ingredients ing ON ing.id = c.source_ingredient_id
             WHERE c.recipe_id = r.id AND c.source_ingredient_id IS NOT NULL), 0::numeric)
          ELSE 0::numeric END AS own_cost
     FROM recipes r
 ), edges AS (
   SELECT r.id AS parent, c.source_recipe_id AS child,
          c.quantite * fn_unit_conv(c.unite::text, ch.yield_unit::text)
            / NULLIF(ch.yield_quantity * (1::numeric - COALESCE(ch.perte_standard_pct, 0::numeric) / 100::numeric), 0::numeric)
            / NULLIF(1::numeric - COALESCE(c.perte_pct, 0::numeric) / 100::numeric, 0::numeric) AS frac
     FROM recipes r
     JOIN recipe_components c ON c.recipe_id = r.id AND c.source_recipe_id IS NOT NULL
     JOIN recipes ch ON ch.id = c.source_recipe_id
    WHERE r.mode_cout::text = 'compose'
 ), expand AS (
   SELECT r.id AS root, r.id AS node, 1::numeric AS mult, 0 AS depth FROM recipes r
   UNION ALL
   SELECT e.root, eg.child, e.mult * eg.frac, e.depth + 1
     FROM expand e JOIN edges eg ON eg.parent = e.node WHERE e.depth < 12
 )
 SELECT x.root AS id, sum(o.own_cost * x.mult) AS total_cost
   FROM expand x JOIN own o ON o.id = x.node
  GROUP BY x.root;

CREATE OR REPLACE VIEW v_recipe_total_cost_v2 AS
 WITH RECURSIVE own AS (
   SELECT r.id,
          CASE WHEN r.mode_cout::text = 'compose' THEN COALESCE((
            SELECT sum(c.quantite * fn_convert_factor(c.unite::text, ing.unit::text, 'ingredient'::text, ing.id) * COALESCE(ing.unit_cost, 0::numeric)
                       / NULLIF(1::numeric - COALESCE(c.perte_pct, 0::numeric) / 100::numeric, 0::numeric))
              FROM recipe_components c JOIN ingredients ing ON ing.id = c.source_ingredient_id
             WHERE c.recipe_id = r.id AND c.source_ingredient_id IS NOT NULL), 0::numeric)
          ELSE 0::numeric END AS own_cost
     FROM recipes r
 ), edges AS (
   SELECT r.id AS parent, c.source_recipe_id AS child,
          c.quantite * fn_convert_factor(c.unite::text, ch.yield_unit::text, NULL::text, NULL::uuid)
            / NULLIF(ch.yield_quantity * (1::numeric - COALESCE(ch.perte_standard_pct, 0::numeric) / 100::numeric), 0::numeric)
            / NULLIF(1::numeric - COALESCE(c.perte_pct, 0::numeric) / 100::numeric, 0::numeric) AS frac
     FROM recipes r
     JOIN recipe_components c ON c.recipe_id = r.id AND c.source_recipe_id IS NOT NULL
     JOIN recipes ch ON ch.id = c.source_recipe_id
    WHERE r.mode_cout::text = 'compose'
 ), expand AS (
   SELECT r.id AS root, r.id AS node, 1::numeric AS mult, 0 AS depth FROM recipes r
   UNION ALL
   SELECT e.root, eg.child, e.mult * eg.frac, e.depth + 1
     FROM expand e JOIN edges eg ON eg.parent = e.node WHERE e.depth < 12
 )
 SELECT x.root AS id, sum(o.own_cost * x.mult) AS total_cost
   FROM expand x JOIN own o ON o.id = x.node
  GROUP BY x.root;

CREATE OR REPLACE VIEW v_recipe_explosion AS
 WITH RECURSIVE edges AS (
   SELECT r.id AS parent, c.source_recipe_id AS child,
          c.quantite * fn_unit_conv(c.unite::text, ch.yield_unit::text)
            / NULLIF(ch.yield_quantity * (1::numeric - COALESCE(ch.perte_standard_pct, 0::numeric) / 100::numeric), 0::numeric)
            / NULLIF(1::numeric - COALESCE(c.perte_pct, 0::numeric) / 100::numeric, 0::numeric) AS frac
     FROM recipes r
     JOIN recipe_components c ON c.recipe_id = r.id AND c.source_recipe_id IS NOT NULL
     JOIN recipes ch ON ch.id = c.source_recipe_id
    WHERE r.mode_cout::text = 'compose'
 ), expand AS (
   SELECT r.id AS root, r.id AS node, 1::numeric AS mult, 0 AS depth FROM recipes r
   UNION ALL
   SELECT e.root, eg.child, e.mult * eg.frac, e.depth + 1
     FROM expand e JOIN edges eg ON eg.parent = e.node WHERE e.depth < 12
 ), node_ings AS (
   SELECT c.recipe_id AS node, c.source_ingredient_id AS ingredient_id,
          c.quantite * fn_unit_conv(c.unite::text, ing_1.unit::text, ing_1.densite_kg_l) / NULLIF(1::numeric - COALESCE(c.perte_pct, 0::numeric) / 100::numeric, 0::numeric) AS qty,
          c.quantite * fn_unit_conv(c.unite::text, ing_1.unit::text, ing_1.densite_kg_l) * COALESCE(ing_1.unit_cost, 0::numeric) / NULLIF(1::numeric - COALESCE(c.perte_pct, 0::numeric) / 100::numeric, 0::numeric) AS cost
     FROM recipe_components c
     JOIN recipes r ON r.id = c.recipe_id AND r.mode_cout::text = 'compose'
     JOIN ingredients ing_1 ON ing_1.id = c.source_ingredient_id
    WHERE c.source_ingredient_id IS NOT NULL
 )
 SELECT x.root AS recipe_id, ni.ingredient_id, ing.name AS ingredient_name, ing.unit,
        sum(ni.qty * x.mult) AS total_qty, sum(ni.cost * x.mult) AS rolled_cost
   FROM expand x JOIN node_ings ni ON ni.node = x.node JOIN ingredients ing ON ing.id = ni.ingredient_id
  GROUP BY x.root, ni.ingredient_id, ing.name, ing.unit;

CREATE OR REPLACE VIEW v_recipe_explosion_v2 AS
 WITH RECURSIVE edges AS (
   SELECT r.id AS parent, c.source_recipe_id AS child,
          c.quantite * fn_convert_factor(c.unite::text, ch.yield_unit::text, NULL::text, NULL::uuid)
            / NULLIF(ch.yield_quantity * (1::numeric - COALESCE(ch.perte_standard_pct, 0::numeric) / 100::numeric), 0::numeric)
            / NULLIF(1::numeric - COALESCE(c.perte_pct, 0::numeric) / 100::numeric, 0::numeric) AS frac
     FROM recipes r
     JOIN recipe_components c ON c.recipe_id = r.id AND c.source_recipe_id IS NOT NULL
     JOIN recipes ch ON ch.id = c.source_recipe_id
    WHERE r.mode_cout::text = 'compose'
 ), expand AS (
   SELECT r.id AS root, r.id AS node, 1::numeric AS mult, 0 AS depth FROM recipes r
   UNION ALL
   SELECT e.root, eg.child, e.mult * eg.frac, e.depth + 1
     FROM expand e JOIN edges eg ON eg.parent = e.node WHERE e.depth < 12
 ), node_ings AS (
   SELECT c.recipe_id AS node, c.source_ingredient_id AS ingredient_id,
          c.quantite * fn_convert_factor(c.unite::text, ing_1.unit::text, 'ingredient'::text, ing_1.id) / NULLIF(1::numeric - COALESCE(c.perte_pct, 0::numeric) / 100::numeric, 0::numeric) AS qty,
          c.quantite * fn_convert_factor(c.unite::text, ing_1.unit::text, 'ingredient'::text, ing_1.id) * COALESCE(ing_1.unit_cost, 0::numeric) / NULLIF(1::numeric - COALESCE(c.perte_pct, 0::numeric) / 100::numeric, 0::numeric) AS cost
     FROM recipe_components c
     JOIN recipes r ON r.id = c.recipe_id AND r.mode_cout::text = 'compose'
     JOIN ingredients ing_1 ON ing_1.id = c.source_ingredient_id
    WHERE c.source_ingredient_id IS NOT NULL
 )
 SELECT x.root AS recipe_id, ni.ingredient_id, ing.name AS ingredient_name, ing.unit,
        sum(ni.qty * x.mult) AS total_qty, sum(ni.cost * x.mult) AS rolled_cost
   FROM expand x JOIN node_ings ni ON ni.node = x.node JOIN ingredients ing ON ing.id = ni.ingredient_id
  GROUP BY x.root, ni.ingredient_id, ing.name, ing.unit;

CREATE OR REPLACE VIEW v_recipe_allergens AS
 WITH RECURSIVE edges AS (
   SELECT c.recipe_id AS parent, c.source_recipe_id AS child
     FROM recipe_components c WHERE c.source_recipe_id IS NOT NULL
   UNION
   SELECT f.recipe_id, fc.source_recipe_id
     FROM recipe_format_components fc JOIN recipe_formats f ON f.id = fc.format_id AND f.is_active = true
    WHERE fc.source_recipe_id IS NOT NULL
 ), expand AS (
   SELECT r_1.id AS root, r_1.id AS node, 0 AS depth, ARRAY[r_1.id] AS path FROM recipes r_1
   UNION ALL
   SELECT e.root, eg.child, e.depth + 1, e.path || eg.child
     FROM expand e JOIN edges eg ON eg.parent = e.node
    WHERE e.depth < 12 AND NOT (eg.child = ANY (e.path))
 ), node_ingredients AS (
   SELECT c.recipe_id AS node, c.source_ingredient_id AS ingredient_id
     FROM recipe_components c WHERE c.source_ingredient_id IS NOT NULL
   UNION
   SELECT f.recipe_id, fc.source_ingredient_id
     FROM recipe_format_components fc JOIN recipe_formats f ON f.id = fc.format_id AND f.is_active = true
    WHERE fc.source_ingredient_id IS NOT NULL
 ), reachable AS (
   SELECT DISTINCT x.root AS recipe_id, lower(btrim(a.a)) AS allergen
     FROM expand x
     JOIN node_ingredients ni ON ni.node = x.node
     JOIN ingredients ing ON ing.id = ni.ingredient_id
     CROSS JOIN LATERAL unnest(COALESCE(ing.allergens, '{}'::text[])) a(a)
    WHERE btrim(a.a) <> ''
 )
 SELECT r.id AS recipe_id,
        COALESCE(array_agg(ra.allergen ORDER BY ra.allergen) FILTER (WHERE ra.allergen IS NOT NULL), '{}'::text[]) AS allergens,
        count(ra.allergen)::integer AS nb_allergens
   FROM recipes r LEFT JOIN reachable ra ON ra.recipe_id = r.id
  GROUP BY r.id;

CREATE OR REPLACE VIEW v_impossible_unit_conversions AS
 SELECT 'recipe_component'::text AS source, rc.id::text AS line_id, r.id AS recipe_id, r.name AS recipe_name,
        NULL::uuid AS format_id, i.id AS ingredient_id, i.name AS ingredient_name, rc.unite::text AS line_unit,
        i.unit::text AS stock_unit, i.densite_kg_l, rc.quantite::numeric AS quantity
   FROM recipe_components rc
   JOIN recipes r ON r.id = rc.recipe_id AND r.archived_at IS NULL
   JOIN ingredients i ON i.id = rc.source_ingredient_id
  WHERE rc.unite IS NOT NULL AND fn_unit_conv_strict(rc.unite::text, i.unit::text, i.densite_kg_l) IS NULL
 UNION ALL
 SELECT 'recipe_format_component'::text, fc.id::text, r.id, r.name, f.id, i.id, i.name, fc.unite::text,
        i.unit::text, i.densite_kg_l, fc.quantite::numeric
   FROM recipe_format_components fc
   JOIN recipe_formats f ON f.id = fc.format_id AND f.is_active
   JOIN recipes r ON r.id = f.recipe_id AND r.archived_at IS NULL
   JOIN ingredients i ON i.id = fc.source_ingredient_id
  WHERE fc.unite IS NOT NULL AND fn_unit_conv_strict(fc.unite::text, i.unit::text, i.densite_kg_l) IS NULL;

CREATE OR REPLACE VIEW v_impossible_unit_conversions_v2 AS
 SELECT 'recipe_component'::text AS source, rc.id::text AS line_id, r.id AS recipe_id, r.name AS recipe_name,
        NULL::uuid AS format_id, i.id AS ingredient_id, i.name AS ingredient_name, rc.unite::text AS line_unit,
        i.unit::text AS stock_unit, i.densite_kg_l, rc.quantite::numeric AS quantity
   FROM recipe_components rc
   JOIN recipes r ON r.id = rc.recipe_id AND r.archived_at IS NULL
   JOIN ingredients i ON i.id = rc.source_ingredient_id
  WHERE rc.unite IS NOT NULL AND fn_convert_factor(rc.unite::text, i.unit::text, 'ingredient'::text, i.id) IS NULL
 UNION ALL
 SELECT 'recipe_format_component'::text, fc.id::text, r.id, r.name, f.id, i.id, i.name, fc.unite::text,
        i.unit::text, i.densite_kg_l, fc.quantite::numeric
   FROM recipe_format_components fc
   JOIN recipe_formats f ON f.id = fc.format_id AND f.is_active
   JOIN recipes r ON r.id = f.recipe_id AND r.archived_at IS NULL
   JOIN ingredients i ON i.id = fc.source_ingredient_id
  WHERE fc.unite IS NOT NULL AND fn_convert_factor(fc.unite::text, i.unit::text, 'ingredient'::text, i.id) IS NULL;

CREATE OR REPLACE VIEW v_unit_unmatched AS
 SELECT 'ingredients'::text AS table_name, ingredients.id::text AS row_id, ingredients.name::text AS label, ingredients.unit::text AS unit
   FROM ingredients WHERE ingredients.unit IS NOT NULL AND ingredients.unit_id IS NULL
 UNION ALL
 SELECT 'packaging_items', packaging_items.id::text, packaging_items.name::text, packaging_items.unit::text
   FROM packaging_items WHERE packaging_items.unit IS NOT NULL AND packaging_items.unit_id IS NULL
 UNION ALL
 SELECT 'recipes', recipes.id::text, recipes.name::text, recipes.yield_unit::text
   FROM recipes WHERE recipes.yield_unit IS NOT NULL AND recipes.yield_unit_id IS NULL
 UNION ALL
 SELECT 'recipe_components', recipe_components.id::text, recipe_components.recipe_id::text, recipe_components.unite::text
   FROM recipe_components WHERE recipe_components.unite IS NOT NULL AND recipe_components.unit_id IS NULL
 UNION ALL
 SELECT 'recipe_format_components', recipe_format_components.id::text, recipe_format_components.format_id::text, recipe_format_components.unite::text
   FROM recipe_format_components WHERE recipe_format_components.unite IS NOT NULL AND recipe_format_components.unit_id IS NULL;

-- used_in_recipe : la ligne ancien modèle est retirée, le miroir et les formats actifs comptent.
CREATE OR REPLACE VIEW v_ingredient_price_health AS
 WITH lots AS (
   SELECT ingredient_lots.ingredient_id,
          sum(ingredient_lots.quantity_remaining) AS qty,
          sum(ingredient_lots.quantity_remaining * ingredient_lots.unit_cost) FILTER (WHERE ingredient_lots.unit_cost::text <> 'NaN') AS val
     FROM ingredient_lots WHERE ingredient_lots.quantity_remaining > 0::numeric
    GROUP BY ingredient_lots.ingredient_id
 )
 SELECT i.id AS ingredient_id, i.name, i.unit, i.unit_cost AS catalogue_cost,
        CASE WHEN l.qty > 0::numeric AND l.val IS NOT NULL THEN round(l.val / l.qty, 4) ELSE NULL::numeric END AS lot_avg_cost,
        round(COALESCE(l.qty, 0::numeric), 3) AS lot_qty,
        round(COALESCE(l.val, 0::numeric), 2) AS lot_value,
        round(COALESCE(l.qty, 0::numeric) * COALESCE(i.unit_cost, 0::numeric), 2) AS catalogue_value,
        round(COALESCE(l.qty, 0::numeric) * COALESCE(i.unit_cost, 0::numeric) - COALESCE(l.val, 0::numeric), 2) AS value_gap,
        CASE
          WHEN i.unit_cost IS NULL OR i.unit_cost::text = 'NaN' OR i.unit_cost = 0::numeric THEN 'prix_manquant'::text
          WHEN l.qty > 0::numeric AND l.val > 0::numeric AND (abs(i.unit_cost - l.val / l.qty) / (l.val / l.qty)) > 0.30 THEN 'ecart_prix'::text
          ELSE 'ok'::text
        END AS flag,
        CASE WHEN l.qty > 0::numeric AND l.val > 0::numeric AND i.unit_cost::text <> 'NaN'
             THEN round((i.unit_cost - l.val / l.qty) / (l.val / l.qty) * 100::numeric, 0) ELSE NULL::numeric END AS divergence_pct,
        (EXISTS (SELECT 1 FROM recipe_components rc WHERE rc.source_ingredient_id = i.id)
         OR EXISTS (SELECT 1 FROM recipe_format_components fc JOIN recipe_formats f ON f.id = fc.format_id AND f.is_active
                     WHERE fc.source_ingredient_id = i.id)) AS used_in_recipe
   FROM ingredients i LEFT JOIN lots l ON l.ingredient_id = i.id;

-- 3. Fonctions --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_recipe_bom_snapshot(p_recipe uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'header', (SELECT jsonb_build_object(
        'name', r.name, 'is_base', r.is_base, 'yield_quantity', r.yield_quantity, 'yield_unit', r.yield_unit,
        'mode_cout', r.mode_cout, 'perte_standard_pct', r.perte_standard_pct, 'piece_weight_kg', r.piece_weight_kg,
        'pieces_par_fournee', r.pieces_par_fournee, 'compo_par_piece', r.compo_par_piece, 'contenant_id', r.contenant_id,
        'etapes', r.etapes, 'instructions', r.instructions)
      FROM recipes r WHERE r.id = p_recipe),
    -- Ancien modèle retiré (mig 649) : clés gardées pour comparer aux instantanés existants.
    'ingredients', '[]'::jsonb,
    'sub_recipes', '[]'::jsonb,
    'components', COALESCE((SELECT jsonb_agg(jsonb_build_object('role', c.role, 'source_recipe_id', c.source_recipe_id,
        'source_ingredient_id', c.source_ingredient_id, 'name', COALESCE(br.name, g.name), 'quantite', c.quantite, 'unite', c.unite,
        'perte_pct', c.perte_pct, 'ordre', c.ordre) ORDER BY c.ordre, COALESCE(br.name, g.name))
      FROM recipe_components c LEFT JOIN recipes br ON br.id = c.source_recipe_id LEFT JOIN ingredients g ON g.id = c.source_ingredient_id
      WHERE c.recipe_id = p_recipe), '[]'::jsonb),
    'formats', COALESCE((SELECT jsonb_agg(jsonb_build_object('format_id', f.id, 'contenant_id', f.contenant_id,
        'quantite_par_format', f.quantite_par_format, 'quantite_par_format_unite', f.quantite_par_format_unite,
        'nb_par_defaut', f.nb_par_defaut, 'nb_parts', f.nb_parts, 'is_default', f.is_default, 'is_active', f.is_active,
        'poids_cru_g', f.poids_cru_g, 'poids_cuit_g', f.poids_cuit_g, 'product_id', f.product_id,
        'components', COALESCE((SELECT jsonb_agg(jsonb_build_object('role', fc.role, 'source_recipe_id', fc.source_recipe_id,
            'source_ingredient_id', fc.source_ingredient_id, 'name', COALESCE(br.name, g.name), 'quantite', fc.quantite,
            'unite', fc.unite, 'perte_pct', fc.perte_pct, 'ordre', fc.ordre) ORDER BY fc.ordre, COALESCE(br.name, g.name))
          FROM recipe_format_components fc LEFT JOIN recipes br ON br.id = fc.source_recipe_id LEFT JOIN ingredients g ON g.id = fc.source_ingredient_id
          WHERE fc.format_id = f.id), '[]'::jsonb)) ORDER BY f.ordre, f.id)
      FROM recipe_formats f WHERE f.recipe_id = p_recipe), '[]'::jsonb),
    'packaging', '[]'::jsonb
  )
$$;

CREATE OR REPLACE FUNCTION fn_bom_snapshot_apply(p_recipe uuid, p_snap jsonb)
RETURNS boolean LANGUAGE plpgsql AS $function$
DECLARE
  h jsonb := p_snap->'header';
  f jsonb;
BEGIN
  IF p_snap IS NULL OR h IS NULL THEN RETURN false; END IF;
  -- Un format de la version supprimé depuis : impossible de rejouer fidèlement.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_snap->'formats', '[]'::jsonb)) x
              WHERE NOT EXISTS (SELECT 1 FROM recipe_formats rf WHERE rf.id = (x->>'format_id')::uuid AND rf.recipe_id = p_recipe)) THEN
    RETURN false;
  END IF;

  UPDATE recipes SET
    is_base = (h->>'is_base')::boolean,
    yield_quantity = (h->>'yield_quantity')::numeric,
    yield_unit = h->>'yield_unit',
    mode_cout = h->>'mode_cout',
    perte_standard_pct = (h->>'perte_standard_pct')::numeric,
    piece_weight_kg = (h->>'piece_weight_kg')::numeric,
    pieces_par_fournee = (h->>'pieces_par_fournee')::integer,
    compo_par_piece = (h->>'compo_par_piece')::boolean,
    contenant_id = (h->>'contenant_id')::uuid,
    etapes = h->'etapes',
    instructions = h->>'instructions'
  WHERE id = p_recipe;

  -- Ancien modèle (mig 649) : les clés ingredients / sub_recipes / packaging ne sont plus rejouées.

  UPDATE recipe_formats SET is_default = false WHERE recipe_id = p_recipe AND is_default;
  FOR f IN SELECT * FROM jsonb_array_elements(COALESCE(p_snap->'formats', '[]'::jsonb)) LOOP
    UPDATE recipe_formats SET
      contenant_id = (f->>'contenant_id')::uuid,
      quantite_par_format = (f->>'quantite_par_format')::numeric,
      quantite_par_format_unite = f->>'quantite_par_format_unite',
      nb_par_defaut = (f->>'nb_par_defaut')::integer,
      nb_parts = (f->>'nb_parts')::integer,
      is_active = (f->>'is_active')::boolean,
      poids_cru_g = (f->>'poids_cru_g')::numeric,
      poids_cuit_g = (f->>'poids_cuit_g')::numeric
    WHERE id = (f->>'format_id')::uuid;
    DELETE FROM recipe_format_components WHERE format_id = (f->>'format_id')::uuid;
    INSERT INTO recipe_format_components (format_id, role, source_recipe_id, source_ingredient_id, quantite, unite, perte_pct, ordre)
    SELECT (f->>'format_id')::uuid, c->>'role', (c->>'source_recipe_id')::uuid, (c->>'source_ingredient_id')::uuid,
           (c->>'quantite')::numeric, COALESCE(c->>'unite', 'g'), COALESCE((c->>'perte_pct')::numeric, 0), COALESCE((c->>'ordre')::smallint, 0)
      FROM jsonb_array_elements(COALESCE(f->'components', '[]'::jsonb)) c;
  END LOOP;
  UPDATE recipe_formats rf SET is_default = true
    FROM jsonb_array_elements(COALESCE(p_snap->'formats', '[]'::jsonb)) x
   WHERE rf.id = (x->>'format_id')::uuid AND (x->>'is_default')::boolean;

  -- Composants de la fiche en dernier : les miroirs des formats ont pu les réécrire.
  DELETE FROM recipe_components WHERE recipe_id = p_recipe;
  INSERT INTO recipe_components (recipe_id, role, source_recipe_id, source_ingredient_id, quantite, unite, perte_pct, ordre)
  SELECT p_recipe, x->>'role', (x->>'source_recipe_id')::uuid, (x->>'source_ingredient_id')::uuid,
         (x->>'quantite')::numeric, COALESCE(x->>'unite', 'g'), COALESCE((x->>'perte_pct')::numeric, 0), COALESCE((x->>'ordre')::smallint, 0)
    FROM jsonb_array_elements(COALESCE(p_snap->'components', '[]'::jsonb)) x;

  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION fn_rfc_no_cycle()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE
  v_parent_recipe uuid;
  v_source        uuid := NEW.source_recipe_id;
BEGIN
  IF v_source IS NULL THEN
    RETURN NEW;  -- composant ingrédient : pas d'arête de recette, pas de cycle possible
  END IF;

  SELECT f.recipe_id INTO v_parent_recipe FROM recipe_formats f WHERE f.id = NEW.format_id;
  IF v_parent_recipe IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_source = v_parent_recipe THEN
    RAISE EXCEPTION 'Référence circulaire : une recette ne peut pas se contenir elle-même';
  END IF;

  -- Depuis la sous-recette source, peut-on redescendre jusqu'à la recette parente ?
  -- Arêtes existantes des composants de format et du miroir (ancien modèle retiré, mig 649).
  IF EXISTS (
    WITH RECURSIVE edges AS (
      SELECT f.recipe_id AS parent, rfc.source_recipe_id AS child
        FROM recipe_format_components rfc JOIN recipe_formats f ON f.id = rfc.format_id
       WHERE rfc.source_recipe_id IS NOT NULL
      UNION
      SELECT rc.recipe_id, rc.source_recipe_id FROM recipe_components rc WHERE rc.source_recipe_id IS NOT NULL
    ),
    reach AS (
      SELECT v_source AS node, 0 AS depth
      UNION
      SELECT e.child, r.depth + 1
        FROM reach r JOIN edges e ON e.parent = r.node
       WHERE r.depth < 20
    )
    SELECT 1 FROM reach WHERE node = v_parent_recipe
  ) THEN
    RAISE EXCEPTION 'Référence circulaire détectée : ce composant créerait un cycle de nomenclature';
  END IF;

  RETURN NEW;
END;
$function$;

-- 4. Lecture seule ---------------------------------------------------------------------
-- Une mise à jour qui ne change QUE des colonnes de référence (*_id) reste permise : la
-- fusion de deux matières (ou unités, emballages) repointe toutes les références, y compris
-- les lignes figées des bases archivées.
CREATE OR REPLACE FUNCTION fn_legacy_recipe_model_ro()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  o jsonb; n jsonb; k text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    o := to_jsonb(OLD); n := to_jsonb(NEW);
    FOR k IN SELECT jsonb_object_keys(n) LOOP
      IF k LIKE '%\_id' ESCAPE '\' OR k = 'updated_at' THEN
        o := o - k; n := n - k;
      END IF;
    END LOOP;
    IF o = n THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Ancien modèle de fiche en lecture seule (mig 649) : la composition s''écrit dans la nomenclature du format (recipe_format_components)'
    USING ERRCODE = 'P0001';
END
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['recipe_ingredients', 'recipe_sub_recipes', 'recipe_packaging', 'produit_profil_production'] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_legacy_recipe_model_ro ON %I', t);
      EXECUTE format('CREATE TRIGGER trg_legacy_recipe_model_ro BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION fn_legacy_recipe_model_ro()', t);
    END IF;
  END LOOP;
END
$$;
