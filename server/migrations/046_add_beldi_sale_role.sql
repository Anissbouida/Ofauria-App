-- Add beldi_sale role to users table
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'manager', 'cashier', 'baker', 'pastry_chef', 'viennoiserie', 'beldi_sale', 'saleswoman'));
