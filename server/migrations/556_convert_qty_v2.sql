-- M3-03 (plan d'action 2026-11) — conversion pilotée par les données, vues de coût _v2.
--
-- fn_unit_conv (mig 120…529) renvoie 1 pour une conversion inconnue et ne connaît que
-- masse et volume ; elle est ancienne et ne doit jamais être remplacée en production.
-- On crée à côté :
--   fn_convert_factor(source, cible, type d'article, article) : facteur de conversion —
--     même unité → 1 ; même dimension → rapport des facteurs du référentiel (v_units,
--     M3-01) ; dimensions différentes → conversion de l'article (item_unit_conversions,
--     M3-02 : densité, contenant, poids par pièce, saisie), dans un sens ou dans l'autre ;
--     sinon NULL (jamais 1) ;
--   fn_convert_qty(quantité, …) = quantité × facteur ;
--   les vues de coût et d'explosion suffixées _v2 et fn_ingredient_weight_kg_v2 :
--     définitions actuelles, chaque fn_unit_conv(a, b, X.densite_kg_l) devenu
--     fn_convert_factor(a, b, 'ingredient', X.id) et chaque fn_unit_conv(a, b)
--     devenu fn_convert_factor(a, b, NULL, NULL) (générées depuis pg_get_viewdef).
-- Les vues d'origine restent en place un cycle complet ; le code bascule appelant par
-- appelant après comparaison (scripts/compare-unit-views.ts : zéro écart attendu).
--
-- INVERSION :
--   DROP VIEW v_impossible_unit_conversions_v2, v_recipe_explosion_v2, v_rcomp_cost_v2,
--     v_recipe_component_cost_v2, v_recipe_total_cost_v2, v_recipe_direct_cost_v2;
--   DROP FUNCTION fn_ingredient_weight_kg_v2(uuid, numeric), fn_convert_qty(numeric, text, text, text, uuid),
--     fn_convert_factor(text, text, text, uuid);
--   DROP TRIGGER trg_refresh_unit_factor_cache ON ref_entries;
--   DROP FUNCTION trg_fn_refresh_unit_factor_cache(), fn_refresh_unit_factor_cache(); DROP TABLE unit_factor_cache;

-- Facteurs du référentiel en table indexée (la vue v_units lit du JSON à chaque appel) :
-- rafraîchie à chaque changement des unités.
CREATE TABLE IF NOT EXISTS unit_factor_cache (
  code_l    text PRIMARY KEY,
  unit_id   uuid NOT NULL,
  dimension text NOT NULL,
  factor    numeric NOT NULL CHECK (factor > 0)
);
CREATE INDEX IF NOT EXISTS idx_unit_factor_cache_unit ON unit_factor_cache (unit_id);
CREATE OR REPLACE FUNCTION fn_refresh_unit_factor_cache() RETURNS void LANGUAGE sql AS $$
  DELETE FROM unit_factor_cache;
  INSERT INTO unit_factor_cache (code_l, unit_id, dimension, factor)
  SELECT DISTINCT ON (lower(code)) lower(code), id, dimension, factor FROM v_units
   WHERE dimension IS NOT NULL AND factor > 0 AND is_active ORDER BY lower(code), is_system DESC;
$$;
CREATE OR REPLACE FUNCTION trg_fn_refresh_unit_factor_cache() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM fn_refresh_unit_factor_cache(); RETURN NULL; END $$;
DROP TRIGGER IF EXISTS trg_refresh_unit_factor_cache ON ref_entries;
CREATE TRIGGER trg_refresh_unit_factor_cache AFTER INSERT OR UPDATE OR DELETE ON ref_entries
  FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_refresh_unit_factor_cache();
SELECT fn_refresh_unit_factor_cache();

CREATE OR REPLACE FUNCTION fn_convert_factor(p_from text, p_to text, p_kind text DEFAULT NULL, p_item uuid DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN p_from IS NULL OR p_to IS NULL THEN NULL
    WHEN lower(p_from) = lower(p_to) THEN 1::numeric
    ELSE COALESCE(
      -- Même dimension : rapport des facteurs du référentiel.
      (SELECT f.factor / t.factor FROM unit_factor_cache f JOIN unit_factor_cache t ON t.dimension = f.dimension
        WHERE f.code_l = lower(p_from) AND t.code_l = lower(p_to)),
      -- Dimensions différentes : conversion de l'article, sens direct ou inverse (saisie d'abord).
      (SELECT x.k FROM (
         SELECT f.factor / a.factor * c.factor * b.factor / t.factor AS k, CASE c.origin WHEN 'saisie' THEN 0 ELSE 1 END AS prio
           FROM unit_factor_cache f, unit_factor_cache t, item_unit_conversions c
           JOIN unit_factor_cache a ON a.unit_id = c.from_unit_id JOIN unit_factor_cache b ON b.unit_id = c.to_unit_id
          WHERE f.code_l = lower(p_from) AND t.code_l = lower(p_to) AND c.item_kind = p_kind AND c.item_id = p_item
            AND a.dimension = f.dimension AND b.dimension = t.dimension
         UNION ALL
         SELECT f.factor / b.factor / c.factor * a.factor / t.factor, CASE c.origin WHEN 'saisie' THEN 0 ELSE 1 END
           FROM unit_factor_cache f, unit_factor_cache t, item_unit_conversions c
           JOIN unit_factor_cache a ON a.unit_id = c.from_unit_id JOIN unit_factor_cache b ON b.unit_id = c.to_unit_id
          WHERE f.code_l = lower(p_from) AND t.code_l = lower(p_to) AND c.item_kind = p_kind AND c.item_id = p_item
            AND a.dimension = t.dimension AND b.dimension = f.dimension
       ) x ORDER BY x.prio LIMIT 1))
  END
$$;
COMMENT ON FUNCTION fn_convert_factor(text, text, text, uuid) IS 'Facteur de conversion piloté par v_units et item_unit_conversions (M3-03) ; NULL si inconnu, jamais 1.';

CREATE OR REPLACE FUNCTION fn_convert_qty(p_qty numeric, p_from text, p_to text, p_kind text DEFAULT NULL, p_item uuid DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT p_qty * fn_convert_factor(p_from, p_to, p_kind, p_item)
$$;

CREATE OR REPLACE FUNCTION fn_ingredient_weight_kg_v2(p_ingredient_id uuid, p_quantity numeric)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT fn_convert_qty(p_quantity, i.unit::text, 'kg', 'ingredient', i.id) FROM ingredients i WHERE i.id = p_ingredient_id
$$;

-- v_recipe_direct_cost : 1 appel(s) remplacé(s)
CREATE OR REPLACE VIEW v_recipe_direct_cost_v2 AS
 SELECT id,
    yield_quantity,
    COALESCE(( SELECT sum(ri.quantity * COALESCE(ing.unit_cost, 0::numeric) * fn_convert_factor(COALESCE(NULLIF(ri.unit::text, ''::text), ing.unit::text), ing.unit::text, 'ingredient'::text, ing.id)) AS sum
           FROM recipe_ingredients ri
             JOIN ingredients ing ON ing.id = ri.ingredient_id
          WHERE ri.recipe_id = r.id), 0::numeric) + COALESCE(( SELECT sum(rp.quantity * COALESCE(pi.unit_cost, 0::numeric)) AS sum
           FROM recipe_packaging rp
             JOIN packaging_items pi ON pi.id = rp.packaging_id
          WHERE rp.recipe_id = r.id), 0::numeric) AS direct_cost
   FROM recipes r;

-- v_recipe_total_cost : 2 appel(s) remplacé(s)
CREATE OR REPLACE VIEW v_recipe_total_cost_v2 AS
 WITH RECURSIVE own AS (
         SELECT r.id,
            COALESCE(dc.direct_cost, 0::numeric) +
                CASE
                    WHEN r.mode_cout::text = 'compose'::text THEN COALESCE(( SELECT sum(c.quantite * fn_convert_factor(c.unite::text, ing.unit::text, 'ingredient'::text, ing.id) * COALESCE(ing.unit_cost, 0::numeric) / NULLIF(1::numeric - COALESCE(c.perte_pct, 0::numeric) / 100::numeric, 0::numeric)) AS sum
                       FROM recipe_components c
                         JOIN ingredients ing ON ing.id = c.source_ingredient_id
                      WHERE c.recipe_id = r.id AND c.source_ingredient_id IS NOT NULL), 0::numeric)
                    ELSE 0::numeric
                END AS own_cost
           FROM recipes r
             LEFT JOIN v_recipe_direct_cost_v2 dc ON dc.id = r.id
        ), edges AS (
         SELECT r.id AS parent,
            rsr.sub_recipe_id AS child,
            rsr.quantity / NULLIF(ch.yield_quantity, 0::numeric) AS frac
           FROM recipes r
             JOIN recipe_sub_recipes rsr ON rsr.recipe_id = r.id
             JOIN recipes ch ON ch.id = rsr.sub_recipe_id
          WHERE r.mode_cout::text <> 'compose'::text
        UNION ALL
         SELECT r.id,
            c.source_recipe_id,
            c.quantite * fn_convert_factor(c.unite::text, ch.yield_unit::text, NULL::text, NULL::uuid) / NULLIF(ch.yield_quantity * (1::numeric - COALESCE(ch.perte_standard_pct, 0::numeric) / 100::numeric), 0::numeric) / NULLIF(1::numeric - COALESCE(c.perte_pct, 0::numeric) / 100::numeric, 0::numeric)
           FROM recipes r
             JOIN recipe_components c ON c.recipe_id = r.id AND c.source_recipe_id IS NOT NULL
             JOIN recipes ch ON ch.id = c.source_recipe_id
          WHERE r.mode_cout::text = 'compose'::text
        ), expand AS (
         SELECT r.id AS root,
            r.id AS node,
            1::numeric AS mult,
            0 AS depth
           FROM recipes r
        UNION ALL
         SELECT e.root,
            eg.child,
            e.mult * eg.frac,
            e.depth + 1
           FROM expand e
             JOIN edges eg ON eg.parent = e.node
          WHERE e.depth < 12
        )
 SELECT x.root AS id,
    sum(o.own_cost * x.mult) AS total_cost
   FROM expand x
     JOIN own o ON o.id = x.node
  GROUP BY x.root;

-- v_recipe_component_cost : 2 appel(s) remplacé(s)
CREATE OR REPLACE VIEW v_recipe_component_cost_v2 AS
 SELECT c.id AS component_id,
    c.format_id,
    c.role,
        CASE
            WHEN c.source_recipe_id IS NOT NULL THEN c.quantite * fn_convert_factor(c.unite::text, br.yield_unit::text, NULL::text, NULL::uuid) * COALESCE(brc.total_cost, 0::numeric) / NULLIF(br.yield_quantity * (1::numeric - COALESCE(br.perte_standard_pct, 0::numeric) / 100::numeric), 0::numeric) / NULLIF(1::numeric - COALESCE(c.perte_pct, 0::numeric) / 100::numeric, 0::numeric)
            ELSE c.quantite * fn_convert_factor(c.unite::text, ing.unit::text, 'ingredient'::text, ing.id) * COALESCE(ing.unit_cost, 0::numeric) / NULLIF(1::numeric - COALESCE(c.perte_pct, 0::numeric) / 100::numeric, 0::numeric)
        END AS cout_dh,
        CASE
            WHEN c.source_recipe_id IS NOT NULL THEN fn_unit_conv_ok(c.unite::text, br.yield_unit::text)
            ELSE fn_unit_conv_ok(c.unite::text, ing.unit::text) OR ((lower(c.unite::text) = ANY (ARRAY['g'::text, 'kg'::text, 'mg'::text])) AND (lower(ing.unit::text) = ANY (ARRAY['ml'::text, 'cl'::text, 'dl'::text, 'l'::text])) OR (lower(c.unite::text) = ANY (ARRAY['ml'::text, 'cl'::text, 'dl'::text, 'l'::text])) AND (lower(ing.unit::text) = ANY (ARRAY['g'::text, 'kg'::text, 'mg'::text]))) AND ing.densite_kg_l IS NOT NULL
        END AS conversion_ok
   FROM recipe_format_components c
     LEFT JOIN recipes br ON br.id = c.source_recipe_id
     LEFT JOIN v_recipe_total_cost_v2 brc ON brc.id = c.source_recipe_id
     LEFT JOIN ingredients ing ON ing.id = c.source_ingredient_id;

-- v_rcomp_cost : 2 appel(s) remplacé(s)
CREATE OR REPLACE VIEW v_rcomp_cost_v2 AS
 SELECT c.id AS component_id,
    c.recipe_id,
    c.role,
        CASE
            WHEN c.source_recipe_id IS NOT NULL THEN c.quantite * fn_convert_factor(c.unite::text, br.yield_unit::text, NULL::text, NULL::uuid) * COALESCE(brc.total_cost, 0::numeric) / NULLIF(br.yield_quantity * (1::numeric - COALESCE(br.perte_standard_pct, 0::numeric) / 100::numeric), 0::numeric) / NULLIF(1::numeric - COALESCE(c.perte_pct, 0::numeric) / 100::numeric, 0::numeric)
            ELSE c.quantite * fn_convert_factor(c.unite::text, ing.unit::text, 'ingredient'::text, ing.id) * COALESCE(ing.unit_cost, 0::numeric) / NULLIF(1::numeric - COALESCE(c.perte_pct, 0::numeric) / 100::numeric, 0::numeric)
        END AS cout_dh
   FROM recipe_components c
     LEFT JOIN recipes br ON br.id = c.source_recipe_id
     LEFT JOIN v_recipe_total_cost_v2 brc ON brc.id = c.source_recipe_id
     LEFT JOIN ingredients ing ON ing.id = c.source_ingredient_id;

-- v_recipe_explosion : 5 appel(s) remplacé(s)
CREATE OR REPLACE VIEW v_recipe_explosion_v2 AS
 WITH RECURSIVE edges AS (
         SELECT r.id AS parent,
            rsr.sub_recipe_id AS child,
            rsr.quantity / NULLIF(ch.yield_quantity, 0::numeric) AS frac
           FROM recipes r
             JOIN recipe_sub_recipes rsr ON rsr.recipe_id = r.id
             JOIN recipes ch ON ch.id = rsr.sub_recipe_id
          WHERE r.mode_cout::text <> 'compose'::text
        UNION ALL
         SELECT r.id,
            c.source_recipe_id,
            c.quantite * fn_convert_factor(c.unite::text, ch.yield_unit::text, NULL::text, NULL::uuid) / NULLIF(ch.yield_quantity * (1::numeric - COALESCE(ch.perte_standard_pct, 0::numeric) / 100::numeric), 0::numeric) / NULLIF(1::numeric - COALESCE(c.perte_pct, 0::numeric) / 100::numeric, 0::numeric)
           FROM recipes r
             JOIN recipe_components c ON c.recipe_id = r.id AND c.source_recipe_id IS NOT NULL
             JOIN recipes ch ON ch.id = c.source_recipe_id
          WHERE r.mode_cout::text = 'compose'::text
        ), expand AS (
         SELECT r.id AS root,
            r.id AS node,
            1::numeric AS mult,
            0 AS depth
           FROM recipes r
        UNION ALL
         SELECT e.root,
            eg.child,
            e.mult * eg.frac,
            e.depth + 1
           FROM expand e
             JOIN edges eg ON eg.parent = e.node
          WHERE e.depth < 12
        ), node_ings AS (
         SELECT ri.recipe_id AS node,
            ri.ingredient_id,
            ri.quantity * fn_convert_factor(COALESCE(NULLIF(ri.unit::text, ''::text), ing_1.unit::text), ing_1.unit::text, 'ingredient'::text, ing_1.id) AS qty,
            ri.quantity * fn_convert_factor(COALESCE(NULLIF(ri.unit::text, ''::text), ing_1.unit::text), ing_1.unit::text, 'ingredient'::text, ing_1.id) * COALESCE(ing_1.unit_cost, 0::numeric) AS cost
           FROM recipe_ingredients ri
             JOIN ingredients ing_1 ON ing_1.id = ri.ingredient_id
        UNION ALL
         SELECT c.recipe_id,
            c.source_ingredient_id,
            c.quantite * fn_convert_factor(c.unite::text, ing_1.unit::text, 'ingredient'::text, ing_1.id) / NULLIF(1::numeric - COALESCE(c.perte_pct, 0::numeric) / 100::numeric, 0::numeric),
            c.quantite * fn_convert_factor(c.unite::text, ing_1.unit::text, 'ingredient'::text, ing_1.id) * COALESCE(ing_1.unit_cost, 0::numeric) / NULLIF(1::numeric - COALESCE(c.perte_pct, 0::numeric) / 100::numeric, 0::numeric)
           FROM recipe_components c
             JOIN recipes r ON r.id = c.recipe_id AND r.mode_cout::text = 'compose'::text
             JOIN ingredients ing_1 ON ing_1.id = c.source_ingredient_id
          WHERE c.source_ingredient_id IS NOT NULL
        )
 SELECT x.root AS recipe_id,
    ni.ingredient_id,
    ing.name AS ingredient_name,
    ing.unit,
    sum(ni.qty * x.mult) AS total_qty,
    sum(ni.cost * x.mult) AS rolled_cost
   FROM expand x
     JOIN node_ings ni ON ni.node = x.node
     JOIN ingredients ing ON ing.id = ni.ingredient_id
  GROUP BY x.root, ni.ingredient_id, ing.name, ing.unit;

-- v_impossible_unit_conversions : 3 appel(s) remplacé(s)
CREATE OR REPLACE VIEW v_impossible_unit_conversions_v2 AS
 SELECT 'recipe_ingredient'::text AS source,
    ri.id::text AS line_id,
    r.id AS recipe_id,
    r.name AS recipe_name,
    NULL::uuid AS format_id,
    i.id AS ingredient_id,
    i.name AS ingredient_name,
    ri.unit::text AS line_unit,
    i.unit::text AS stock_unit,
    i.densite_kg_l,
    ri.quantity::numeric AS quantity
   FROM recipe_ingredients ri
     JOIN recipes r ON r.id = ri.recipe_id AND r.archived_at IS NULL
     JOIN ingredients i ON i.id = ri.ingredient_id
  WHERE ri.unit IS NOT NULL AND fn_convert_factor(ri.unit::text, i.unit::text, 'ingredient'::text, i.id) IS NULL
UNION ALL
 SELECT 'recipe_component'::text AS source,
    rc.id::text AS line_id,
    r.id AS recipe_id,
    r.name AS recipe_name,
    NULL::uuid AS format_id,
    i.id AS ingredient_id,
    i.name AS ingredient_name,
    rc.unite::text AS line_unit,
    i.unit::text AS stock_unit,
    i.densite_kg_l,
    rc.quantite::numeric AS quantity
   FROM recipe_components rc
     JOIN recipes r ON r.id = rc.recipe_id AND r.archived_at IS NULL
     JOIN ingredients i ON i.id = rc.source_ingredient_id
  WHERE rc.unite IS NOT NULL AND fn_convert_factor(rc.unite::text, i.unit::text, 'ingredient'::text, i.id) IS NULL
UNION ALL
 SELECT 'recipe_format_component'::text AS source,
    fc.id::text AS line_id,
    r.id AS recipe_id,
    r.name AS recipe_name,
    f.id AS format_id,
    i.id AS ingredient_id,
    i.name AS ingredient_name,
    fc.unite::text AS line_unit,
    i.unit::text AS stock_unit,
    i.densite_kg_l,
    fc.quantite::numeric AS quantity
   FROM recipe_format_components fc
     JOIN recipe_formats f ON f.id = fc.format_id AND f.is_active
     JOIN recipes r ON r.id = f.recipe_id AND r.archived_at IS NULL
     JOIN ingredients i ON i.id = fc.source_ingredient_id
  WHERE fc.unite IS NOT NULL AND fn_convert_factor(fc.unite::text, i.unit::text, 'ingredient'::text, i.id) IS NULL;
