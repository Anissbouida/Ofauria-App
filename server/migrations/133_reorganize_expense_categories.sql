-- Comprehensive reorganization of expense_categories for a boulangerie
-- Fixes:
--   1. Level inconsistencies (items at level=3 directly under level=1)
--   2. Missing subcategories for Energie, Entretien, Loyer, Transport, Equipements, Divers
--   3. Category and type names (accents, clarity)
--   4. Adds all missing leaf types

-- ─── STEP 1: Fix level-1 category labels ────────────────────────────────────

UPDATE expense_categories SET name = 'Matières premières'    WHERE id = '10000000-0000-0000-0000-000000000003';
UPDATE expense_categories SET name = 'Énergie'               WHERE id = '10000000-0000-0000-0000-000000000001';
UPDATE expense_categories SET name = 'Entretien & Maintenance' WHERE id = '10000000-0000-0000-0000-000000000005';
UPDATE expense_categories SET name = 'Loyer & Charges'       WHERE id = '10000000-0000-0000-0000-000000000006';
UPDATE expense_categories SET name = 'Équipements & Matériel' WHERE id = '10000000-0000-0000-0000-000000000008';

-- ─── STEP 2: Fix level-2 subcategory labels ──────────────────────────────────

UPDATE expense_categories SET name = 'Ingrédients'           WHERE id = '20000000-0000-0000-0000-000000000004';
UPDATE expense_categories SET name = 'Primes & Indemnités'   WHERE id = '20000000-0000-0000-0000-000000000007';
UPDATE expense_categories SET name = 'Fiscalité'             WHERE id = '20000000-0000-0000-0000-000000000002';
UPDATE expense_categories SET name = 'Frais généraux'        WHERE id = '20000000-0000-0000-0000-000000000003';

-- ─── STEP 3: Promote misplaced items from level=3 to level=2 ─────────────────
-- These items are direct children of level-1 categories but were stored as level=3

-- Énergie
UPDATE expense_categories SET level = 2, name = 'Électricité'           WHERE id = '30000000-0000-0000-0000-000000000002';
UPDATE expense_categories SET level = 2, name = 'Gaz'                   WHERE id = '30000000-0000-0000-0000-000000000001';
UPDATE expense_categories SET level = 2, name = 'Eau'                   WHERE id = '30000000-0000-0000-0000-000000000003';

-- Entretien & Maintenance
UPDATE expense_categories SET level = 2, name = 'Réparations'           WHERE id = '30000000-0000-0000-0000-000000000024';
UPDATE expense_categories SET level = 2, name = 'Nettoyage'             WHERE id = '30000000-0000-0000-0000-000000000025';
UPDATE expense_categories SET level = 2, name = 'Maintenance préventive' WHERE id = '30000000-0000-0000-0000-000000000026';

-- Loyer & Charges
UPDATE expense_categories SET level = 2, name = 'Loyer'                 WHERE id = '30000000-0000-0000-0000-000000000027';
UPDATE expense_categories SET level = 2, name = 'Assurances'            WHERE id = '30000000-0000-0000-0000-000000000028';

-- Transport
UPDATE expense_categories SET level = 2, name = 'Carburant'             WHERE id = '30000000-0000-0000-0000-000000000029';
UPDATE expense_categories SET level = 2, name = 'Livraison'             WHERE id = '30000000-0000-0000-0000-000000000030';

-- Équipements
UPDATE expense_categories SET level = 2, name = 'Petit matériel'        WHERE id = '30000000-0000-0000-0000-000000000031';
UPDATE expense_categories SET level = 2, name = 'Matériel cuisine'      WHERE id = '30000000-0000-0000-0000-000000000032';

-- Divers
UPDATE expense_categories SET level = 2, name = 'Repas & Restauration'  WHERE id = '30000000-0000-0000-0000-000000000033';
UPDATE expense_categories SET level = 2, name = 'Dettes & Emprunts'     WHERE id = '30000000-0000-0000-0000-000000000034';
UPDATE expense_categories SET level = 2, name = 'Divers'                WHERE id = '30000000-0000-0000-0000-000000000035';

-- ─── STEP 4: Add new level-2 subcategory for Équipements ─────────────────────

INSERT INTO expense_categories (id, name, type, parent_id, level, display_order, is_active, requires_po)
VALUES ('20000000-0000-0000-0000-000000000008', 'Informatique & POS', 'expense',
        '10000000-0000-0000-0000-000000000008', 2, 3, true, true)
