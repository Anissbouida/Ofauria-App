-- Option B : Workflow strict Économat / Pesage
-- Le BSI n'alloue QUE depuis Pesage. Si Pesage insuffisant, la ligne est marquee
-- "transfert requis" avec reference au lot Economat suggere (FEFO sur DLC).
-- Le magasinier doit transferer (ouvrir le contenant) AVANT de marquer le BSI pret.
-- Le chef ne voit jamais l'etat de dispo : c'est le magasinier qui gere.

-- ─── Lignes BSI : source_location structure + ref lot Economat suggere ─────
ALTER TABLE production_bons_sortie_lignes
  ADD COLUMN IF NOT EXISTS source_location text
    CHECK (source_location IN ('PESAGE', 'ECONOMAT_REQUIRES_TRANSFER', 'RUPTURE')),
  ADD COLUMN IF NOT EXISTS suggested_economat_lot_id uuid
    REFERENCES ingredient_lots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transfer_required_qty numeric(12,4),
  ADD COLUMN IF NOT EXISTS transferred_at timestamptz,
  ADD COLUMN IF NOT EXISTS transferred_by uuid REFERENCES users(id);

COMMENT ON COLUMN production_bons_sortie_lignes.source_location IS
  'Zone source au moment de la generation du BSI. PESAGE=alloue directement, ECONOMAT_REQUIRES_TRANSFER=transfert requis avant prelevement, RUPTURE=insuffisant total';
COMMENT ON COLUMN production_bons_sortie_lignes.suggested_economat_lot_id IS
  'Lot Economat suggere par FEFO si transfert requis. Le magasinier peut substituer.';
COMMENT ON COLUMN production_bons_sortie_lignes.transfer_required_qty IS
  'Quantite a transferer Economat -> Pesage avant prelevement';

CREATE INDEX IF NOT EXISTS idx_bsi_lignes_source_location
  ON production_bons_sortie_lignes(source_location)
  WHERE source_location = 'ECONOMAT_REQUIRES_TRANSFER';

-- ─── Tracabilite des transferts inter-zones (mouvement de stock par zone) ──
CREATE TABLE IF NOT EXISTS ingredient_stock_zone_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_lot_id uuid NOT NULL REFERENCES ingredient_lots(id),
  store_id uuid NOT NULL REFERENCES stores(id),
  from_zone text NOT NULL CHECK (from_zone IN ('ECONOMAT', 'PESAGE')),
  to_zone text NOT NULL CHECK (to_zone IN ('ECONOMAT', 'PESAGE')),
  quantity numeric(12,4) NOT NULL CHECK (quantity > 0),
  container_count int,
  bon_sortie_id uuid REFERENCES production_bons_sortie(id) ON DELETE SET NULL,
  bon_sortie_ligne_id uuid REFERENCES production_bons_sortie_lignes(id) ON DELETE SET NULL,
  reason text,
  transferred_by uuid NOT NULL REFERENCES users(id),
  transferred_at timestamptz NOT NULL DEFAULT NOW(),
  CHECK (from_zone <> to_zone)
);

COMMENT ON TABLE ingredient_stock_zone_transfers IS
  'Historique des transferts inter-zones (Economat <-> Pesage). Toutes les infos de tracabilite (lot, DLC, fournisseur) sont conservees via le FK ingredient_lot_id.';

CREATE INDEX IF NOT EXISTS idx_zone_transfers_lot
  ON ingredient_stock_zone_transfers(ingredient_lot_id, transferred_at DESC);
CREATE INDEX IF NOT EXISTS idx_zone_transfers_bon
  ON ingredient_stock_zone_transfers(bon_sortie_id) WHERE bon_sortie_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_zone_transfers_store_date
  ON ingredient_stock_zone_transfers(store_id, transferred_at DESC);

-- ─── Backfill source_location sur les lignes existantes ────────────────────
-- Mapping (avant Option B, FEFO 3-etapes deja allouait depuis Economat) :
--   - lot null            -> RUPTURE
--   - status='rupture' + lot present + allocated>=needed -> ECONOMAT_REQUIRES_TRANSFER
--     (c'est l'ancien cas "a ouvrir depuis economat")
--   - autres lignes ingredient avec lot -> PESAGE
UPDATE production_bons_sortie_lignes
   SET source_location = CASE
     WHEN ingredient_id IS NULL THEN NULL  -- lignes packaging, pas concernees
     WHEN ingredient_lot_id IS NULL THEN 'RUPTURE'
     WHEN status = 'rupture'
          AND ingredient_lot_id IS NOT NULL
          AND COALESCE(allocated_quantity, 0) >= COALESCE(needed_quantity, 0)
       THEN 'ECONOMAT_REQUIRES_TRANSFER'
     ELSE 'PESAGE'
   END
 WHERE source_location IS NULL
   AND ingredient_id IS NOT NULL;

-- Pour les lignes ECONOMAT_REQUIRES_TRANSFER backfillees, copier le lot allouee
-- comme suggested_economat_lot_id (l'ancien code mettait deja le bon lot Economat
-- dans ingredient_lot_id). On garde ingredient_lot_id pour ne pas casser la
-- compat lecture, mais le frontend doit s'appuyer sur source_location desormais.
UPDATE production_bons_sortie_lignes
   SET suggested_economat_lot_id = ingredient_lot_id,
       transfer_required_qty = needed_quantity
 WHERE source_location = 'ECONOMAT_REQUIRES_TRANSFER'
   AND suggested_economat_lot_id IS NULL;
