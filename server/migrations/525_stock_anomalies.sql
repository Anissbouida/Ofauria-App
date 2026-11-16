-- G0-18 (plan d'action 2026-11) — sorties de stock supérieures au disponible.
--
-- Une sortie plus grande que le stock était ramenée à zéro sans trace. Chaque
-- manque est désormais enregistré ici (mode « autoriser et tracer », le comportement
-- d'avant mais visible) ou refusé (mode « bloquer »), selon le paramètre
-- stock.negative_policy, réglable par type d'article.
CREATE TABLE IF NOT EXISTS stock_anomalies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_kind       varchar(20)  NOT NULL CHECK (item_kind IN ('ingredient', 'product', 'packaging', 'semi_finished')),
  item_id         uuid         NOT NULL,
  lot_id          uuid,
  store_id        uuid REFERENCES stores(id),
  requested_qty   numeric(14,3) NOT NULL,
  available_qty   numeric(14,3) NOT NULL,
  shortfall_qty   numeric(14,3) NOT NULL CHECK (shortfall_qty > 0),
  origin_type     varchar(40)  NOT NULL,
  origin_id       uuid,
  label           text,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz  NOT NULL DEFAULT now(),
  status          varchar(10)  NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_by     uuid REFERENCES users(id),
  resolved_at     timestamptz,
  resolution_note text,
  CONSTRAINT chk_stock_anomalies_resolution CHECK (status = 'open' OR (resolved_at IS NOT NULL AND resolution_note IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_stock_anomalies_status ON stock_anomalies (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_anomalies_item ON stock_anomalies (item_kind, item_id);

INSERT INTO module_parameters (key, value, description) VALUES
  ('stock.negative_policy',
   '{"ingredient":"allow_trace","product":"allow_trace","packaging":"allow_trace","semi_finished":"allow_trace"}'::jsonb,
   'Sortie supérieure au stock, par type d''article : allow_trace (stock ramené à zéro, anomalie enregistrée) ou block (sortie refusée).')
ON CONFLICT (key) DO NOTHING;
