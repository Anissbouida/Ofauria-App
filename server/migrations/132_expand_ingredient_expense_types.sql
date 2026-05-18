-- Expand Matières premières > Ingredients types in expense_categories
-- Adds: Lait, Crèmes, Chocolat, Matières grasses, Levures, Épices,
--       Viandes & Volailles, Poissons & Fruits de mer, Légumes, Fruits, Fruits secs
-- Moves "Autres ingrédients" to end

-- Parent: Ingredients subcategory
-- parent_id = 20000000-0000-0000-0000-000000000004

INSERT INTO expense_categories (id, name, type, parent_id, level, display_order, is_active, requires_po)
VALUES
  ('30000000-0000-0000-0000-000000000035', 'Lait & Produits laitiers',  'expense', '20000000-0000-0000-0000-000000000004', 3,  5,  true, true),
  ('30000000-0000-0000-0000-000000000036', 'Crèmes',                    'expense', '20000000-0000-0000-0000-000000000004', 3,  6,  true, true),
  ('30000000-0000-0000-0000-000000000037', 'Chocolat & Cacao',          'expense', '20000000-0000-0000-0000-000000000004', 3,  7,  true, true),
  ('30000000-0000-0000-0000-000000000038', 'Matières grasses & Huiles', 'expense', '20000000-0000-0000-0000-000000000004', 3,  8,  true, true),
  ('30000000-0000-0000-0000-000000000039', 'Levures & Agents levants',  'expense', '20000000-0000-0000-0000-000000000004', 3,  9,  true, true),
  ('30000000-0000-0000-0000-000000000040', 'Épices & Arômes',           'expense', '20000000-0000-0000-0000-000000000004', 3, 10,  true, true),
  ('30000000-0000-0000-0000-000000000041', 'Viandes & Volailles',       'expense', '20000000-0000-0000-0000-000000000004', 3, 11,  true, true),
  ('30000000-0000-0000-0000-000000000042', 'Poissons & Fruits de mer',  'expense', '20000000-0000-0000-0000-000000000004', 3, 12,  true, true),
  ('30000000-0000-0000-0000-000000000043', 'Légumes',                   'expense', '20000000-0000-0000-0000-000000000004', 3, 13,  true, true),
  ('30000000-0000-0000-0000-000000000044', 'Fruits & Purées',           'expense', '20000000-0000-0000-0000-000000000004', 3, 14,  true, true),
  ('30000000-0000-0000-0000-000000000045', 'Fruits secs & Oléagineux',  'expense', '20000000-0000-0000-0000-000000000004', 3, 15,  true, true)
ON CONFLICT (id) DO NOTHING;

-- Move "Autres ingrédients" to end
UPDATE expense_categories
SET display_order = 99
WHERE id = '30000000-0000-0000-0000-000000000016';
