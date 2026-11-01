-- 408 : applique la perte par ligne (recipe_components.perte_pct) dans les vues de
-- cout AU NIVEAU RECETTE, pour les aligner sur la vue par format (v_recipe_component_cost,
-- mig 340) qui l'applique deja.
--
-- Avant : v_recipe_total_cost, v_rcomp_cost et v_recipe_explosion ignoraient perte_pct.
-- Une recette dont un composant porte une perte de ligne (ex. garniture a 3 %) avait donc
-- un cout-recette (liste, prix synchronise, theo_* du plan, explosion, MRP) INFERIEUR a son
-- cout-par-format. Ce lot (L1) supprime cet ecart : partout, quantite effective = quantite
-- / (1 - perte_pct/100), exactement comme la vue par format.
--
-- Sans effet sur les recettes dont toutes les lignes sont a perte_pct = 0 (facteur 1).
-- Les edges de l'ancien modele (recipe_sub_recipes) n'ont pas de perte_pct : inchangees.

-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_recipe_total_cost AS
 WITH RECURSIVE own AS (
         SELECT r.id,
            COALESCE(dc.direct_cost, 0::numeric) +
                CASE
                    WHEN r.mode_cout::text = 'compose'::text THEN COALESCE((
                       SELECT sum(c.quantite * fn_unit_conv(c.unite::text, ing.unit::text, ing.densite_kg_l) * COALESCE(ing.unit_cost, 0::numeric)
                                  / NULLIF(1::numeric - COALESCE(c.perte_pct, 0::numeric) / 100::numeric, 0::numeric))
                       FROM recipe_components c
                         JOIN ingredients ing ON ing.id = c.source_ingredient_id
                      WHERE c.recipe_id = r.id AND c.source_ingredient_id IS NOT NULL), 0::numeric)
                    ELSE 0::numeric
                END AS own_cost
           FROM recipes r
             LEFT JOIN v_recipe_direct_cost dc ON dc.id = r.id
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
            c.quantite * fn_unit_conv(c.unite::text, ch.yield_unit::text)
              / NULLIF(ch.yield_quantity * (1::numeric - COALESCE(ch.perte_standard_pct, 0::numeric) / 100::numeric), 0::numeric)
              / NULLIF(1::numeric - COALESCE(c.perte_pct, 0::numeric) / 100::numeric, 0::numeric)
           FROM recipes r
             JOIN recipe_components c ON c.recipe_id = r.id AND c.source_recipe_id IS NOT NULL
             JOIN recipes ch ON ch.id = c.source_recipe_id
          WHERE r.mode_cout::text = 'compose'::text
        ), expand AS (
         SELECT r.id AS root, r.id AS node, 1::numeric AS mult, 0 AS depth
           FROM recipes r
        UNION ALL
         SELECT e.root, eg.child, e.mult * eg.frac, e.depth + 1
           FROM expand e
             JOIN edges eg ON eg.parent = e.node
          WHERE e.depth < 12
        )
 SELECT x.root AS id, sum(o.own_cost * x.mult) AS total_cost
   FROM expand x
     JOIN own o ON o.id = x.node
  GROUP BY x.root;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_rcomp_cost AS
 SELECT c.id AS component_id,
    c.recipe_id,
    c.role,
        CASE
            WHEN c.source_recipe_id IS NOT NULL
              THEN c.quantite * fn_unit_conv(c.unite::text, br.yield_unit::text) * COALESCE(brc.total_cost, 0::numeric)
                   / NULLIF(br.yield_quantity * (1::numeric - COALESCE(br.perte_standard_pct, 0::numeric) / 100::numeric), 0::numeric)
                   / NULLIF(1::numeric - COALESCE(c.perte_pct, 0::numeric) / 100::numeric, 0::numeric)
            ELSE c.quantite * fn_unit_conv(c.unite::text, ing.unit::text, ing.densite_kg_l) * COALESCE(ing.unit_cost, 0::numeric)
                   / NULLIF(1::numeric - COALESCE(c.perte_pct, 0::numeric) / 100::numeric, 0::numeric)
        END AS cout_dh
   FROM recipe_components c
     LEFT JOIN recipes br ON br.id = c.source_recipe_id
     LEFT JOIN v_recipe_total_cost brc ON brc.id = c.source_recipe_id
     LEFT JOIN ingredients ing ON ing.id = c.source_ingredient_id;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_recipe_explosion AS
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
            c.quantite * fn_unit_conv(c.unite::text, ch.yield_unit::text)
              / NULLIF(ch.yield_quantity * (1::numeric - COALESCE(ch.perte_standard_pct, 0::numeric) / 100::numeric), 0::numeric)
              / NULLIF(1::numeric - COALESCE(c.perte_pct, 0::numeric) / 100::numeric, 0::numeric)
           FROM recipes r
             JOIN recipe_components c ON c.recipe_id = r.id AND c.source_recipe_id IS NOT NULL
             JOIN recipes ch ON ch.id = c.source_recipe_id
          WHERE r.mode_cout::text = 'compose'::text
        ), expand AS (
         SELECT r.id AS root, r.id AS node, 1::numeric AS mult, 0 AS depth
           FROM recipes r
        UNION ALL
         SELECT e.root, eg.child, e.mult * eg.frac, e.depth + 1
           FROM expand e
             JOIN edges eg ON eg.parent = e.node
          WHERE e.depth < 12
        ), node_ings AS (
         SELECT ri.recipe_id AS node,
            ri.ingredient_id,
            ri.quantity * fn_unit_conv(COALESCE(NULLIF(ri.unit::text, ''::text), ing_1.unit::text), ing_1.unit::text, ing_1.densite_kg_l) AS qty,
            ri.quantity * fn_unit_conv(COALESCE(NULLIF(ri.unit::text, ''::text), ing_1.unit::text), ing_1.unit::text, ing_1.densite_kg_l) * COALESCE(ing_1.unit_cost, 0::numeric) AS cost
           FROM recipe_ingredients ri
             JOIN ingredients ing_1 ON ing_1.id = ri.ingredient_id
        UNION ALL
         SELECT c.recipe_id,
            c.source_ingredient_id,
            c.quantite * fn_unit_conv(c.unite::text, ing_1.unit::text, ing_1.densite_kg_l)
              / NULLIF(1::numeric - COALESCE(c.perte_pct, 0::numeric) / 100::numeric, 0::numeric),
            c.quantite * fn_unit_conv(c.unite::text, ing_1.unit::text, ing_1.densite_kg_l) * COALESCE(ing_1.unit_cost, 0::numeric)
              / NULLIF(1::numeric - COALESCE(c.perte_pct, 0::numeric) / 100::numeric, 0::numeric)
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
