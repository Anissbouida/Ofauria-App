-- Allow customer deletion by setting customer_id to NULL in related tables
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_customer_id_fkey;
ALTER TABLE orders ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;

ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_customer_id_fkey;
ALTER TABLE sales ADD CONSTRAINT sales_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
