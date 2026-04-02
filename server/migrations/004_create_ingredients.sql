CREATE TABLE ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  unit VARCHAR(20) NOT NULL CHECK (unit IN ('kg', 'g', 'l', 'ml', 'unit')),
  unit_cost DECIMAL(10,4) NOT NULL,
  supplier VARCHAR(200),
  allergens TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
