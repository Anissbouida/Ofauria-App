-- 716 — Achats affectés à un chantier (feuille de route, étape 5.2).
--
-- Audit court (5.1, 5.3) : la quarantaine à la réception (mig 461, 712), les plans de contrôle
-- par profil, les non-conformités et le rattachement d'une FACTURE à un projet (mig 390)
-- existent. Il manquait l'affectation au moment de la COMMANDE : une ligne de bon de commande
-- peut désormais porter le chantier (projet) qu'elle sert. Le projet affiche ses achats
-- engagés (commandés, hors annulés), distincts des factures reçues déjà comptées en coût.
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_project ON purchase_order_items(project_id) WHERE project_id IS NOT NULL;
COMMENT ON COLUMN purchase_order_items.project_id IS 'Chantier / projet servi par la ligne (mig 716) ; achats engagés du projet.';
