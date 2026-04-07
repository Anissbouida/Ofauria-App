-- Migration 038: Enforce purchase order linkage on expenses
-- Adds purchase_order_id to payments and requires_po flag to expense_categories

-- 1. Add purchase_order_id to payments
ALTER TABLE payments ADD COLUMN IF NOT EXISTS purchase_order_id UUID REFERENCES purchase_orders(id);
CREATE INDEX IF NOT EXISTS idx_payments_po ON payments(purchase_order_id);

-- 2. Add requires_po flag to expense_categories (default true = strict control)
ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS requires_po BOOLEAN NOT NULL DEFAULT true;

-- 3. Exempt categories that are NOT supplier-related (no PO needed)
UPDATE expense_categories SET requires_po = false WHERE name IN (
  'Loyer',
  'Electricite',
  'Eau',
  'Gaz',
  'CNSS',
  'Salaires',
  'Impots',
  'Frais administration',
  'Dettes',
  'Reseau et telecom',
  'Divers',
  'Repas personnel',
  'Transport',
  'Impression',
  'Maintenance'
);

-- Categories that REQUIRE a PO (supplier purchases):
-- Matieres premieres, Emballages, Entretien, Equipements
-- (these keep requires_po = true by default)
