-- Add yield_unit to recipes for flexible rendement measurement
-- e.g. "5 kg" for pate a croissant, "3 moules" for genoise, "2 L" for creme

-- Change yield_quantity from INT to DECIMAL for fractional yields (e.g. 2.5 kg)
ALTER TABLE recipes ALTER COLUMN yield_quantity TYPE DECIMAL(10,2) USING yield_quantity::DECIMAL(10,2);

-- Add yield_unit column (default 'unit' for backward compat)
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS yield_unit VARCHAR(20) DEFAULT 'unit';

-- Also update recipe_versions to track yield_unit
ALTER TABLE recipe_versions ALTER COLUMN yield_quantity TYPE DECIMAL(10,2) USING yield_quantity::DECIMAL(10,2);
ALTER TABLE recipe_versions ADD COLUMN IF NOT EXISTS yield_unit VARCHAR(20) DEFAULT 'unit';

-- Seed yield_units referentiel table
INSERT INTO ref_tables (id, label, description, source, editable)
VALUES ('yield_units', 'Unites de rendement', 'Unites de mesure pour le rendement des recettes', 'ref_entries', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ref_entries (table_id, code, label, description, display_order, is_active) VALUES
  ('yield_units', 'unit',  'Unite(s)',    'Pieces, parts individuelles',   1, true),
  ('yield_units', 'kg',    'Kilogramme',  'Poids en kg (pate, farce...)',  2, true),
  ('yield_units', 'g',     'Gramme',      'Poids en grammes',              3, true),
  ('yield_units', 'l',     'Litre',       'Volume en litres (creme, sirop...)', 4, true),
  ('yield_units', 'ml',    'Millilitre',  'Volume en ml',                  5, true),
  ('yield_units', 'moule', 'Moule(s)',    'Par moule (genoise, cake...)',   6, true),
  ('yield_units', 'plaque','Plaque(s)',   'Par plaque de cuisson',         7, true),
  ('yield_units', 'batch', 'Fournee(s)',  'Par fournee',                   8, true)
ON CONFLICT DO NOTHING;