ON CONFLICT (id) DO NOTHING;

-- ─── STEP 5: Add level-3 leaf items ──────────────────────────────────────────

INSERT INTO expense_categories (id, name, type, parent_id, level, display_order, is_active, requires_po)
VALUES
  -- Énergie > Électricité
  ('30000000-0000-0000-0000-000000000046', 'Facture électricité',      'expense', '30000000-0000-0000-0000-000000000002', 3, 1, true, false),

  -- Énergie > Gaz
  ('30000000-0000-0000-0000-000000000047', 'Gaz industriel',           'expense', '30000000-0000-0000-0000-000000000001', 3, 1, true, false),
  ('30000000-0000-0000-0000-000000000048', 'Gaz ménager (bouteilles)', 'expense', '30000000-0000-0000-0000-000000000001', 3, 2, true, false),

  -- Énergie > Eau
  ('30000000-0000-0000-0000-000000000049', 'Facture eau',              'expense', '30000000-0000-0000-0000-000000000003', 3, 1, true, false),

  -- Entretien > Réparations
  ('30000000-0000-0000-0000-000000000050', 'Matériel de production',   'expense', '30000000-0000-0000-0000-000000000024', 3, 1, true, false),
  ('30000000-0000-0000-0000-000000000051', 'Réfrigération',            'expense', '30000000-0000-0000-0000-000000000024', 3, 2, true, false),
  ('30000000-0000-0000-0000-000000000052', 'Autre réparation',         'expense', '30000000-0000-0000-0000-000000000024', 3, 3, true, false),

  -- Entretien > Nettoyage
  ('30000000-0000-0000-0000-000000000053', 'Produits d''entretien',    'expense', '30000000-0000-0000-0000-000000000025', 3, 1, true, true),
  ('30000000-0000-0000-0000-000000000054', 'Prestataire nettoyage',    'expense', '30000000-0000-0000-0000-000000000025', 3, 2, true, false),

  -- Entretien > Maintenance préventive
  ('30000000-0000-0000-0000-000000000055', 'Contrat maintenance',      'expense', '30000000-0000-0000-0000-000000000026', 3, 1, true, false),
  ('30000000-0000-0000-0000-000000000056', 'Pièces de rechange',       'expense', '30000000-0000-0000-0000-000000000026', 3, 2, true, true),

  -- Loyer > Loyer
  ('30000000-0000-0000-0000-000000000057', 'Loyer local commercial',   'expense', '30000000-0000-0000-0000-000000000027', 3, 1, true, false),
  ('30000000-0000-0000-0000-000000000058', 'Charges locatives',        'expense', '30000000-0000-0000-0000-000000000027', 3, 2, true, false),

  -- Loyer > Assurances
  ('30000000-0000-0000-0000-000000000059', 'Assurance local',          'expense', '30000000-0000-0000-0000-000000000028', 3, 1, true, false),
  ('30000000-0000-0000-0000-000000000060', 'Assurance matériel',       'expense', '30000000-0000-0000-0000-000000000028', 3, 2, true, false),
  ('30000000-0000-0000-0000-000000000061', 'RC Professionnelle',       'expense', '30000000-0000-0000-0000-000000000028', 3, 3, true, false),

  -- Transport > Carburant
  ('30000000-0000-0000-0000-000000000062', 'Essence / Gasoil',         'expense', '30000000-0000-0000-0000-000000000029', 3, 1, true, false),
  ('30000000-0000-0000-0000-000000000063', 'Autre carburant',          'expense', '30000000-0000-0000-0000-000000000029', 3, 2, true, false),

  -- Transport > Livraison
  ('30000000-0000-0000-0000-000000000064', 'Livraison fournisseurs',   'expense', '30000000-0000-0000-0000-000000000030', 3, 1, true, false),
  ('30000000-0000-0000-0000-000000000065', 'Livraison clients',        'expense', '30000000-0000-0000-0000-000000000030', 3, 2, true, false),
  ('30000000-0000-0000-0000-000000000066', 'Coursiers',                'expense', '30000000-0000-0000-0000-000000000030', 3, 3, true, false),

  -- Équipements > Petit matériel
  ('30000000-0000-0000-0000-000000000067', 'Ustensiles pâtisserie',    'expense', '30000000-0000-0000-0000-000000000031', 3, 1, true, true),
  ('30000000-0000-0000-0000-000000000068', 'Outillage divers',         'expense', '30000000-0000-0000-0000-000000000031', 3, 2, true, true),

  -- Équipements > Matériel cuisine
  ('30000000-0000-0000-0000-000000000069', 'Fours & Pétrins',          'expense', '30000000-0000-0000-0000-000000000032', 3, 1, true, true),
  ('30000000-0000-0000-0000-000000000070', 'Chambre froide & Frigos',  'expense', '30000000-0000-0000-0000-000000000032', 3, 2, true, true),
  ('30000000-0000-0000-0000-000000000071', 'Vitrines & Présentoirs',   'expense', '30000000-0000-0000-0000-000000000032', 3, 3, true, true),
  ('30000000-0000-0000-0000-000000000072', 'Autre matériel',           'expense', '30000000-0000-0000-0000-000000000032', 3, 4, true, true),

  -- Équipements > Informatique & POS
  ('30000000-0000-0000-0000-000000000073', 'Logiciels & Licences',     'expense', '20000000-0000-0000-0000-000000000008', 3, 1, true, true),
  ('30000000-0000-0000-0000-000000000074', 'Matériel POS & Caisse',    'expense', '20000000-0000-0000-0000-000000000008', 3, 2, true, true),
  ('30000000-0000-0000-0000-000000000075', 'Réseau & Internet',        'expense', '20000000-0000-0000-0000-000000000008', 3, 3, true, false),

  -- Divers > Repas & Restauration
  ('30000000-0000-0000-0000-000000000076', 'Repas équipe',             'expense', '30000000-0000-0000-0000-000000000033', 3, 1, true, false),
  ('30000000-0000-0000-0000-000000000077', 'Tickets restaurant',       'expense', '30000000-0000-0000-0000-000000000033', 3, 2, true, false),

  -- Divers > Dettes & Emprunts
  ('30000000-0000-0000-0000-000000000078', 'Remboursement emprunt',    'expense', '30000000-0000-0000-0000-000000000034', 3, 1, true, false),
  ('30000000-0000-0000-0000-000000000079', 'Intérêts bancaires',       'expense', '30000000-0000-0000-0000-000000000034', 3, 2, true, false),

  -- Divers > Divers
  ('30000000-0000-0000-0000-000000000080', 'Cadeaux & Relations',      'expense', '30000000-0000-0000-0000-000000000035', 3, 1, true, false),
  ('30000000-0000-0000-0000-000000000081', 'Imprévus',                 'expense', '30000000-0000-0000-0000-000000000035', 3, 2, true, false),

  -- Matières premières > Emballages (complément)
  ('30000000-0000-0000-0000-000000000082', 'Papier boulanger',         'expense', '20000000-0000-0000-0000-000000000005', 3, 4, true, true),
  ('30000000-0000-0000-0000-000000000083', 'Ficelles & Rubans',        'expense', '20000000-0000-0000-0000-000000000005', 3, 5, true, true)
