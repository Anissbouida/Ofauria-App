-- =====================================================
-- Register ALL missing reference tables + seed entries
-- =====================================================

-- 1. Types de contrat
INSERT INTO ref_tables (id, label, description, icon, source, editable, display_order) VALUES
  ('contract_types', 'Types de contrat', 'CDI, CDD, Stage, Interim...', 'FileText', 'ref_entries', true, 8)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ref_entries (table_id, code, label, display_order) VALUES
  ('contract_types', 'cdi',     'CDI',     1),
  ('contract_types', 'cdd',     'CDD',     2),
  ('contract_types', 'stage',   'Stage',   3),
  ('contract_types', 'interim', 'Interim', 4)
ON CONFLICT (table_id, code) DO NOTHING;

-- 2. Types de conge
INSERT INTO ref_tables (id, label, description, icon, source, editable, display_order) VALUES
  ('leave_types', 'Types de conge', 'Conge annuel, maladie, sans solde...', 'CalendarOff', 'ref_entries', true, 9)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ref_entries (table_id, code, label, display_order) VALUES
  ('leave_types', 'annual',    'Conge annuel', 1),
  ('leave_types', 'sick',      'Maladie',      2),
  ('leave_types', 'unpaid',    'Sans solde',   3),
  ('leave_types', 'maternity', 'Maternite',    4),
  ('leave_types', 'other',     'Autre',        5)
ON CONFLICT (table_id, code) DO NOTHING;

-- 3. Types de perte
INSERT INTO ref_tables (id, label, description, icon, source, editable, display_order) VALUES
  ('loss_types', 'Types de perte', 'Production, vitrine, perime, recyclage...', 'Trash2', 'ref_entries', true, 10)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ref_entries (table_id, code, label, color, display_order) VALUES
  ('loss_types', 'production', 'Production', '#f59e0b', 1),
  ('loss_types', 'vitrine',    'Vitrine',    '#ef4444', 2),
  ('loss_types', 'perime',     'Perime',     '#8b5cf6', 3),
  ('loss_types', 'recyclage',  'Recyclage',  '#10b981', 4)
ON CONFLICT (table_id, code) DO NOTHING;

-- 4. Motifs de perte production
INSERT INTO ref_tables (id, label, description, icon, source, editable, display_order) VALUES
  ('production_loss_reasons', 'Motifs de perte production', 'Brule, rate, machine, erreur humaine...', 'Flame', 'ref_entries', true, 11)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ref_entries (table_id, code, label, display_order) VALUES
  ('production_loss_reasons', 'brule',                'Brule',                1),
  ('production_loss_reasons', 'rate',                 'Rate',                 2),
  ('production_loss_reasons', 'machine',              'Panne machine',        3),
  ('production_loss_reasons', 'matiere_defectueuse',  'Matiere defectueuse',  4),
  ('production_loss_reasons', 'erreur_humaine',       'Erreur humaine',       5),
  ('production_loss_reasons', 'autre',                'Autre',                6)
ON CONFLICT (table_id, code) DO NOTHING;

-- 5. Destinations invendus
INSERT INTO ref_tables (id, label, description, icon, source, editable, display_order) VALUES
  ('unsold_destinations', 'Destinations invendus', 'Vitrine J+1, recycler, detruire...', 'PackageOpen', 'ref_entries', true, 12)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ref_entries (table_id, code, label, color, icon, display_order) VALUES
  ('unsold_destinations', 'reexpose', 'Vitrine J+1', '#f59e0b', 'RotateCcw',   1),
  ('unsold_destinations', 'recycle',  'Recycler',    '#10b981', 'Recycle',      2),
  ('unsold_destinations', 'waste',    'Detruire',    '#ef4444', 'Trash2',       3)
ON CONFLICT (table_id, code) DO NOTHING;

-- 6. Categories ingredients (achats)
INSERT INTO ref_tables (id, label, description, icon, source, editable, display_order) VALUES
  ('ingredient_categories', 'Categories ingredients', 'Farines, sucres, produits laitiers...', 'Wheat', 'ref_entries', true, 13)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ref_entries (table_id, code, label, display_order) VALUES
  ('ingredient_categories', 'farines',           'Farines',           1),
  ('ingredient_categories', 'sucres',            'Sucres',            2),
  ('ingredient_categories', 'produits_laitiers', 'Produits laitiers', 3),
  ('ingredient_categories', 'oeufs',             'Oeufs',             4),
  ('ingredient_categories', 'matieres_grasses',  'Matieres grasses',  5),
  ('ingredient_categories', 'fruits',            'Fruits',            6),
  ('ingredient_categories', 'chocolat',          'Chocolat',          7),
  ('ingredient_categories', 'fruits_secs',       'Fruits secs',       8),
  ('ingredient_categories', 'epices',            'Epices & aromes',   9),
  ('ingredient_categories', 'levures',           'Levures & agents',  10),
  ('ingredient_categories', 'emballages',        'Emballages',        11),
  ('ingredient_categories', 'autre',             'Autre',             12)
ON CONFLICT (table_id, code) DO NOTHING;
