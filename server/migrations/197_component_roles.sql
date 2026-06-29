-- Migration 197 : Référentiel des rôles de composant (component_roles)
--
-- POURQUOI
--   Un produit composé (tarte, entremets, cake garni…) est fait de plusieurs
--   recettes de base jouant des RÔLES différents (fond, garniture, nappage…).
--   On veut ces rôles CONFIGURABLES par l'atelier — pas un ENUM figé « tarte ».
--   On réutilise l'infra ref_tables / ref_entries (comme yield_units, mig 075).
--
-- PORTÉE
--   Ajoute 1 table_id 'component_roles' dans ref_tables + ses entrées.
--   Le trigger trg_sync_ref_to_expense_categories ne sync QUE
--   ingredient_categories / packaging_categories → aucun effet de bord ici.
--   Aucune donnée existante modifiée.
--
-- INVERSION
--   DELETE FROM ref_entries WHERE table_id='component_roles';
--   DELETE FROM ref_tables WHERE id='component_roles';

INSERT INTO ref_tables (id, label, description, source, editable)
VALUES ('component_roles', 'Rôles de composant',
        'Rôles d''un composant dans un produit composé (fond, garniture, nappage…)',
        'ref_entries', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ref_entries (table_id, code, label, description, display_order, is_active) VALUES
  ('component_roles', 'fond',         'Fond / base',        'Pâte ou base support (sucrée, sablée, brisée…)', 1, true),
  ('component_roles', 'biscuit',      'Biscuit / génoise',  'Biscuit, génoise, dacquoise',                    2, true),
  ('component_roles', 'croustillant', 'Croustillant',       'Couche croustillante (praliné, streusel…)',      3, true),
  ('component_roles', 'garniture',    'Garniture / crème',  'Crème, mousse, appareil',                        4, true),
  ('component_roles', 'insert',       'Insert',             'Insert coeur (crémeux, confit, compotée)',       5, true),
  ('component_roles', 'fruits',       'Fruits',             'Fruits frais ou préparés',                       6, true),
  ('component_roles', 'nappage',      'Nappage',            'Nappage, glaçage liquide de finition',           7, true),
  ('component_roles', 'glacage',      'Glaçage',            'Glaçage miroir / rocher d''enrobage',            8, true),
  ('component_roles', 'decor',        'Décor',              'Décor (amandes, copeaux, éléments)',             9, true),
  ('component_roles', 'emballage',    'Emballage',          'Conditionnement du format',                     10, true)
ON CONFLICT (table_id, code) DO NOTHING;
