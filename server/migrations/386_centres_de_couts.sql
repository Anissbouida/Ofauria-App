-- 386 — Centres de coûts (comptabilité analytique, v1 sur les factures)
--
-- Dimension analytique libre (ex. Boulangerie, Pâtisserie, Traiteur, Général) pour
-- ventiler charges et produits et sortir un résultat par activité. (ERPNext
-- « Cost Center », SAP « centre de coût.)
--
-- Portée v1 : la dimension se pose sur les FACTURES (charges = factures
-- fournisseurs, produits = factures émises). Le rapport agrège les montants HT
-- par centre sur une période. Pas de ventilation au niveau des écritures du grand
-- livre à ce stade (extension possible une fois les conventions arrêtées).
--
-- Rollback :
--   ALTER TABLE invoices DROP COLUMN cost_center_id ;
--   DROP TABLE cost_centers ;

CREATE TABLE IF NOT EXISTS cost_centers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       VARCHAR(20) NOT NULL UNIQUE,
  name       VARCHAR(120) NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  store_id   UUID REFERENCES stores(id),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_cost_center ON invoices (cost_center_id);
