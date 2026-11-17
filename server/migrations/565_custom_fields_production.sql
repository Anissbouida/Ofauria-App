-- M4-07 — Champs personnalisés sur les fiches techniques, les ordres et les lots.
-- Le moteur de la migration 369 (custom_field_defs + colonne JSONB custom_fields)
-- reçoit trois types de fiche : recipe, production_order, product_lot.
-- Rollback : recréer custom_field_defs_entity_check sans ces trois valeurs ;
--   ALTER TABLE recipes / production_plans / product_lots DROP COLUMN custom_fields.

ALTER TABLE custom_field_defs DROP CONSTRAINT IF EXISTS custom_field_defs_entity_check;
ALTER TABLE custom_field_defs ADD CONSTRAINT custom_field_defs_entity_check CHECK (entity IN (
  'customer', 'supplier', 'ingredient', 'packaging_item', 'product', 'order', 'intervention', 'project', 'opportunity',
  'recipe', 'production_order', 'product_lot'));

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['recipes', 'production_plans', 'product_lots'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT ''{}''::jsonb', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING gin (custom_fields)', 'idx_' || t || '_custom_fields', t);
  END LOOP;
END $$;
