-- Réévaluation du stock sur écart de prix (analyse d'écart P2P, lot L3 —
-- incrément 3/5 : structures + simulation. docs/AUDIT_P2P_GAP_ANALYSIS.md).
--
-- Quand la facture arrive à un prix différent de celui reçu (donc du coût du lot),
-- l'écart se répartit : la part ENCORE EN STOCK réévalue le lot (et le CMUP), la
-- part DÉJÀ CONSOMMÉE part en compte d'écart (IPV). Grâce à l'incrément 1/5
-- (coût figé à la consommation), le consommé n'est pas réécrit.
--
-- CET INCRÉMENT NE PASSE AUCUNE ÉCRITURE : il crée la table de traçabilité et une
-- fonction de SIMULATION en lecture seule (fn_stock_revaluation_preview). La
-- réévaluation effective (mise à jour du lot/CMUP + écriture au compte d'écart)
-- et le profil de posting 'price_variance' sont l'incrément 3b, APRÈS validation
-- des montants simulés sur données réelles (dry-run), comme l'exige le doc.

CREATE TABLE IF NOT EXISTS stock_valuation_adjustments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind        VARCHAR(20) NOT NULL CHECK (source_kind IN ('invoice_price', 'landed_cost', 'manual')),
  source_id          UUID NOT NULL,
  ingredient_lot_id  UUID REFERENCES ingredient_lots(id),
  ingredient_id      UUID REFERENCES ingredients(id),
  packaging_id       UUID REFERENCES packaging_items(id),
  qty_basis          NUMERIC(14,4) NOT NULL,              -- quantité facturée concernée
  qty_remaining      NUMERIC(14,4) NOT NULL,              -- part encore en stock → réévaluée
  unit_delta         NUMERIC(12,4) NOT NULL,              -- prix facture − coût du lot
  amount_to_stock    NUMERIC(14,2) NOT NULL,              -- unit_delta × qty_remaining
  amount_to_variance NUMERIC(14,2) NOT NULL,              -- unit_delta × (qty_basis − qty_remaining)
  cmup_before        NUMERIC(12,4),
  cmup_after         NUMERIC(12,4),
  journal_entry_id   UUID REFERENCES journal_entries(id),
  created_by         UUID NOT NULL REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(ingredient_id, packaging_id) = 1),
  CHECK (amount_to_stock + amount_to_variance = round(unit_delta * qty_basis, 2)),
  UNIQUE (source_kind, source_id, ingredient_lot_id)       -- idempotence
);
CREATE INDEX IF NOT EXISTS ix_sva_lot ON stock_valuation_adjustments(ingredient_lot_id);
COMMENT ON TABLE stock_valuation_adjustments IS
  'Réévaluations de stock sur écart de prix (facture / frais d''approche) — lot L3 P2P (mig 446). Une ligne par lot et par source, idempotente.';

-- Simulation (lecture seule) : pour une facture reçue, ce que la réévaluation
-- ferait, ligne de BC par ligne de BC rattachée à un lot. Ne modifie RIEN.
-- amount_to_variance est calculé par différence pour garantir l'invariant
-- amount_to_stock + amount_to_variance = round(unit_delta × qty_basis, 2).
CREATE OR REPLACE FUNCTION fn_stock_revaluation_preview(p_invoice_id uuid)
RETURNS TABLE (
  ingredient_lot_id  uuid,
  item_name          text,
  lot_unit_cost      numeric,
  invoice_unit_price numeric,
  unit_delta         numeric,
  qty_basis          numeric,
  qty_remaining      numeric,
  amount_to_stock    numeric,
  amount_to_variance numeric
) AS $$
  SELECT
    il.id,
    COALESCE(ing.name, pkg.name)                         AS item_name,
    il.unit_cost                                         AS lot_unit_cost,
    ii.unit_price                                        AS invoice_unit_price,
    round(ii.unit_price - il.unit_cost, 4)               AS unit_delta,
    ii.quantity                                          AS qty_basis,
    LEAST(il.quantity_remaining, ii.quantity)            AS qty_remaining,
    round((ii.unit_price - il.unit_cost) * LEAST(il.quantity_remaining, ii.quantity), 2) AS amount_to_stock,
    round((ii.unit_price - il.unit_cost) * ii.quantity, 2)
      - round((ii.unit_price - il.unit_cost) * LEAST(il.quantity_remaining, ii.quantity), 2) AS amount_to_variance
  FROM invoice_items ii
  JOIN ingredient_lots il
    ON il.reception_voucher_item_id = ii.reception_voucher_item_id
  LEFT JOIN ingredients ing ON ing.id = il.ingredient_id
  LEFT JOIN packaging_items pkg ON pkg.id = ii.packaging_id
  WHERE ii.invoice_id = p_invoice_id
    AND ii.reception_voucher_item_id IS NOT NULL
    AND ii.unit_price IS NOT NULL
    AND abs(ii.unit_price - il.unit_cost) > 0.0001;
$$ LANGUAGE sql STABLE;
