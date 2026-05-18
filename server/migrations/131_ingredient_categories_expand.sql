-- Expand ingredient categories: lait, cremes, beurre, fromages, poissons_fruits_de_mer
-- Keeps existing categories intact for backward compatibility

INSERT INTO ref_entries (table_id, code, label, display_order)
VALUES
  ('ingredient_categories', 'lait',                  'Lait & Boissons lactées',             13),
  ('ingredient_categories', 'cremes',                'Crèmes (fraîche, liquide, épaisse)',   14),
  ('ingredient_categories', 'beurre',                'Beurre & Margarines',                 15),
  ('ingredient_categories', 'fromages',              'Fromages & Fromages frais',           16),
  ('ingredient_categories', 'poissons_fruits_de_mer','Poissons & Fruits de mer',            17),
  ('ingredient_categories', 'viandes',               'Viandes & Volailles',                 18),
  ('ingredient_categories', 'legumes',               'Légumes',                             19),
  ('ingredient_categories', 'sauces',                'Sauces & Condiments',                 20),
  ('ingredient_categories', 'conserves',             'Conserves',                           21),
  ('ingredient_categories', 'decors',                'Décors & Garnitures',                 22),
  ('ingredient_categories', 'gelifiants',            'Gélifiants',                          23),
  ('ingredient_categories', 'preparations',          'Préparations',                        24),
  ('ingredient_categories', 'pates_riz',             'Pâtes & Riz',                         25),
  ('ingredient_categories', 'sel_vinaigre',          'Sel & Vinaigre',                      26),
  ('ingredient_categories', 'colorants',             'Colorants',                           27)
ON CONFLICT (table_id, code) DO UPDATE
  SET label         = EXCLUDED.label,
      display_order = EXCLUDED.display_order;

-- Update labels of existing categories to be more explicit
UPDATE ref_entries
SET label = 'Matières grasses & Huiles'
WHERE table_id = 'ingredient_categories' AND code = 'matieres_grasses';

UPDATE ref_entries
SET label = 'Produits laitiers (divers)'
WHERE table_id = 'ingredient_categories' AND code = 'produits_laitiers';
