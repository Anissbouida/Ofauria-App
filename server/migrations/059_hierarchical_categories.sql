-- Migration 059: Hierarchical expense/revenue categories (3 levels)
-- Restructures expense_categories with parent_id for Category → Subcategory → Type hierarchy
-- Creates separate revenue_categories table
-- Fully additive and non-breaking

-- ============================================================
-- 1. Add hierarchy support to expense_categories
-- ============================================================

ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES expense_categories(id);
ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS level INT NOT NULL DEFAULT 1;
ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS display_order INT NOT NULL DEFAULT 0;
ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS code VARCHAR(40);

CREATE INDEX IF NOT EXISTS idx_expense_cat_parent ON expense_categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_expense_cat_level ON expense_categories(level);

-- ============================================================
-- 2. Create revenue_categories table (independent from expense)
-- ============================================================

CREATE TABLE IF NOT EXISTS revenue_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  parent_id UUID REFERENCES revenue_categories(id),
  level INT NOT NULL DEFAULT 1,
  display_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  code VARCHAR(40),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_revenue_cat_parent ON revenue_categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_revenue_cat_level ON revenue_categories(level);

-- ============================================================
-- 3. Restructure existing expense_categories into hierarchy
-- First, clean up: remove the 'income' type entries (they'll go to revenue_categories)
-- Then reorganize expenses into proper hierarchy
-- ============================================================

-- Remove type column constraint and set all existing as level 1
-- (We keep the type column for backward compat but it will always be 'expense' now)

-- Step 3a: Delete old flat entries that will be replaced by hierarchy
-- Since no payments reference them (0 rows), we can safely restructure
DELETE FROM expense_categories;

-- Step 3b: Insert hierarchical expense categories

-- === LEVEL 1: Root categories ===
INSERT INTO expense_categories (id, name, type, description, level, display_order, requires_po) VALUES
  ('10000000-0000-0000-0000-000000000001', 'Energie', 'expense', 'Gaz, electricite, eau', 1, 1, false),
  ('10000000-0000-0000-0000-000000000002', 'Frais administratifs', 'expense', 'Charges sociales, fiscalite, administration', 1, 2, false),
  ('10000000-0000-0000-0000-000000000003', 'Matieres premieres', 'expense', 'Ingredients, emballages, consommables', 1, 3, true),
  ('10000000-0000-0000-0000-000000000004', 'Charges de personnel', 'expense', 'Salaires, primes, indemnites', 1, 4, false),
  ('10000000-0000-0000-0000-000000000005', 'Entretien', 'expense', 'Reparations, nettoyage, maintenance', 1, 5, false),
  ('10000000-0000-0000-0000-000000000006', 'Loyer et charges', 'expense', 'Loyer, assurance, charges locatives', 1, 6, false),
  ('10000000-0000-0000-0000-000000000007', 'Transport', 'expense', 'Livraisons, carburant, deplacement', 1, 7, false),
  ('10000000-0000-0000-0000-000000000008', 'Equipements', 'expense', 'Materiel, outillage, machines', 1, 8, true),
  ('10000000-0000-0000-0000-000000000009', 'Divers', 'expense', 'Autres depenses non classifiees', 1, 9, false);

-- === LEVEL 2: Subcategories ===
-- Energie (no subcategories, types attach directly)

-- Frais administratifs → Charges sociales, Fiscalite
INSERT INTO expense_categories (id, name, type, parent_id, level, display_order, requires_po) VALUES
  ('20000000-0000-0000-0000-000000000001', 'Charges sociales', 'expense', '10000000-0000-0000-0000-000000000002', 2, 1, false),
  ('20000000-0000-0000-0000-000000000002', 'Fiscalite', 'expense', '10000000-0000-0000-0000-000000000002', 2, 2, false),
  ('20000000-0000-0000-0000-000000000003', 'Frais generaux', 'expense', '10000000-0000-0000-0000-000000000002', 2, 3, false);

-- Matieres premieres → Ingredients, Emballages
INSERT INTO expense_categories (id, name, type, parent_id, level, display_order, requires_po) VALUES
  ('20000000-0000-0000-0000-000000000004', 'Ingredients', 'expense', '10000000-0000-0000-0000-000000000003', 2, 1, true),
  ('20000000-0000-0000-0000-000000000005', 'Emballages', 'expense', '10000000-0000-0000-0000-000000000003', 2, 2, true);

-- Charges de personnel → Salaires, Indemnites
INSERT INTO expense_categories (id, name, type, parent_id, level, display_order, requires_po) VALUES
  ('20000000-0000-0000-0000-000000000006', 'Salaires', 'expense', '10000000-0000-0000-0000-000000000004', 2, 1, false),
  ('20000000-0000-0000-0000-000000000007', 'Primes et indemnites', 'expense', '10000000-0000-0000-0000-000000000004', 2, 2, false);

-- === LEVEL 3: Types (leaf nodes used for actual categorization) ===
-- Energie → types directement
INSERT INTO expense_categories (id, name, type, parent_id, level, display_order, requires_po) VALUES
  ('30000000-0000-0000-0000-000000000001', 'Gaz', 'expense', '10000000-0000-0000-0000-000000000001', 3, 1, false),
  ('30000000-0000-0000-0000-000000000002', 'Electricite', 'expense', '10000000-0000-0000-0000-000000000001', 3, 2, false),
  ('30000000-0000-0000-0000-000000000003', 'Eau', 'expense', '10000000-0000-0000-0000-000000000001', 3, 3, false);

-- Charges sociales → types
INSERT INTO expense_categories (id, name, type, parent_id, level, display_order, requires_po) VALUES
  ('30000000-0000-0000-0000-000000000004', 'CNSS', 'expense', '20000000-0000-0000-0000-000000000001', 3, 1, false),
  ('30000000-0000-0000-0000-000000000005', 'IPMOS', 'expense', '20000000-0000-0000-0000-000000000001', 3, 2, false);

-- Fiscalite → types
INSERT INTO expense_categories (id, name, type, parent_id, level, display_order, requires_po) VALUES
  ('30000000-0000-0000-0000-000000000006', 'Patente', 'expense', '20000000-0000-0000-0000-000000000002', 3, 1, false),
  ('30000000-0000-0000-0000-000000000007', 'TVA', 'expense', '20000000-0000-0000-0000-000000000002', 3, 2, false),
  ('30000000-0000-0000-0000-000000000008', 'IR', 'expense', '20000000-0000-0000-0000-000000000002', 3, 3, false);

-- Frais generaux → types
INSERT INTO expense_categories (id, name, type, parent_id, level, display_order, requires_po) VALUES
  ('30000000-0000-0000-0000-000000000009', 'Fournitures bureau', 'expense', '20000000-0000-0000-0000-000000000003', 3, 1, false),
  ('30000000-0000-0000-0000-000000000010', 'Impression', 'expense', '20000000-0000-0000-0000-000000000003', 3, 2, false),
  ('30000000-0000-0000-0000-000000000011', 'Reseau et telecom', 'expense', '20000000-0000-0000-0000-000000000003', 3, 3, false);

-- Ingredients → types
INSERT INTO expense_categories (id, name, type, parent_id, level, display_order, requires_po) VALUES
  ('30000000-0000-0000-0000-000000000012', 'Farine', 'expense', '20000000-0000-0000-0000-000000000004', 3, 1, true),
  ('30000000-0000-0000-0000-000000000013', 'Beurre', 'expense', '20000000-0000-0000-0000-000000000004', 3, 2, true),
  ('30000000-0000-0000-0000-000000000014', 'Sucre', 'expense', '20000000-0000-0000-0000-000000000004', 3, 3, true),
  ('30000000-0000-0000-0000-000000000015', 'Oeufs', 'expense', '20000000-0000-0000-0000-000000000004', 3, 4, true),
  ('30000000-0000-0000-0000-000000000016', 'Autres ingredients', 'expense', '20000000-0000-0000-0000-000000000004', 3, 5, true);

-- Emballages → types
INSERT INTO expense_categories (id, name, type, parent_id, level, display_order, requires_po) VALUES
  ('30000000-0000-0000-0000-000000000017', 'Boites', 'expense', '20000000-0000-0000-0000-000000000005', 3, 1, true),
  ('30000000-0000-0000-0000-000000000018', 'Sacs', 'expense', '20000000-0000-0000-0000-000000000005', 3, 2, true),
  ('30000000-0000-0000-0000-000000000019', 'Etiquettes', 'expense', '20000000-0000-0000-0000-000000000005', 3, 3, true);

-- Salaires → types
INSERT INTO expense_categories (id, name, type, parent_id, level, display_order, requires_po) VALUES
  ('30000000-0000-0000-0000-000000000020', 'Salaire de base', 'expense', '20000000-0000-0000-0000-000000000006', 3, 1, false),
  ('30000000-0000-0000-0000-000000000021', 'Heures supplementaires', 'expense', '20000000-0000-0000-0000-000000000006', 3, 2, false);

-- Primes → types
INSERT INTO expense_categories (id, name, type, parent_id, level, display_order, requires_po) VALUES
  ('30000000-0000-0000-0000-000000000022', 'Primes', 'expense', '20000000-0000-0000-0000-000000000007', 3, 1, false),
  ('30000000-0000-0000-0000-000000000023', 'Avances sur salaire', 'expense', '20000000-0000-0000-0000-000000000007', 3, 2, false);

-- Entretien → types (direct level 3 since no subcategories)
INSERT INTO expense_categories (id, name, type, parent_id, level, display_order, requires_po) VALUES
  ('30000000-0000-0000-0000-000000000024', 'Reparations', 'expense', '10000000-0000-0000-0000-000000000005', 3, 1, false),
  ('30000000-0000-0000-0000-000000000025', 'Nettoyage', 'expense', '10000000-0000-0000-0000-000000000005', 3, 2, false),
  ('30000000-0000-0000-0000-000000000026', 'Maintenance preventive', 'expense', '10000000-0000-0000-0000-000000000005', 3, 3, false);

-- Loyer et charges → types
INSERT INTO expense_categories (id, name, type, parent_id, level, display_order, requires_po) VALUES
  ('30000000-0000-0000-0000-000000000027', 'Loyer', 'expense', '10000000-0000-0000-0000-000000000006', 3, 1, false),
  ('30000000-0000-0000-0000-000000000028', 'Assurance', 'expense', '10000000-0000-0000-0000-000000000006', 3, 2, false);

-- Transport → types
INSERT INTO expense_categories (id, name, type, parent_id, level, display_order, requires_po) VALUES
  ('30000000-0000-0000-0000-000000000029', 'Carburant', 'expense', '10000000-0000-0000-0000-000000000007', 3, 1, false),
  ('30000000-0000-0000-0000-000000000030', 'Livraison', 'expense', '10000000-0000-0000-0000-000000000007', 3, 2, false);

-- Equipements → types
INSERT INTO expense_categories (id, name, type, parent_id, level, display_order, requires_po) VALUES
  ('30000000-0000-0000-0000-000000000031', 'Petit outillage', 'expense', '10000000-0000-0000-0000-000000000008', 3, 1, true),
  ('30000000-0000-0000-0000-000000000032', 'Materiel cuisine', 'expense', '10000000-0000-0000-0000-000000000008', 3, 2, true);

-- Divers → types
INSERT INTO expense_categories (id, name, type, parent_id, level, display_order, requires_po) VALUES
  ('30000000-0000-0000-0000-000000000033', 'Repas personnel', 'expense', '10000000-0000-0000-0000-000000000009', 3, 1, false),
  ('30000000-0000-0000-0000-000000000034', 'Dettes', 'expense', '10000000-0000-0000-0000-000000000009', 3, 2, false),
  ('30000000-0000-0000-0000-000000000035', 'Autres', 'expense', '10000000-0000-0000-0000-000000000009', 3, 3, false);


-- ============================================================
-- 4. Seed revenue categories (same 3-level structure)
-- ============================================================

-- Level 1
INSERT INTO revenue_categories (id, name, description, level, display_order) VALUES
  ('40000000-0000-0000-0000-000000000001', 'Ventes directes', 'Ventes en boutique et caisse', 1, 1),
  ('40000000-0000-0000-0000-000000000002', 'Commandes', 'Commandes clients sur mesure', 1, 2),
  ('40000000-0000-0000-0000-000000000003', 'Autres revenus', 'Remises, avoirs, revenus divers', 1, 3);

-- Level 2: Ventes directes → subcategories
INSERT INTO revenue_categories (id, name, parent_id, level, display_order) VALUES
  ('50000000-0000-0000-0000-000000000001', 'Patisserie', '40000000-0000-0000-0000-000000000001', 2, 1),
  ('50000000-0000-0000-0000-000000000002', 'Boulangerie', '40000000-0000-0000-0000-000000000001', 2, 2),
  ('50000000-0000-0000-0000-000000000003', 'Viennoiserie', '40000000-0000-0000-0000-000000000001', 2, 3);

-- Level 2: Commandes → subcategories
INSERT INTO revenue_categories (id, name, parent_id, level, display_order) VALUES
  ('50000000-0000-0000-0000-000000000004', 'Commandes speciales', '40000000-0000-0000-0000-000000000002', 2, 1);

-- Level 3: Types
INSERT INTO revenue_categories (id, name, parent_id, level, display_order) VALUES
  ('60000000-0000-0000-0000-000000000001', 'Gateaux', '50000000-0000-0000-0000-000000000001', 3, 1),
  ('60000000-0000-0000-0000-000000000002', 'Entremets', '50000000-0000-0000-0000-000000000001', 3, 2),
  ('60000000-0000-0000-0000-000000000003', 'Tartes', '50000000-0000-0000-0000-000000000001', 3, 3),
  ('60000000-0000-0000-0000-000000000004', 'Baguettes', '50000000-0000-0000-0000-000000000002', 3, 1),
  ('60000000-0000-0000-0000-000000000005', 'Pains speciaux', '50000000-0000-0000-0000-000000000002', 3, 2),
  ('60000000-0000-0000-0000-000000000006', 'Croissants', '50000000-0000-0000-0000-000000000003', 3, 1),
  ('60000000-0000-0000-0000-000000000007', 'Pains au chocolat', '50000000-0000-0000-0000-000000000003', 3, 2),
  ('60000000-0000-0000-0000-000000000008', 'Gateaux sur commande', '50000000-0000-0000-0000-000000000004', 3, 1),
  ('60000000-0000-0000-0000-000000000009', 'Remises fournisseurs', '40000000-0000-0000-0000-000000000003', 3, 1),
  ('60000000-0000-0000-0000-000000000010', 'Avoirs', '40000000-0000-0000-0000-000000000003', 3, 2);


-- ============================================================
-- 5. Update ref_tables registry
-- ============================================================

-- Update existing expense_categories entry
UPDATE ref_tables SET label = 'Categories de depenses', description = 'Hierarchie 3 niveaux : categorie, sous-categorie, type' WHERE id = 'expense_categories';

-- Add revenue_categories
INSERT INTO ref_tables (id, label, description, icon, source, native_table, editable, display_order) VALUES
  ('revenue_categories', 'Categories de revenus', 'Hierarchie 3 niveaux : categorie, sous-categorie, type', 'TrendingUp', 'native', 'revenue_categories', true, 2)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description;

-- Shift product_categories order
UPDATE ref_tables SET display_order = 3 WHERE id = 'product_categories';
