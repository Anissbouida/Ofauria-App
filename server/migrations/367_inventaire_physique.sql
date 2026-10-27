-- 367 — Inventaire physique dans l'application
--
-- Remplace le script SQL ad hoc (server/scripts/inventaire-physique-<date>.sql) :
-- une campagne d'inventaire liste les articles à compter (matières, consommables, ou
-- les deux ; tout le stock ou quelques catégories pour un inventaire tournant), le
-- magasinier saisit les quantités comptées, la direction valide.
--
-- Écart : à la saisie d'un comptage, la ligne fige le stock théorique de cet instant
-- (theoretical_at_count). À la validation, l'ajustement = compté − théorique figé, appliqué
-- en différence au stock courant : les mouvements saisis entre le comptage et la
-- validation sont conservés (pas d'écrasement par une valeur absolue).
-- Une ligne non comptée ne bouge pas (inventaire partiel), sauf si la validation demande
-- explicitement « non compté = 0 » (inventaire complet).
--
-- Mouvements : matières → mêmes règles que l'ajustement manuel (lot d'ajustement en plus,
-- prélèvement FIFO en moins), transaction type 'inventory' ; consommables → transaction
-- 'adjustment' de packaging_stock_transactions. Valorisation au coût moyen (CMUP) du jour
-- de validation ; pas d'écriture comptable automatique (comme les ajustements existants).
--
-- Rollback :
--   DROP TABLE stock_count_lines, stock_counts ;
--   DELETE FROM document_sequences WHERE doc_type = 'stock_count' ;
--   DELETE FROM notification_rules WHERE type = 'stock_count_to_validate'.

CREATE TABLE IF NOT EXISTS stock_counts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number           VARCHAR(30) NOT NULL UNIQUE,
  store_id         UUID REFERENCES stores(id),
  title            VARCHAR(200),
  scope            VARCHAR(12) NOT NULL DEFAULT 'full' CHECK (scope IN ('full', 'partial')),
  item_kinds       VARCHAR(12) NOT NULL DEFAULT 'both' CHECK (item_kinds IN ('ingredient', 'packaging', 'both')),
  category_ids     UUID[] NOT NULL DEFAULT '{}',
  blind            BOOLEAN NOT NULL DEFAULT true,
  status           VARCHAR(12) NOT NULL DEFAULT 'counting' CHECK (status IN ('counting', 'review', 'validated', 'cancelled')),
  count_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  notes            TEXT,
  zero_uncounted   BOOLEAN NOT NULL DEFAULT false,
  lines_total      INTEGER NOT NULL DEFAULT 0,
  lines_counted    INTEGER NOT NULL DEFAULT 0,
  gap_value        NUMERIC(14,2),
  gain_value       NUMERIC(14,2),
  loss_value       NUMERIC(14,2),
  submitted_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  submitted_at     TIMESTAMPTZ,
  validated_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  validated_at     TIMESTAMPTZ,
  cancelled_at     TIMESTAMPTZ,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_counts_status ON stock_counts (status, created_at DESC);
-- Une seule campagne ouverte par magasin à la fois : deux comptages simultanés du même
-- article donneraient deux ajustements.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_counts_open ON stock_counts (COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status IN ('counting', 'review');
COMMENT ON TABLE stock_counts IS 'Campagnes d''inventaire physique (mig 367).';

CREATE TABLE IF NOT EXISTS stock_count_lines (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id              UUID NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  item_kind             VARCHAR(10) NOT NULL CHECK (item_kind IN ('ingredient', 'packaging')),
  ingredient_id         UUID REFERENCES ingredients(id),
  packaging_id          UUID REFERENCES packaging_items(id),
  item_name             VARCHAR(200) NOT NULL,
  unit                  VARCHAR(20),
  category_id           UUID,
  container_size        NUMERIC(12,3),
  theoretical_at_start  NUMERIC(14,4) NOT NULL,
  theoretical_at_count  NUMERIC(14,4),
  counted_qty           NUMERIC(14,4) CHECK (counted_qty IS NULL OR counted_qty >= 0),
  counted_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  counted_at            TIMESTAMPTZ,
  note                  VARCHAR(300),
  unit_cost             NUMERIC(14,4),
  applied_qty           NUMERIC(14,4),
  applied_value         NUMERIC(14,2),
  CHECK ((item_kind = 'ingredient') = (ingredient_id IS NOT NULL)),
  CHECK ((item_kind = 'packaging') = (packaging_id IS NOT NULL)),
  CHECK ((counted_qty IS NULL) = (theoretical_at_count IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_stock_count_lines ON stock_count_lines (count_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_count_line_ing ON stock_count_lines (count_id, ingredient_id) WHERE ingredient_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_count_line_pkg ON stock_count_lines (count_id, packaging_id) WHERE packaging_id IS NOT NULL;

DROP TRIGGER IF EXISTS stock_counts_touch ON stock_counts;
CREATE OR REPLACE FUNCTION trg_stock_counts_touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER stock_counts_touch BEFORE UPDATE ON stock_counts FOR EACH ROW EXECUTE FUNCTION trg_stock_counts_touch();

INSERT INTO document_sequences (doc_type, label, module, pattern, padding, reset_period, target_table, target_column, gapless, display_order)
VALUES ('stock_count', 'Inventaire physique', 'stock', 'INV-{YYYY}-{SEQ}', 4, 'year', 'stock_counts', 'number', false, 30)
ON CONFLICT (doc_type) DO NOTHING;

INSERT INTO notification_rules (type, label, domain) VALUES
  ('stock_count_to_validate', 'Inventaire physique à valider', 'stock')
ON CONFLICT (type) DO NOTHING;
