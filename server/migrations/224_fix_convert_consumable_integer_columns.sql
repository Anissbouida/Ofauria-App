-- Migration 224 : corrige la derive de schema sur les colonnes de quantite
-- du chemin « Convertir en consommable ».
--
-- Symptome : la conversion d'un ingredient en consommable echoue avec
--   « invalid input syntax for type integer: "35.2" »
-- (35.2 = SUM(economat_quantity + pesage_quantity) des lots actifs).
--
-- Cause : sur certaines bases (prod), une ou plusieurs colonnes de quantite
-- ecrites par convertToConsumable sont encore typees integer (heritage d'un
-- ancien schema, avant l'alignement decimal). node-pg serialise le nombre JS
-- 35.2 en "35.2", que Postgres refuse de caster en integer. Les migrations
-- actuelles definissent pourtant ces colonnes en numeric -> la base est en
-- derive et le verrou checksum empeche de re-jouer les migrations d'origine.
--
-- Strategie : ré-aligner en numeric UNIQUEMENT les colonnes encore en
-- integer/smallint/bigint. Idempotent et no-op la ou le type est deja correct
-- (aucune reecriture de table inutile).

DO $$
DECLARE
  rec RECORD;
  -- (table, colonne, type cible) — toutes les colonnes ecrites par la
  -- conversion (inserts directs + triggers de sync des lots/inventaire).
  targets CONSTANT text[][] := ARRAY[
    ['packaging_store_stock',        'stock_quantity',       'numeric(12,3)'],
    ['packaging_store_stock',        'stock_min_threshold',  'numeric(12,3)'],
    ['packaging_stock_transactions', 'quantity_change',      'numeric(12,3)'],
    ['packaging_stock_transactions', 'stock_after',          'numeric(12,3)'],
    ['inventory',                    'current_quantity',     'numeric(12,4)'],
    ['inventory',                    'minimum_threshold',    'numeric(12,4)'],
    ['ingredient_lots',              'economat_quantity',    'numeric(12,4)'],
    ['ingredient_lots',              'pesage_quantity',      'numeric(12,4)'],
    ['ingredient_lots',              'quantity_received',    'numeric(12,4)'],
    ['ingredient_lots',              'quantity_remaining',   'numeric(12,4)']
  ];
  t text[];
BEGIN
  FOREACH t SLICE 1 IN ARRAY targets LOOP
    FOR rec IN
      SELECT data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name  = t[1]
        AND column_name = t[2]
        AND data_type IN ('integer','smallint','bigint')
    LOOP
      EXECUTE format(
        'ALTER TABLE %I ALTER COLUMN %I TYPE %s USING %I::numeric',
        t[1], t[2], t[3], t[2]
      );
      RAISE NOTICE 'Colonne re-alignee : %.% (% -> %)', t[1], t[2], rec.data_type, t[3];
    END LOOP;
  END LOOP;
END $$;
