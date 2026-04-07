-- Align all monetary columns to DECIMAL(12,2) and quantity columns to DECIMAL(12,4)
-- This prevents overflow on large amounts and ensures consistent precision

-- ══ Products ══
ALTER TABLE products ALTER COLUMN price TYPE DECIMAL(12,2);
ALTER TABLE products ALTER COLUMN cost_price TYPE DECIMAL(12,2);
ALTER TABLE products ALTER COLUMN stock_quantity TYPE DECIMAL(12,2);
ALTER TABLE products ALTER COLUMN stock_min_threshold TYPE DECIMAL(12,2);

-- ══ Product store stock ══
ALTER TABLE product_store_stock ALTER COLUMN stock_quantity TYPE DECIMAL(12,2);
ALTER TABLE product_store_stock ALTER COLUMN stock_min_threshold TYPE DECIMAL(12,2);

-- ══ Product stock transactions ══
ALTER TABLE product_stock_transactions ALTER COLUMN quantity_change TYPE DECIMAL(12,2);
ALTER TABLE product_stock_transactions ALTER COLUMN stock_after TYPE DECIMAL(12,2);

-- ══ Recipes ══
ALTER TABLE recipes ALTER COLUMN total_cost TYPE DECIMAL(12,2);
ALTER TABLE recipe_ingredients ALTER COLUMN quantity TYPE DECIMAL(12,4);
ALTER TABLE recipe_sub_recipes ALTER COLUMN quantity TYPE DECIMAL(12,4);

-- ══ Ingredients ══
ALTER TABLE ingredients ALTER COLUMN unit_cost TYPE DECIMAL(12,4);

-- ══ Orders ══
ALTER TABLE orders ALTER COLUMN subtotal TYPE DECIMAL(12,2);
ALTER TABLE orders ALTER COLUMN tax_amount TYPE DECIMAL(12,2);
ALTER TABLE orders ALTER COLUMN discount_amount TYPE DECIMAL(12,2);
ALTER TABLE orders ALTER COLUMN total TYPE DECIMAL(12,2);
ALTER TABLE orders ALTER COLUMN advance_amount TYPE DECIMAL(12,2);
ALTER TABLE order_items ALTER COLUMN unit_price TYPE DECIMAL(12,2);
ALTER TABLE order_items ALTER COLUMN subtotal TYPE DECIMAL(12,2);

-- ══ Sales ══
ALTER TABLE sales ALTER COLUMN subtotal TYPE DECIMAL(12,2);
ALTER TABLE sales ALTER COLUMN tax_amount TYPE DECIMAL(12,2);
ALTER TABLE sales ALTER COLUMN discount_amount TYPE DECIMAL(12,2);
ALTER TABLE sales ALTER COLUMN total TYPE DECIMAL(12,2);
ALTER TABLE sale_items ALTER COLUMN unit_price TYPE DECIMAL(12,2);
ALTER TABLE sale_items ALTER COLUMN subtotal TYPE DECIMAL(12,2);

-- ══ Returns / Exchanges ══
ALTER TABLE sale_returns ALTER COLUMN refund_amount TYPE DECIMAL(12,2);
ALTER TABLE sale_return_items ALTER COLUMN unit_price TYPE DECIMAL(12,2);
ALTER TABLE sale_return_items ALTER COLUMN subtotal TYPE DECIMAL(12,2);

-- ══ Cash register sessions ══
ALTER TABLE cash_register_sessions ALTER COLUMN opening_amount TYPE DECIMAL(12,2);
ALTER TABLE cash_register_sessions ALTER COLUMN expected_cash TYPE DECIMAL(12,2);
ALTER TABLE cash_register_sessions ALTER COLUMN actual_amount TYPE DECIMAL(12,2);
ALTER TABLE cash_register_sessions ALTER COLUMN difference TYPE DECIMAL(12,2);
ALTER TABLE cash_register_sessions ALTER COLUMN total_revenue TYPE DECIMAL(12,2);
ALTER TABLE cash_register_sessions ALTER COLUMN cash_revenue TYPE DECIMAL(12,2);
ALTER TABLE cash_register_sessions ALTER COLUMN card_revenue TYPE DECIMAL(12,2);
ALTER TABLE cash_register_sessions ALTER COLUMN mobile_revenue TYPE DECIMAL(12,2);
ALTER TABLE cash_register_sessions ALTER COLUMN total_advances TYPE DECIMAL(12,2);

-- ══ HR / Payroll ══
ALTER TABLE payroll ALTER COLUMN base_salary TYPE DECIMAL(12,2);
ALTER TABLE payroll ALTER COLUMN overtime_amount TYPE DECIMAL(12,2);
ALTER TABLE payroll ALTER COLUMN bonuses TYPE DECIMAL(12,2);
ALTER TABLE payroll ALTER COLUMN deductions TYPE DECIMAL(12,2);
ALTER TABLE payroll ALTER COLUMN cnss_employee TYPE DECIMAL(12,2);
ALTER TABLE payroll ALTER COLUMN cnss_employer TYPE DECIMAL(12,2);
ALTER TABLE payroll ALTER COLUMN net_salary TYPE DECIMAL(12,2);

-- ══ Purchase orders ══
ALTER TABLE purchase_order_items ALTER COLUMN unit_price TYPE DECIMAL(12,4);
