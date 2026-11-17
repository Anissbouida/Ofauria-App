-- M3-01 (plan d'action 2026-11) — référentiel des unités par dimension.
--
-- Les unités vivent déjà dans ref_entries (table « units », mig 515), éditées dans
-- Paramètres › Référentiels, avec catégorie et facteur en métadonnées. On les complète
-- au lieu d'ouvrir une seconde table :
--   1. unités que fn_unit_conv convertit déjà mais absentes du référentiel : mg, cl, dl
--      (facteurs identiques) ; unités de temps : min (base), h ;
--   2. métadonnées : decimals (affichage), system (unités historiques, non modifiables
--      depuis l'écran des unités) ; « dz » reçoit sa dimension (pièce, 12) — aucun calcul
--      ne la lisait encore ;
--   3. v_units : vue normalisée (dimension en français, facteur vers l'unité de base de
--      la dimension) lue par l'écran Paramètres › Unités et par fn_convert_qty (M3-03) ;
--   4. unit_id à côté des colonnes texte d'unité des fiches (ingrédients, emballages,
--      recettes, lignes de composition) : clé « souple » (ON DELETE SET NULL), posée par
--      correspondance exacte du code et tenue à jour par déclencheur ; v_unit_unmatched
--      liste les lignes dont l'unité n'est pas au référentiel.
-- Aucune conversion ni aucun coût ne change : fn_unit_conv et les vues de coût sont
-- inchangées.
--
-- INVERSION :
--   DROP VIEW v_unit_unmatched, v_units;
--   DROP TRIGGER trg_sync_unit_id ON ingredients; (idem packaging_items, recipes,
--     recipe_ingredients, recipe_components, recipe_format_components)
--   DROP FUNCTION trg_fn_sync_unit_id();
--   ALTER TABLE … DROP COLUMN unit_id / yield_unit_id;
--   DELETE FROM ref_entries WHERE table_id = 'units' AND code IN ('mg','cl','dl','min','h');

INSERT INTO ref_entries (table_id, code, label, description, display_order, metadata) VALUES
  ('units', 'mg',  'Milligramme', 'Unité de masse',  1, '{"category":"mass","to_base":0.001,"is_base":false}'),
  ('units', 'cl',  'Centilitre',  'Unité de volume', 4, '{"category":"volume","to_base":10,"is_base":false}'),
  ('units', 'dl',  'Décilitre',   'Unité de volume', 4, '{"category":"volume","to_base":100,"is_base":false}'),
  ('units', 'min', 'Minute',      'Unité de temps',  9, '{"category":"time","to_base":1,"is_base":true}'),
  ('units', 'h',   'Heure',       'Unité de temps',  9, '{"category":"time","to_base":60,"is_base":false}')
ON CONFLICT (table_id, code) DO NOTHING;

UPDATE ref_entries SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"category":"count","to_base":12,"is_base":false}'::jsonb
 WHERE table_id = 'units' AND code = 'dz' AND NOT (COALESCE(metadata, '{}'::jsonb) ? 'category');

UPDATE ref_entries SET metadata = COALESCE(metadata, '{}'::jsonb)
       || jsonb_build_object('system', code IN ('mg', 'g', 'kg', 'ml', 'cl', 'dl', 'l', 'unit'))
       || jsonb_build_object('decimals', CASE WHEN code IN ('kg', 'l', 'h') THEN 3 WHEN code IN ('unit', 'dz') THEN 0 ELSE 2 END)
 WHERE table_id = 'units' AND NOT (COALESCE(metadata, '{}'::jsonb) ? 'system');

CREATE OR REPLACE VIEW v_units AS
SELECT e.id, e.code, e.label,
       CASE e.metadata->>'category'
         WHEN 'mass' THEN 'masse' WHEN 'volume' THEN 'volume' WHEN 'count' THEN 'piece'
         WHEN 'length' THEN 'longueur' WHEN 'area' THEN 'surface' WHEN 'time' THEN 'temps' ELSE NULL END AS dimension,
       NULLIF(e.metadata->>'to_base', '')::numeric AS factor,
       COALESCE((e.metadata->>'decimals')::int, 2) AS decimals,
       COALESCE((e.metadata->>'system')::boolean, false) AS is_system,
       COALESCE((e.metadata->>'is_base')::boolean, false) AS is_base,
       e.is_active, e.display_order
  FROM ref_entries e
 WHERE e.table_id = 'units' AND e.code IS NOT NULL;
COMMENT ON VIEW v_units IS 'Référentiel des unités (M3-01) : dimension, facteur vers l''unité de base de la dimension, décimales.';

ALTER TABLE ingredients              ADD COLUMN IF NOT EXISTS unit_id       uuid REFERENCES ref_entries(id) ON DELETE SET NULL;
ALTER TABLE packaging_items          ADD COLUMN IF NOT EXISTS unit_id       uuid REFERENCES ref_entries(id) ON DELETE SET NULL;
ALTER TABLE recipes                  ADD COLUMN IF NOT EXISTS yield_unit_id uuid REFERENCES ref_entries(id) ON DELETE SET NULL;
ALTER TABLE recipe_ingredients       ADD COLUMN IF NOT EXISTS unit_id       uuid REFERENCES ref_entries(id) ON DELETE SET NULL;
ALTER TABLE recipe_components        ADD COLUMN IF NOT EXISTS unit_id       uuid REFERENCES ref_entries(id) ON DELETE SET NULL;
ALTER TABLE recipe_format_components ADD COLUMN IF NOT EXISTS unit_id       uuid REFERENCES ref_entries(id) ON DELETE SET NULL;

