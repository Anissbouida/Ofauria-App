-- Migration 477 : commercial attitré (phase 4.5)
--
-- Un commercial (utilisateur) peut être attitré à un client ; il est REPRIS sur
-- chaque pièce de vente (devis, commande, BL, facture) à l'émission, pour lire
-- le chiffre d'affaires par commercial sur les pièces B2B. On fige l'id sur la
-- pièce : réaffecter un client plus tard ne réécrit pas l'historique.

ALTER TABLE customers       ADD COLUMN IF NOT EXISTS salesperson_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE orders          ADD COLUMN IF NOT EXISTS salesperson_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE quotes          ADD COLUMN IF NOT EXISTS salesperson_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE delivery_notes  ADD COLUMN IF NOT EXISTS salesperson_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE invoices        ADD COLUMN IF NOT EXISTS salesperson_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customers_salesperson ON customers(salesperson_id) WHERE salesperson_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_salesperson ON invoices(salesperson_id) WHERE salesperson_id IS NOT NULL;
