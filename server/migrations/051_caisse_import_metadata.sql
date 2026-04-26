-- Traçabilité des imports Excel caisse (journal mensuel)
-- Permet de relancer un import sans doublon grâce à l'index unique partiel.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS import_source VARCHAR(60),
  ADD COLUMN IF NOT EXISTS import_source_row INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_import_source_row
  ON payments (import_source, import_source_row)
  WHERE import_source IS NOT NULL;
