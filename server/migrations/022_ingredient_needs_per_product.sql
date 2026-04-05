-- Add product_id to production_ingredient_needs so needs can be filtered by product/category
ALTER TABLE production_ingredient_needs
  ADD COLUMN product_id UUID REFERENCES products(id);

-- Drop existing unique constraint if any and add new one per plan+ingredient+product
CREATE INDEX idx_prod_needs_product ON production_ingredient_needs(product_id);
