-- Migration 205 : Composition au niveau RECETTE (indépendante du format/contenant)
--
-- POURQUOI
--   La composition était accrochée à un FORMAT (recipe_format_components.format_id),
--   lui-même lié à un contenant obligatoire. On remonte la composition au niveau
--   RECETTE : une recette = ses composants + son rendement, sans format ni contenant.
--   Le format/contenant devient une couche optionnelle de production.
--
-- PORTÉE
--   - Nouvelle table recipe_components (clé recipe_id).
--   - Reprise depuis recipe_format_components du format par défaut (1 compo/recette).
--   - v_recipe_total_cost rebranchée sur recipe_components (au lieu du format défaut).
--     Numériquement identique (reprise 1:1). Les vues format (v_recipe_component_cost,
--     v_recipe_compose_cost) restent en place jusqu'au retrait de l'API format.
--   - v_rcomp_cost : coût par composant recette (pour l'éditeur).
--
-- INVERSION : restaurer v_recipe_total_cost (mig 204) ; DROP TABLE recipe_components ;
--             DROP VIEW v_rcomp_cost.

CREATE TABLE IF NOT EXISTS recipe_components (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id            UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  role                 VARCHAR(60),
  source_recipe_id     UUID REFERENCES recipes(id)     ON DELETE RESTRICT,
  source_ingredient_id UUID REFERENCES ingredients(id) ON DELETE RESTRICT,
  quantite             NUMERIC(12,4) NOT NULL,
  unite                VARCHAR(10)   NOT NULL DEFAULT 'g',
  ordre                SMALLINT      NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_rc_one_source CHECK (
    (source_recipe_id IS NOT NULL)::int + (source_ingredient_id IS NOT NULL)::int = 1
  ),
  CONSTRAINT chk_rc_quantite CHECK (quantite > 0)
);
CREATE INDEX IF NOT EXISTS idx_rc_recipe ON recipe_components (recipe_id);

-- Reprise : composition du format par défaut -> composition recette (idempotent).
INSERT INTO recipe_components (recipe_id, role, source_recipe_id, source_ingredient_id, quantite, unite, ordre)
SELECT f.recipe_id, c.role, c.source_recipe_id, c.source_ingredient_id, c.quantite, c.unite, c.ordre
FROM recipe_format_components c
JOIN recipe_formats f ON f.id = c.format_id AND f.is_default
WHERE NOT EXISTS (SELECT 1 FROM recipe_components rc WHERE rc.recipe_id = f.recipe_id);

-- Coût récursif rebranché sur recipe_components (compose) ; ratio_poids inchangé.
CREATE OR REPLACE VIEW v_recipe_total_cost AS
WITH RECURSIVE
own AS (
  SELECT r.id,
         COALESCE(dc.direct_cost, 0)
         + CASE WHEN r.mode_cout = 'compose' THEN COALESCE((
             SELECT SUM(c.quantite * fn_unit_conv(c.unite, ing.unit::text) * COALESCE(ing.unit_cost, 0))
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

-- Coût par composant recette (pour l'éditeur niveau recette).
CREATE OR REPLACE VIEW v_rcomp_cost AS
SELECT c.id AS component_id, c.recipe_id, c.role,
       CASE
         WHEN c.source_recipe_id IS NOT NULL THEN
           c.quantite * fn_unit_conv(c.unite, br.yield_unit) * COALESCE(brc.total_cost, 0)
             / NULLIF(br.yield_quantity * (1 - COALESCE(br.perte_standard_pct, 0) / 100), 0)
         ELSE
           c.quantite * fn_unit_conv(c.unite, ing.unit::text) * COALESCE(ing.unit_cost, 0)
       END AS cout_dh
FROM recipe_components c
LEFT JOIN recipes             br  ON br.id  = c.source_recipe_id
LEFT JOIN v_recipe_total_cost brc ON brc.id = c.source_recipe_id
LEFT JOIN ingredients         ing ON ing.id = c.source_ingredient_id;