-- Rattrapage par correspondance exacte du code (sans tenir compte de la casse).
UPDATE ingredients t SET unit_id = u.id FROM v_units u WHERE lower(t.unit) = lower(u.code) AND t.unit_id IS DISTINCT FROM u.id;
UPDATE packaging_items t SET unit_id = u.id FROM v_units u WHERE lower(t.unit) = lower(u.code) AND t.unit_id IS DISTINCT FROM u.id;
UPDATE recipes t SET yield_unit_id = u.id FROM v_units u WHERE lower(t.yield_unit) = lower(u.code) AND t.yield_unit_id IS DISTINCT FROM u.id;
UPDATE recipe_ingredients t SET unit_id = u.id FROM v_units u WHERE lower(t.unit) = lower(u.code) AND t.unit_id IS DISTINCT FROM u.id;
UPDATE recipe_components t SET unit_id = u.id FROM v_units u WHERE lower(t.unite) = lower(u.code) AND t.unit_id IS DISTINCT FROM u.id;
UPDATE recipe_format_components t SET unit_id = u.id FROM v_units u WHERE lower(t.unite) = lower(u.code) AND t.unit_id IS DISTINCT FROM u.id;

-- Tenue à jour : TG_ARGV[0] = colonne texte, TG_ARGV[1] = colonne de clé.
CREATE OR REPLACE FUNCTION trg_fn_sync_unit_id()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_code text := to_jsonb(NEW) ->> TG_ARGV[0]; v_id uuid;
BEGIN
  SELECT id INTO v_id FROM ref_entries WHERE table_id = 'units' AND lower(code) = lower(v_code) LIMIT 1;
  NEW := jsonb_populate_record(NEW, jsonb_build_object(TG_ARGV[1], v_id));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_unit_id ON ingredients;
CREATE TRIGGER trg_sync_unit_id BEFORE INSERT OR UPDATE OF unit ON ingredients
  FOR EACH ROW EXECUTE FUNCTION trg_fn_sync_unit_id('unit', 'unit_id');
DROP TRIGGER IF EXISTS trg_sync_unit_id ON packaging_items;
CREATE TRIGGER trg_sync_unit_id BEFORE INSERT OR UPDATE OF unit ON packaging_items
  FOR EACH ROW EXECUTE FUNCTION trg_fn_sync_unit_id('unit', 'unit_id');
DROP TRIGGER IF EXISTS trg_sync_unit_id ON recipes;
CREATE TRIGGER trg_sync_unit_id BEFORE INSERT OR UPDATE OF yield_unit ON recipes
  FOR EACH ROW EXECUTE FUNCTION trg_fn_sync_unit_id('yield_unit', 'yield_unit_id');
DROP TRIGGER IF EXISTS trg_sync_unit_id ON recipe_ingredients;
CREATE TRIGGER trg_sync_unit_id BEFORE INSERT OR UPDATE OF unit ON recipe_ingredients
  FOR EACH ROW EXECUTE FUNCTION trg_fn_sync_unit_id('unit', 'unit_id');
DROP TRIGGER IF EXISTS trg_sync_unit_id ON recipe_components;
CREATE TRIGGER trg_sync_unit_id BEFORE INSERT OR UPDATE OF unite ON recipe_components
  FOR EACH ROW EXECUTE FUNCTION trg_fn_sync_unit_id('unite', 'unit_id');
DROP TRIGGER IF EXISTS trg_sync_unit_id ON recipe_format_components;
CREATE TRIGGER trg_sync_unit_id BEFORE INSERT OR UPDATE OF unite ON recipe_format_components
  FOR EACH ROW EXECUTE FUNCTION trg_fn_sync_unit_id('unite', 'unit_id');

CREATE OR REPLACE VIEW v_unit_unmatched AS
          SELECT 'ingredients'::text AS table_name, id::text AS row_id, name::text AS label, unit::text AS unit FROM ingredients WHERE unit IS NOT NULL AND unit_id IS NULL
UNION ALL SELECT 'packaging_items', id::text, name::text, unit::text FROM packaging_items WHERE unit IS NOT NULL AND unit_id IS NULL
UNION ALL SELECT 'recipes', id::text, name::text, yield_unit::text FROM recipes WHERE yield_unit IS NOT NULL AND yield_unit_id IS NULL
UNION ALL SELECT 'recipe_ingredients', id::text, recipe_id::text, unit::text FROM recipe_ingredients WHERE unit IS NOT NULL AND unit_id IS NULL
UNION ALL SELECT 'recipe_components', id::text, recipe_id::text, unite::text FROM recipe_components WHERE unite IS NOT NULL AND unit_id IS NULL
UNION ALL SELECT 'recipe_format_components', id::text, format_id::text, unite::text FROM recipe_format_components WHERE unite IS NOT NULL AND unit_id IS NULL;
