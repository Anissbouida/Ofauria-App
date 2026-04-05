-- Suppliers / Fournisseurs
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  contact_name VARCHAR(100),
  phone VARCHAR(20),
  email VARCHAR(255),
  address TEXT,
  city VARCHAR(100),
  ice VARCHAR(30),
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Expense categories / Categories de depenses
CREATE TABLE IF NOT EXISTS expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'expense' CHECK (type IN ('expense', 'income')),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default expense categories
INSERT INTO expense_categories (name, type) VALUES
  ('Matieres premieres', 'expense'),
  ('Loyer', 'expense'),
  ('Electricite', 'expense'),
  ('Eau', 'expense'),
  ('Gaz', 'expense'),
  ('Salaires', 'expense'),
  ('CNSS', 'expense'),
  ('Emballages', 'expense'),
  ('Entretien', 'expense'),
  ('Transport', 'expense'),
  ('Equipements', 'expense'),
  ('Divers', 'expense'),
  ('Ventes', 'income'),
  ('Autres revenus', 'income')
ON CONFLICT DO NOTHING;

-- Invoices / Factures fournisseurs
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number VARCHAR(50) NOT NULL,
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  category_id UUID REFERENCES expense_categories(id),
  invoice_date DATE NOT NULL,
  due_date DATE,
  amount DECIMAL(12,2) NOT NULL,
  tax_amount DECIMAL(12,2) DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL,
  paid_amount DECIMAL(12,2) DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'paid', 'overdue', 'cancelled')),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_supplier ON invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(invoice_date);

-- Payments / Paiements
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference VARCHAR(50),
  type VARCHAR(20) NOT NULL CHECK (type IN ('invoice', 'salary', 'expense', 'income')),
  category_id UUID REFERENCES expense_categories(id),
  invoice_id UUID REFERENCES invoices(id),
  supplier_id UUID REFERENCES suppliers(id),
  employee_id UUID REFERENCES employees(id),
  amount DECIMAL(12,2) NOT NULL,
  payment_method VARCHAR(20) NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'bank', 'check', 'transfer')),
  payment_date DATE NOT NULL,
  description TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_type ON payments(type);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
