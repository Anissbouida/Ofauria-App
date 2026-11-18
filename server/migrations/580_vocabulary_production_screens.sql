-- M8-03 — Vocabulaire complet des écrans de fabrication (premier lot : nomenclatures).
-- Les libellés sectoriels (mig 495, 510, 514) ne couvraient que les menus. Ces clés couvrent
-- l'intérieur des écrans : onglets, colonnes, types de fiche, saisie des quantités.
-- Valeur par défaut dans le code = terme actuel de la boulangerie : ce secteur ne reçoit
-- aucune ligne et ne change pas. Option « mode_fournee » (saisie par fournée, coupe, pâte
-- à découper) : active pour la boulangerie seulement ; ailleurs, l'écran saisit par unité.
-- Rollback : DELETE FROM sector_labels WHERE label_key IN (… clés ci-dessous …) ;
--   UPDATE sector_packs SET features = array_remove(features, 'mode_fournee') ;
--   DELETE FROM app_features WHERE key = 'mode_fournee'.

INSERT INTO app_features (key, module_key, label, description, sort_order) VALUES
  ('mode_fournee', 'production', 'Saisie par fournée et coupe',
   'Quantités saisies pour une fournée entière (plaque, cadre) puis découpée en pièces ; coupe mixte à la déclaration.', 25)
ON CONFLICT (key) DO NOTHING;

UPDATE sector_packs SET features = array_append(features, 'mode_fournee')
 WHERE code = 'boulangerie' AND NOT ('mode_fournee' = ANY (features));

INSERT INTO sector_labels (sector_pack, label_key, label_value)
SELECT sp.code, v.k, v.val
  FROM sector_packs sp
 CROSS JOIN (VALUES
    ('finished_products_tab', 'Nomenclatures produits finis'),
    ('finished_product',      'Produit fini'),
    ('base_preps',            'Sous-ensembles'),
    ('base_prep',             'Sous-ensemble'),
    ('formats_tab',           'Conditionnements'),
    ('yield',                 'Quantité de base'),
    ('batch',                 'Lot de fabrication'),
    ('batch_cost',            'Coût du lot'),
    ('search_recipes',        'Rechercher une nomenclature ou un article…'),
    ('search_base_preps',     'Rechercher un sous-ensemble…')
 ) AS v(k, val)
 WHERE sp.code IN ('fabrication', 'generique', 'negoce')
ON CONFLICT (sector_pack, label_key) DO NOTHING;
