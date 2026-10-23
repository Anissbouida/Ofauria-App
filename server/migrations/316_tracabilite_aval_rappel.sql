-- ═══════════════════════════════════════════════════════════════════════
-- 316 — Traçabilité aval et rappel produit, lot 3
--   « Ce lot de farine est contaminé : quels produits, quels magasins, quelles
--   ventes ? » La traçabilité amont existait (lot ingrédient → plan, mig 056/300) ;
--   l'aval s'arrêtait au compteur sold_qty du lot produit.
--
--   1. product_lot_movements : chaque mouvement d'un lot produit fini (mise en
--      vitrine, vente, perte, recyclage) avec sa pièce d'origine (vente, demande
--      d'approvisionnement…). Démarre à la mise en service : pas de rattrapage,
--      l'historique antérieur reste lisible par les compteurs du lot.
--   2. Statut 'recalled' sur product_lots : exclu du FEFO (status = 'active').
--   3. product_recalls / product_recall_items : la procédure de rappel et son
--      périmètre figé au moment de l'ouverture (rapport ONSSA).
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS product_lot_movements (
  id              BIGSERIAL PRIMARY KEY,
  product_lot_id  UUID NOT NULL REFERENCES product_lots(id) ON DELETE CASCADE,
  store_id        UUID REFERENCES stores(id),
  kind            VARCHAR(12) NOT NULL CHECK (kind IN ('display', 'sale', 'waste', 'recycle')),
  quantity        NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  ref_type        VARCHAR(30),
  ref_id          UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_lot_movements_lot ON product_lot_movements(product_lot_id, created_at);
CREATE INDEX IF NOT EXISTS idx_product_lot_movements_ref ON product_lot_movements(ref_type, ref_id);

-- Lot rappelé : retiré de la vente, hors FEFO.
ALTER TABLE product_lots DROP CONSTRAINT IF EXISTS product_lots_status_check;
ALTER TABLE product_lots ADD CONSTRAINT product_lots_status_check
  CHECK (status IN ('active', 'depleted', 'expired', 'disposed', 'recalled'));

ALTER TABLE semi_finished_lots DROP CONSTRAINT IF EXISTS semi_finished_lots_status_check;
ALTER TABLE semi_finished_lots ADD CONSTRAINT semi_finished_lots_status_check
  CHECK (status IN ('active', 'depleted', 'expired', 'disposed', 'recalled'));

-- ─── Rappels ─────────────────────────────────────────────────────────────
-- open    : périmètre identifié, rien n'est encore bloqué
-- blocked : lots bloqués (quarantaine / rappelés), retrait physique en cours
-- closed  : procédure terminée (destination de chaque lot renseignée)
CREATE TABLE IF NOT EXISTS product_recalls (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference      VARCHAR(20) NOT NULL UNIQUE,
  store_id       UUID REFERENCES stores(id),
  origin_kind    VARCHAR(20) NOT NULL CHECK (origin_kind IN ('ingredient_lot', 'product_lot')),
  origin_id      UUID NOT NULL,
  origin_label   TEXT NOT NULL,
  reason         TEXT NOT NULL,
  status         VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'blocked', 'closed')),
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  blocked_by     UUID REFERENCES users(id),
  blocked_at     TIMESTAMPTZ,
  closed_by      UUID REFERENCES users(id),
  closed_at      TIMESTAMPTZ,
  closing_note   TEXT
);

CREATE TABLE IF NOT EXISTS product_recall_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recall_id          UUID NOT NULL REFERENCES product_recalls(id) ON DELETE CASCADE,
  item_kind          VARCHAR(20) NOT NULL CHECK (item_kind IN ('ingredient_lot', 'product_lot', 'semi_finished_lot')),
  lot_id             UUID NOT NULL,
  label              TEXT NOT NULL,
  lot_number         VARCHAR(60),
  store_id           UUID REFERENCES stores(id),
  -- certain : la recette contient l'ingrédient ; possible : même production, composition non prouvée
  certainty          VARCHAR(10) NOT NULL DEFAULT 'certain' CHECK (certainty IN ('certain', 'possible')),
  qty_total          NUMERIC(12,3),
  qty_sold           NUMERIC(12,3),
  qty_remaining      NUMERIC(12,3),
  unit               VARCHAR(10),
  previous_status    VARCHAR(20),
  disposition        VARCHAR(20) CHECK (disposition IN ('detruit', 'retourne_fournisseur', 'libere', 'deja_consomme')),
  disposition_note   TEXT,
  UNIQUE (recall_id, item_kind, lot_id)
);
CREATE INDEX IF NOT EXISTS idx_recall_items_lot ON product_recall_items(item_kind, lot_id);
