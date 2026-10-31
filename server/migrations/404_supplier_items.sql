-- 404 — Fiche article × fournisseur (Achats, lot prix P1)
--
-- Un article (ingrédient ou consommable) peut avoir 1 à 6 fournisseurs, chacun
-- avec sa référence, son conditionnement, son délai et son prix. La colonne
-- mono-valuée `ingredients.supplier_id` (mig 136, morte : 0 usage) ne peut pas le
-- représenter. On crée la table pivot. Les PRIX datés arriveront au lot P2
-- (supplier_item_prices) ; ici : la fiche (réf, contenant, délai, MOQ, préférence).
--
-- Polymorphe : purchasable_kind + purchasable_id pointe vers ingredients.id OU
-- packaging_items.id (pas de FK dure ; cohérence côté service, comme fn_purchasable_kind
-- mig 207). Un seul fournisseur PRÉFÉRÉ par article (index unique partiel).
--
-- INVERSION : DROP TABLE IF EXISTS supplier_items;

CREATE TABLE IF NOT EXISTS supplier_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id        UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  purchasable_kind   VARCHAR(20) NOT NULL CHECK (purchasable_kind IN ('ingredient', 'packaging')),
  purchasable_id     UUID NOT NULL,
  supplier_reference VARCHAR(120),
  container_type_id  UUID REFERENCES ref_entries(id) ON DELETE SET NULL,
  qty_per_container  NUMERIC(12,3) CHECK (qty_per_container IS NULL OR qty_per_container > 0),
  lead_time_days     INTEGER       CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  moq                NUMERIC(12,3) CHECK (moq IS NULL OR moq >= 0),
  is_preferred       BOOLEAN NOT NULL DEFAULT false,
  is_blocked         BOOLEAN NOT NULL DEFAULT false,
  notes              TEXT,
  store_id           UUID REFERENCES stores(id),
  created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at        TIMESTAMPTZ,
  UNIQUE (supplier_id, purchasable_kind, purchasable_id)
);

-- Un seul fournisseur préféré par article (hors archivés).
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_items_preferred
  ON supplier_items (purchasable_kind, purchasable_id)
  WHERE is_preferred AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_items_purchasable ON supplier_items (purchasable_kind, purchasable_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_items_supplier    ON supplier_items (supplier_id) WHERE archived_at IS NULL;

COMMENT ON TABLE supplier_items IS
  'Fiche article × fournisseur (réf, conditionnement, délai, MOQ, préférence) ; prix datés au lot P2 (Achats lot prix P1).';