ON CONFLICT (id) DO NOTHING;

-- ─── STEP 6: Fix display order for level-1 categories ────────────────────────

UPDATE expense_categories SET display_order = 1 WHERE id = '10000000-0000-0000-0000-000000000003'; -- Matières premières
UPDATE expense_categories SET display_order = 2 WHERE id = '10000000-0000-0000-0000-000000000001'; -- Énergie
UPDATE expense_categories SET display_order = 3 WHERE id = '10000000-0000-0000-0000-000000000004'; -- Charges de personnel
UPDATE expense_categories SET display_order = 4 WHERE id = '10000000-0000-0000-0000-000000000002'; -- Frais administratifs
UPDATE expense_categories SET display_order = 5 WHERE id = '10000000-0000-0000-0000-000000000005'; -- Entretien & Maintenance
UPDATE expense_categories SET display_order = 6 WHERE id = '10000000-0000-0000-0000-000000000006'; -- Loyer & Charges
UPDATE expense_categories SET display_order = 7 WHERE id = '10000000-0000-0000-0000-000000000007'; -- Transport
UPDATE expense_categories SET display_order = 8 WHERE id = '10000000-0000-0000-0000-000000000008'; -- Équipements & Matériel
UPDATE expense_categories SET display_order = 9 WHERE id = '10000000-0000-0000-0000-000000000009'; -- Divers
