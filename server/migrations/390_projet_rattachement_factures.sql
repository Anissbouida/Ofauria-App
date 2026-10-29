-- Migration 390 : rattachement des achats / charges à un projet
--
-- POURQUOI
--   Le coût d'un projet (mig 358) ne comptait que le temps passé. Les achats
--   (matières, sous-traitance) et les charges (location, transport…) engagés
--   pour le projet n'y entraient pas : la marge affichée ignorait une partie
--   du coût réel.
--
-- PORTEE
--   Dimension « projet » posée sur les FACTURES, comme le centre de coût
--   (mig 386) : une facture fournisseur (invoice_type 'received') rattachée à un
--   projet devient un coût du projet ; une facture émise ('emitted') rattachée
--   devient un produit du projet. Grain facture (le réel engagé/encaissé), pas
--   le bon de commande (engagement). Rattachement réversible (SET NULL).
--
-- INVERSION
--   ALTER TABLE invoices DROP COLUMN IF EXISTS project_id;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_project ON invoices (project_id) WHERE project_id IS NOT NULL;
