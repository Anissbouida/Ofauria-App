-- Allow 'replenishment_in' as a stock transaction type. This is logged by
-- confirmReception when backroom stock is transferred onto the vitrine for a
-- given store, which is now the only path that creates sellable stock.

ALTER TABLE product_stock_transactions
  DROP CONSTRAINT IF EXISTS product_stock_transactions_type_check;

ALTER TABLE product_stock_transactions
  ADD CONSTRAINT product_stock_transactions_type_check
  CHECK (type::text = ANY (ARRAY[
    'production'::varchar,
    'sale'::varchar,
    'return'::varchar,
    'adjustment'::varchar,
    'waste'::varchar,
    'exchange'::varchar,
    'loss'::varchar,
    'replenishment_in'::varchar
  ]::text[]));
