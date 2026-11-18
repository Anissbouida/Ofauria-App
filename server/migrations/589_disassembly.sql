-- ═══════════════════════════════════════════════════════════════════════
-- 589 — Désassemblage (M9)
--
--   Défaire des produits finis en leurs composants : N pièces d'un lot de produit fini
--   (arrière-boutique) sortent du stock et les matières de sa nomenclature reviennent en
--   stock, au taux de récupération saisi (100 % par défaut), sous forme de lots matière
--   rattachés au lot d'origine (ingredient_lots.source_product_lot_id, comme le recyclage).
--   Côté lot de produit fini, les pièces défaites sont comptées en recycled_qty : l'invariant
--   du lot (fn_product_lot_invariant) et le passage automatique « épuisé » restent valables.
--   Pièce numérotée DSA-AAAA-NNNN ; lignes = matières rendues, avec leur lot créé.
--
-- INVERSION
--   DROP TABLE disassembly_lines, disassembly_orders ;
--   DELETE FROM document_sequences WHERE doc_type = 'disassembly'.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS disassembly_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero          varchar(40) NOT NULL UNIQUE,
  product_id      uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_lot_id  uuid NOT NULL REFERENCES product_lots(id) ON DELETE RESTRICT,
  quantity        numeric(12,3) NOT NULL CHECK (quantity > 0),
  recovery_pct    numeric(5,2) NOT NULL DEFAULT 100 CHECK (recovery_pct > 0 AND recovery_pct <= 100),
  store_id        uuid REFERENCES stores(id) ON DELETE SET NULL,
  notes           text,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_disassembly_orders_lot ON disassembly_orders (product_lot_id);

CREATE TABLE IF NOT EXISTS disassembly_lines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  disassembly_id     uuid NOT NULL REFERENCES disassembly_orders(id) ON DELETE CASCADE,
  ingredient_id      uuid NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  quantity           numeric(14,4) NOT NULL CHECK (quantity > 0),
  unit_cost          numeric(14,4),
  ingredient_lot_id  uuid REFERENCES ingredient_lots(id) ON DELETE SET NULL
);
COMMENT ON TABLE disassembly_orders IS 'Désassemblages : produits finis défaits, matières remises en stock (mig 589).';

INSERT INTO document_sequences (doc_type, label, module, pattern, padding, reset_period, target_table, target_column, gapless, display_order)
VALUES ('disassembly', 'Désassemblage', 'production', 'DSA-{YYYY}-{SEQ}', 4, 'year', 'disassembly_orders', 'numero', false, 97)
ON CONFLICT (doc_type) DO NOTHING;
