-- M7-05 — Non-conformités structurées.
-- Avant (mig 385) : référence en texte libre, une action corrective en un champ.
-- Désormais : clés vers le lot (matière ou produit fini), le fournisseur, l'ordre,
-- l'inspection d'origine, la réclamation client ; cause (référentiel nc_causes, 5 M +
-- mesure) ; décision sur le lot (accepté, retouché, déclassé, détruit, retour fournisseur) ;
-- table d'actions (corrective / préventive) avec responsable, échéance, état et vérification
-- d'efficacité. Une non-conformité fournisseur compte dans la note qualité du fournisseur
-- (mig 362) ; une destruction envoie le lot aux pertes au coût de revient.

INSERT INTO ref_tables (id, label, description, icon, source, editable, display_order)
VALUES ('nc_causes', 'Causes de non-conformité', 'Référentiel des causes de non-conformité (méthode des 5 M + mesure, M7-05).', 'GitBranch', 'ref_entries', true, 61)
ON CONFLICT (id) DO NOTHING;
INSERT INTO ref_entries (table_id, code, label, display_order) VALUES
  ('nc_causes', 'matiere', 'Matière', 10), ('nc_causes', 'methode', 'Méthode', 20), ('nc_causes', 'main_oeuvre', 'Main-d''œuvre', 30),
  ('nc_causes', 'milieu', 'Milieu', 40), ('nc_causes', 'machine', 'Machine', 50), ('nc_causes', 'mesure', 'Mesure', 60),
  ('nc_causes', 'fournisseur', 'Fournisseur', 70), ('nc_causes', 'autre', 'Autre', 999)
ON CONFLICT (table_id, code) DO NOTHING;

ALTER TABLE quality_nonconformities
  ADD COLUMN IF NOT EXISTS product_lot_id UUID REFERENCES product_lots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ingredient_lot_id UUID REFERENCES ingredient_lots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES production_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inspection_id UUID REFERENCES quality_inspections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS complaint_id UUID REFERENCES complaints(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cause_code VARCHAR(40),
  ADD COLUMN IF NOT EXISTS lot_decision VARCHAR(20),
  ADD COLUMN IF NOT EXISTS lot_decided_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS lot_decided_at TIMESTAMPTZ;
DO $$ BEGIN
  ALTER TABLE quality_nonconformities ADD CONSTRAINT chk_nc_lot_decision
    CHECK (lot_decision IS NULL OR lot_decision IN ('accepte', 'retouche', 'declasse', 'detruit', 'retour_fournisseur'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_nc_supplier ON quality_nonconformities (supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nc_inspection ON quality_nonconformities (inspection_id) WHERE inspection_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS quality_nc_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nc_id UUID NOT NULL REFERENCES quality_nonconformities(id) ON DELETE CASCADE,
  action_type VARCHAR(12) NOT NULL CHECK (action_type IN ('corrective', 'preventive')),
  description TEXT NOT NULL,
  responsible_id UUID REFERENCES users(id),
  due_date DATE,
  status VARCHAR(10) NOT NULL DEFAULT 'a_faire' CHECK (status IN ('a_faire', 'en_cours', 'faite')),
  done_at TIMESTAMPTZ,
  effectiveness_checked_at DATE,
  effectiveness_result VARCHAR(12) CHECK (effectiveness_result IS NULL OR effectiveness_result IN ('efficace', 'inefficace')),
  effectiveness_note TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nc_actions_nc ON quality_nc_actions (nc_id);
CREATE INDEX IF NOT EXISTS idx_nc_actions_open ON quality_nc_actions (due_date) WHERE status <> 'faite';

-- Reprise : l'action corrective en un champ devient une action « corrective ».
INSERT INTO quality_nc_actions (nc_id, action_type, description, responsible_id, due_date, status, done_at)
SELECT nc.id, 'corrective', nc.corrective_action, nc.responsible_id, nc.due_date,
       CASE WHEN nc.status = 'closed' THEN 'faite' ELSE 'a_faire' END, nc.closed_at
  FROM quality_nonconformities nc
 WHERE COALESCE(btrim(nc.corrective_action), '') <> ''
   AND NOT EXISTS (SELECT 1 FROM quality_nc_actions a WHERE a.nc_id = nc.id);
