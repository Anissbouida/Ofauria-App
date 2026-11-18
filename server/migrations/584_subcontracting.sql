-- ═══════════════════════════════════════════════════════════════════════
-- 584 — Sous-traitance de production (M9)
--
--   Un ordre de fabrication peut être confié à un sous-traitant :
--     - type d'ordre « sous-traité » (production_order_types.is_subcontracting) :
--       pas de bon de sortie ni de pesage interne, matières consommées à la réception ;
--     - l'ordre porte le sous-traitant (suppliers) et le prix de façon par unité ;
--     - bon d'envoi des composants (subcontract_shipments, série « subcontract_shipment »),
--       qui fige les quantités envoyées ;
--     - la réception du produit fini = la déclaration de production existante (lots de
--       produits finis, consommation des matières, numéros de lot) ;
--     - coût de façon = prix unitaire × quantité reçue, nouvelle composante du coût de
--       revient (production_cout_reel.cout_sous_traitance, incluse dans cout_total).
--   Suivi : subcontract_status à envoyer → envoyé → reçu.
--
-- INVERSION
--   ALTER TABLE production_cout_reel DROP COLUMN cout_total ; re-créer la colonne calculée
--     de la mig 527 ; DROP COLUMN cout_sous_traitance, detail_sous_traitance ;
--   DROP TABLE subcontract_shipment_lines, subcontract_shipments ;
--   DELETE FROM document_sequences WHERE doc_type = 'subcontract_shipment' ;
--   ALTER TABLE production_plans DROP COLUMN subcontractor_id, subcontract_unit_fee,
--     subcontract_status, subcontract_received_at ;
--   ALTER TABLE production_order_types DROP COLUMN is_subcontracting.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE production_order_types ADD COLUMN IF NOT EXISTS is_subcontracting boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  -- Sous-traité : rien n'est prélevé ni pesé chez nous ; matières déduites à la réception.
  ALTER TABLE production_order_types ADD CONSTRAINT chk_pot_subcontracting CHECK (
    NOT is_subcontracting OR (NOT requires_bon_sortie AND NOT requires_weighing AND consumption_mode = 'a_la_declaration'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN production_order_types.is_subcontracting IS 'Ordre confié à un sous-traitant : envoi des composants, réception du produit fini, coût de façon (mig 584).';

ALTER TABLE production_plans
  ADD COLUMN IF NOT EXISTS subcontractor_id uuid REFERENCES suppliers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS subcontract_unit_fee numeric(14,4) CHECK (subcontract_unit_fee IS NULL OR subcontract_unit_fee >= 0),
  ADD COLUMN IF NOT EXISTS subcontract_status varchar(12) CHECK (subcontract_status IS NULL OR subcontract_status IN ('to_ship', 'shipped', 'received')),
  ADD COLUMN IF NOT EXISTS subcontract_received_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_production_plans_subcontractor ON production_plans (subcontractor_id) WHERE subcontractor_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS subcontract_shipments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id       uuid NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  supplier_id   uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  numero        varchar(40) NOT NULL UNIQUE,
  shipped_at    timestamptz NOT NULL DEFAULT now(),
  shipped_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subcontract_shipments_plan ON subcontract_shipments (plan_id);

CREATE TABLE IF NOT EXISTS subcontract_shipment_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id    uuid NOT NULL REFERENCES subcontract_shipments(id) ON DELETE CASCADE,
  ingredient_id  uuid REFERENCES ingredients(id) ON DELETE RESTRICT,
  label          varchar(200) NOT NULL,
  quantity       numeric(14,4) NOT NULL CHECK (quantity >= 0),
  unit           varchar(20)
);
COMMENT ON TABLE subcontract_shipments IS 'Bons d''envoi des composants au sous-traitant (mig 584).';

INSERT INTO document_sequences (doc_type, label, module, pattern, padding, reset_period, target_table, target_column, gapless, display_order)
VALUES ('subcontract_shipment', 'Bon d''envoi sous-traitance', 'production', 'BES-{YYYY}-{SEQ}', 4, 'year', 'subcontract_shipments', 'numero', false, 96)
ON CONFLICT (doc_type) DO NOTHING;

-- Coût de façon dans le coût de revient (même principe que la mig 527).
ALTER TABLE production_cout_reel
  ADD COLUMN IF NOT EXISTS cout_sous_traitance numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS detail_sous_traitance jsonb;
ALTER TABLE production_cout_reel DROP COLUMN IF EXISTS cout_total;
ALTER TABLE production_cout_reel ADD COLUMN cout_total numeric(12,2)
  GENERATED ALWAYS AS (cout_matieres + cout_emballages + cout_main_oeuvre + cout_energie
                       + COALESCE(cout_charges_fixes, 0) + cout_sous_traitance) STORED;
COMMENT ON COLUMN production_cout_reel.cout_total IS 'Coût de revient = matières + emballages + MO + énergie + charges + façon (mig 527, 584).';
