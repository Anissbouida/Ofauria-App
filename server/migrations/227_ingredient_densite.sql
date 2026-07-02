-- Migration 227 : masse volumique des ingredients (conversion poids <-> volume)
--
-- POURQUOI
--   Les chefs pesent tout, y compris les liquides : une recette dit "1.2 kg de
--   lait" alors que le lait est stocke/achete en litres. Jusqu'ici toute
--   conversion cross-base (g -> l) etait silencieusement ignoree (facteur 1) :
--   fn_unit_conv (mig 203) et v_recipe_direct_cost (mig 145, "les conversions
--   cross-base ne sont jamais legitimes") -> couts ET besoins faux.
--
-- QUOI
--   1. ingredients.densite_kg_l : masse volumique en kg/L (== g/ml).
--      NULL = inconnue -> les conversions cross-base restent en facteur 1 et le
--      calcul des besoins remonte un warning explicite (plus de silence).
--   2. fn_unit_conv(from, to, densite) : surcharge 3 args qui gere poids<->volume.
--   3. Vues de cout rebranchees sur la surcharge pour les ingredients :
--      v_recipe_direct_cost (derniere version : mig 145),
--      v_recipe_total_cost + v_rcomp_cost (derniere version : mig 205).
--      Branche sous-recettes inchangee (une recette n'a pas de densite).
--   4. Seed prudent des densites usuelles (eau, lait, creme, huile) uniquement
--      pour les ingredients stockes en volume et sans densite deja saisie.
--
-- La quantite SAISIE dans la recette n'est jamais modifiee : la densite ne sert
-- qu'a traduire vers l'unite de stock (besoins, BSI/FEFO, couts).
--
-- INVERSION : DROP FUNCTION fn_unit_conv(text, text, numeric) ;
--   restaurer v_recipe_direct_cost (mig 145), v_recipe_total_cost + v_rcomp_cost
--   (mig 205) ; ALTER TABLE ingredients DROP COLUMN densite_kg_l.

-- 1. Colonne densite (kg/L). Eau = 1.000, lait ~1.030, creme ~1.010, huile ~0.920.
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS densite_kg_l NUMERIC(6,3)
  CHECK (densite_kg_l IS NULL OR densite_kg_l > 0);

COMMENT ON COLUMN ingredients.densite_kg_l IS
  'Masse volumique en kg/L (= g/ml). Sert a convertir une saisie recette en poids (g/kg) vers une unite de stock en volume (ml/l), et inversement. NULL = conversion poids<->volume impossible (warning).';

-- 2. Surcharge de fn_unit_conv avec densite. Meme famille -> delegue a la
--    version 2 args (mig 203). Cross-base sans densite -> facteur 1 (comme avant,
--    le warning applicatif prend le relais).
CREATE OR REPLACE FUNCTION fn_unit_conv(p_from text, p_to text, p_densite numeric)
RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    -- Poids -> volume : qty_g / densite(g/ml) = qty_ml
    WHEN lower(p_from) IN ('mg','g','kg') AND lower(p_to) IN ('ml','cl','dl','l')
         AND COALESCE(p_densite, 0) > 0
      THEN fn_unit_conv(p_from, 'g') / p_densite * fn_unit_conv('ml', p_to)
    -- Volume -> poids : qty_ml * densite(g/ml) = qty_g
    WHEN lower(p_from) IN ('ml','cl','dl','l') AND lower(p_to) IN ('mg','g','kg')
         AND COALESCE(p_densite, 0) > 0
      THEN fn_unit_conv(p_from, 'ml') * p_densite * fn_unit_conv('g', p_to)
    -- Meme famille (ou unites inconnues) : comportement historique
    ELSE fn_unit_conv(p_from, p_to)
  END
$$;

-- 3a. v_recipe_direct_cost (base : mig 145) — le CASE manuel est remplace par
--     fn_unit_conv 3 args (couvre g/kg, l/cl/ml ET poids<->volume avec densite).
CREATE OR REPLACE VIEW v_recipe_direct_cost AS
SELECT r.id,
       r.yield_quantity,
       (
         COALESCE((
           SELECT SUM(
             ri.quantity * COALESCE(ing.unit_cost, 0)
             * fn_unit_conv(COALESCE(NULLIF(ri.unit, ''), ing.unit), ing.unit, ing.densite_kg_l)
           )
           FROM recipe_ingredients ri
           JOIN ingredients ing ON ing.id = ri.ingredient_id
           WHERE ri.recipe_id = r.id
         ), 0)
         +
         COALESCE((
           SELECT SUM(rp.quantity * COALESCE(pi.unit_cost, 0))
           FROM recipe_packaging rp
           JOIN packaging_items pi ON pi.id = rp.packaging_id
           WHERE rp.recipe_id = r.id
         ), 0)
       ) AS direct_cost
FROM recipes r;

COMMENT ON VIEW v_recipe_direct_cost IS
  'Cout direct (ingredients + emballages) recalcule a la volee. Conversions via fn_unit_conv 3 args : g/kg, l/cl/ml, et poids<->volume par densite_kg_l.';

-- 3b. v_recipe_total_cost (base : mig 205) — branche ingredient compose en 3 args.
CREATE OR REPLACE VIEW v_recipe_total_cost AS
WITH RECURSIVE
own AS (
  SELECT r.id,
         COALESCE(dc.direct_cost, 0)
         + CASE WHEN r.mode_cout = 'compose' THEN COALESCE((
             SELECT SUM(c.quantite * fn_unit_conv(c.unite, ing.unit::text, ing.densite_kg_l) * COALESCE(ing.unit_cost, 0))
             FROM recipe_components c
             JOIN ingredients ing ON ing.id = c.source_ingredient_id
             WHERE c.recipe_id = r.id AND c.source_ingredient_id IS NOT NULL
           ), 0) ELSE 0 END AS own_cost
  FROM recipes r
  LEFT JOIN v_recipe_direct_cost dc ON dc.id = r.id
),
edges AS (
  SELECT r.id AS parent, rsr.sub_recipe_id AS child,
         rsr.quantity / NULLIF(ch.yield_quantity, 0) AS frac
  FROM recipes r
  JOIN recipe_sub_recipes rsr ON rsr.recipe_id = r.id
  JOIN recipes ch ON ch.id = rsr.sub_recipe_id
  WHERE r.mode_cout <> 'compose'
  UNION ALL
  SELECT r.id, c.source_recipe_id,
         c.quantite * fn_unit_conv(c.unite, ch.yield_unit)
           / NULLIF(ch.yield_quantity * (1 - COALESCE(ch.perte_standard_pct, 0) / 100), 0)
  FROM recipes r
  JOIN recipe_components c ON c.recipe_id = r.id AND c.source_recipe_id IS NOT NULL
  JOIN recipes ch ON ch.id = c.source_recipe_id
  WHERE r.mode_cout = 'compose'
),
expand AS (
  SELECT r.id AS root, r.id AS node, 1::numeric AS mult, 0 AS depth FROM recipes r
  UNION ALL
  SELECT e.root, eg.child, e.mult * eg.frac, e.depth + 1
  FROM expand e JOIN edges eg ON eg.parent = e.node
  WHERE e.depth < 12
)
SELECT x.root AS id, SUM(o.own_cost * x.mult) AS total_cost
FROM expand x JOIN own o ON o.id = x.node
GROUP BY x.root;

-- 3c. v_rcomp_cost (base : mig 205) — branche ingredient en 3 args.
CREATE OR REPLACE VIEW v_rcomp_cost AS
SELECT c.id AS component_id, c.recipe_id, c.role,
       CASE
         WHEN c.source_recipe_id IS NOT NULL THEN
           c.quantite * fn_unit_conv(c.unite, br.yield_unit) * COALESCE(brc.total_cost, 0)
             / NULLIF(br.yield_quantity * (1 - COALESCE(br.perte_standard_pct, 0) / 100), 0)
         ELSE
           c.quantite * fn_unit_conv(c.unite, ing.unit::text, ing.densite_kg_l) * COALESCE(ing.unit_cost, 0)
       END AS cout_dh
FROM recipe_components c
LEFT JOIN recipes             br  ON br.id  = c.source_recipe_id
LEFT JOIN v_recipe_total_cost brc ON brc.id = c.source_recipe_id
LEFT JOIN ingredients         ing ON ing.id = c.source_ingredient_id;

-- 3d. v_recipe_component_cost (base : mig 203, niveau format) — branche
--     ingredient en 3 args. v_recipe_compose_cost la lit, rien d'autre a changer.
CREATE OR REPLACE VIEW v_recipe_component_cost AS
SELECT c.id        AS component_id,
       c.format_id,
       c.role,
       CASE
         WHEN c.source_recipe_id IS NOT NULL THEN
           c.quantite
             * fn_unit_conv(c.unite, br.yield_unit)
             * COALESCE(brc.total_cost, 0)
             / NULLIF(br.yield_quantity * (1 - COALESCE(br.perte_standard_pct, 0) / 100), 0)
         ELSE
           c.quantite
             * fn_unit_conv(c.unite, ing.unit::text, ing.densite_kg_l)
             * COALESCE(ing.unit_cost, 0)
       END AS cout_dh
FROM recipe_format_components c
LEFT JOIN recipes              br  ON br.id  = c.source_recipe_id
LEFT JOIN v_recipe_total_cost  brc ON brc.id = c.source_recipe_id
LEFT JOIN ingredients          ing ON ing.id = c.source_ingredient_id;

-- 4. Seed prudent des densites usuelles : uniquement les ingredients stockes en
--    VOLUME (l/ml/cl), sans densite deja renseignee, avec le mot exact dans le
--    nom (\m...\M = limites de mot, evite "gateau" pour "eau").
UPDATE ingredients SET densite_kg_l = 1.030
 WHERE densite_kg_l IS NULL AND unit IN ('l','ml','cl') AND name ~* '\mlait\M';
UPDATE ingredients SET densite_kg_l = 1.010
 WHERE densite_kg_l IS NULL AND unit IN ('l','ml','cl') AND name ~* '\mcr[eè]me\M';
UPDATE ingredients SET densite_kg_l = 0.920
 WHERE densite_kg_l IS NULL AND unit IN ('l','ml','cl') AND name ~* '\mhuile\M';
UPDATE ingredients SET densite_kg_l = 1.000
 WHERE densite_kg_l IS NULL AND unit IN ('l','ml','cl') AND name ~* '\meau\M';
