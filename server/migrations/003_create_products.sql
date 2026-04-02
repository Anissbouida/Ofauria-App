CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  slug VARCHAR(200) UNIQUE NOT NULL,
  category_id INT REFERENCES categories(id),
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  cost_price DECIMAL(10,2),
  image_url VARCHAR(500),
  is_available BOOLEAN DEFAULT true,
  is_custom_orderable BOOLEAN DEFAULT false,
  preparation_time_min INT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_available ON products(is_available);
