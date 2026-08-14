-- Migration 265 : Perte par ligne de composant (audit A5, P1)
--
-- POURQUOI
--   La perte n'existe aujourd'hui qu'au niveau recette (recipes.perte_standard_pct,
--   majoration brut/net dans v_recipe_total_cost). Le standard ERP (SAP « component
--   scrap », Odoo « waste % » sur ligne de BOM, X3 « % perte ») met AUSSI la perte
--   sur la ligne : 5 % de casse sur les fonds de tarte a l'assemblage, 2 % de
--   coulage sur le nappage, epluchage sur les fruits. Aujourd'hui ces pertes
--   sont invisibles du cout theorique et gonflent les ecarts standard/reel sans
--   explication.
--
--   Semantique : la quantite saisie est la quantite NETTE (ce qui doit finir
--   dans le produit) ; le facteur applique est `qty_brute = qty_saisie / (1 -
--   perte_pct/100)`, appliquee tant sur le cout (v_recipe_component_cost) que
--   sur les besoins (helper TS). Comme pour recipes.perte_standard_pct, la
--   perte majore la matiere consommee sans changer la quantite affichee.
--
--   Defaut 0 : les compositions existantes gardent EXACTEMENT le meme cout.
--
-- PORTEE
--   + colonne perte_pct sur recipe_format_components (idem sur recipe_components
--     — table miroir du format par defaut, mig 205)
--   + refonte v_recipe_component_cost et v_recipe_compose_cost pour appliquer
--     la majoration (DROP CASCADE puis re-CREATE)
--   Aucune donnee modifiee.
--
-- INVERSION
--   ALTER TABLE recipe_format_components DROP COLUMN perte_pct;
--   ALTER TABLE recipe_components DROP COLUMN perte_pct;
--   Restaurer les 2 vues telles quelles depuis la mig 260.

ALTER TABLE recipe_format_components
  ADD COLUMN IF NOT EXISTS perte_pct NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (perte_pct >= 0 AND perte_pct < 100);
ALTER TABLE recipe_components
  ADD COLUMN IF NOT EXISTS perte_pct NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (perte_pct >= 0 AND perte_pct < 100);

COMMENT ON COLUMN recipe_format_components.perte_pct IS
  'Perte % par ligne (mig 265). qty_saisie = quantite NETTE ; qty_brute = qty / (1 - perte/100). Majore le cout et les besoins.';
COMMENT ON COLUMN recipe_components.perte_pct IS
  'Miroir de recipe_format_components.perte_pct pour le format par defaut (mig 265).';

-- Recreer les vues : la majoration brute s'ajoute sous forme d'un
-- multiplicateur / (1 - perte_pct/100), garde 1 si perte_pct = 0.
DROP VIEW IF EXISTS v_recipe_compose_cost;
DROP VIEW IF EXISTS v_recipe_component_cost;

CREATE VIEW v_recipe_component_cost AS
SELECT c.id        AS component_id,
       c.format_id,
       c.role,
       CASE
         WHEN c.source_recipe_id IS NOT NULL THEN
           c.quantite
             * fn_unit_conv(c.unite, br.yield_unit)
             * COALESCE(brc.total_cost, 0)
             / NULLIF(br.yield_quantity * (1 - COALESCE(br.perte_standard_pct, 0) / 100), 0)
             / NULLIF(1 - COALESCE(c.perte_pct, 0) / 100, 0)   -- Mig 265 : perte ligne
         ELSE
           c.quantite
             * fn_unit_conv(c.unite, ing.unit::text)
             * COALESCE(ing.unit_cost, 0)
             / NULLIF(1 - COALESCE(c.perte_pct, 0) / 100, 0)   -- Mig 265 : perte ligne
       END AS cout_dh,
       CASE
         WHEN c.source_recipe_id IS NOT NULL THEN
           fn_unit_conv_ok(c.unite, br.yield_unit)
         ELSE
           fn_unit_conv_ok(c.unite, ing.unit::text)
             OR (
               ((lower(c.unite) IN ('g','kg','mg')      AND lower(ing.unit::text) IN ('ml','cl','dl','l'))
                OR (lower(c.unite) IN ('ml','cl','dl','l') AND lower(ing.unit::text) IN ('g','kg','mg')))
               AND ing.densite_kg_l IS NOT NULL
             )
       END AS conversion_ok
FROM recipe_format_components c
LEFT JOIN recipes              br  ON br.id  = c.source_recipe_id
LEFT JOIN v_recipe_total_cost  brc ON brc.id = c.source_recipe_id
LEFT JOIN ingredients          ing ON ing.id = c.source_ingredient_id;

CREATE VIEW v_recipe_compose_cost AS
SELECT f.recipe_id,
       f.id          AS format_id,
       f.is_default,
       COALESCE(vdc.direct_cost, 0)
       + COALESCE(cc.sum_comp, 0)
       + f.cout_emballage_unitaire AS cout_compose_dh,
       COALESCE(cc.bad_conversions_count, 0) AS bad_conversions_count
FROM recipe_formats f
LEFT JOIN v_recipe_direct_cost vdc ON vdc.id = f.recipe_id
LEFT JOIN (
  SELECT format_id,
         SUM(cout_dh) AS sum_comp,
         COUNT(*) FILTER (WHERE conversion_ok = false) AS bad_conversions_count
  FROM v_recipe_component_cost
  GROUP BY format_id
) cc ON cc.format_id = f.id;

COMMENT ON VIEW v_recipe_component_cost IS
  'Cout par composant (mig 265). cout_dh integre perte_pct de la ligne (qty_effective = qty / (1 - perte/100)). conversion_ok mig 260.';
COMMENT ON VIEW v_recipe_compose_cost IS
  'Cout compose par format. bad_conversions_count > 0 -> UI signale.';
