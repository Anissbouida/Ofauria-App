-- Migration 058: Referentiel (Reference Tables) Module
-- Generic parameterization system for all reference data

-- 1. Master table: registry of all managed reference tables
CREATE TABLE IF NOT EXISTS ref_tables (
  id VARCHAR(60) PRIMARY KEY,              -- slug key, e.g. 'expense_categories', 'units'
  label VARCHAR(120) NOT NULL,             -- display name, e.g. 'Catégories de dépenses'
  description TEXT,
  icon VARCHAR(40) DEFAULT 'Tag',          -- lucide icon name
  source VARCHAR(20) NOT NULL DEFAULT 'ref_entries',  -- 'ref_entries' = generic, 'native' = existing table
  native_table VARCHAR(80),                -- if source=native, the real table name
  editable BOOLEAN NOT NULL DEFAULT true,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Generic reference entries table (used when source = 'ref_entries')
CREATE TABLE IF NOT EXISTS ref_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id VARCHAR(60) NOT NULL REFERENCES ref_tables(id) ON DELETE CASCADE,
  code VARCHAR(60),                        -- optional short code (e.g. 'kg', 'cash')
  label VARCHAR(200) NOT NULL,
  description TEXT,
  color VARCHAR(20),                       -- optional hex color
  icon VARCHAR(40),                        -- optional lucide icon name
  display_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB DEFAULT '{}',             -- flexible extra fields per table type
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(table_id, code)
);

CREATE INDEX IF NOT EXISTS idx_ref_entries_table ON ref_entries(table_id);
CREATE INDEX IF NOT EXISTS idx_ref_entries_active ON ref_entries(table_id, is_active);

-- 3. Audit log for all reference changes
CREATE TABLE IF NOT EXISTS ref_audit_log (
  id BIGSERIAL PRIMARY KEY,
  table_id VARCHAR(60) NOT NULL,
  entry_id VARCHAR(80),                    -- UUID or native table id
  action VARCHAR(20) NOT NULL,             -- 'create', 'update', 'deactivate', 'reactivate'
  changes JSONB,                           -- before/after snapshot
  user_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ref_audit_table ON ref_audit_log(table_id);
CREATE INDEX IF NOT EXISTS idx_ref_audit_date ON ref_audit_log(created_at);

-- ============================================================
-- 4. Register native tables (already exist, managed via adapter)
-- ============================================================

INSERT INTO ref_tables (id, label, description, icon, source, native_table, editable, display_order) VALUES
  ('expense_categories', 'Categories depenses / revenus', 'Categories utilisees dans la comptabilite', 'Receipt', 'native', 'expense_categories', true, 1),
  ('product_categories', 'Categories de produits', 'Familles de produits vendus', 'ShoppingBag', 'native', 'categories', true, 2)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 5. Register and seed generic reference tables
-- ============================================================

-- Units of measure
INSERT INTO ref_tables (id, label, description, icon, source, editable, display_order) VALUES
  ('units', 'Unites de mesure', 'Gramme, kilogramme, litre, piece...', 'Ruler', 'ref_entries', true, 3)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ref_entries (table_id, code, label, description, display_order) VALUES
  ('units', 'kg', 'Kilogramme', 'Unite de masse (1000g)', 1),
  ('units', 'g', 'Gramme', 'Unite de masse', 2),
  ('units', 'l', 'Litre', 'Unite de volume (1000ml)', 3),
  ('units', 'ml', 'Millilitre', 'Unite de volume', 4),
  ('units', 'unit', 'Piece', 'Unite discrete', 5)
ON CONFLICT (table_id, code) DO NOTHING;

-- Payment methods
INSERT INTO ref_tables (id, label, description, icon, source, editable, display_order) VALUES
  ('payment_methods', 'Modes de paiement', 'Especes, carte, virement, cheque...', 'CreditCard', 'ref_entries', true, 4)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ref_entries (table_id, code, label, description, color, display_order) VALUES
  ('payment_methods', 'cash', 'Especes', 'Paiement en liquide', '#16a34a', 1),
  ('payment_methods', 'card', 'Carte bancaire', 'Paiement par carte', '#2563eb', 2),
  ('payment_methods', 'mobile', 'Paiement mobile', 'CMI, HPS, etc.', '#8b5cf6', 3),
  ('payment_methods', 'check', 'Cheque', 'Paiement par cheque', '#d97706', 4),
  ('payment_methods', 'transfer', 'Virement', 'Virement bancaire', '#0891b2', 5),
  ('payment_methods', 'deferred', 'Paiement differe', 'Facturation a terme', '#6b7280', 6)
ON CONFLICT (table_id, code) DO NOTHING;

-- HR Absence reasons
INSERT INTO ref_tables (id, label, description, icon, source, editable, display_order) VALUES
  ('absence_reasons', 'Motifs d absence', 'Maladie, conge, formation...', 'UserX', 'ref_entries', true, 5)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ref_entries (table_id, code, label, color, display_order) VALUES
  ('absence_reasons', 'sick', 'Maladie', '#ef4444', 1),
  ('absence_reasons', 'vacation', 'Conge annuel', '#3b82f6', 2),
  ('absence_reasons', 'family', 'Evenement familial', '#f59e0b', 3),
  ('absence_reasons', 'training', 'Formation', '#8b5cf6', 4),
  ('absence_reasons', 'unauthorized', 'Absence non justifiee', '#dc2626', 5),
  ('absence_reasons', 'other', 'Autre', '#6b7280', 6)
ON CONFLICT (table_id, code) DO NOTHING;

-- Loss reasons (production / inventory)
INSERT INTO ref_tables (id, label, description, icon, source, editable, display_order) VALUES
  ('loss_reasons', 'Motifs de perte', 'Invendu, casse, perime...', 'Trash2', 'ref_entries', true, 6)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ref_entries (table_id, code, label, color, display_order) VALUES
  ('loss_reasons', 'unsold', 'Invendu', '#f59e0b', 1),
  ('loss_reasons', 'damaged', 'Casse / endommage', '#ef4444', 2),
  ('loss_reasons', 'expired', 'Perime', '#dc2626', 3),
  ('loss_reasons', 'quality', 'Defaut qualite', '#e11d48', 4),
  ('loss_reasons', 'donation', 'Don / gratuite', '#22c55e', 5),
  ('loss_reasons', 'other', 'Autre', '#6b7280', 6)
ON CONFLICT (table_id, code) DO NOTHING;
