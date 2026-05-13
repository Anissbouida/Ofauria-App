-- ============================================
-- Ventes en paiement reporte (credit client / personnel)
-- ============================================
-- Un caissier peut sauvegarder une vente sans encaissement immediat
-- pour un client connu ou un nom libre (ex: personnel). La marchandise
-- part avec le client, le stock est decremente normalement, mais la
-- vente reste flaggee 'unpaid' jusqu'a son encaissement ulterieur.

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(10) NOT NULL DEFAULT 'paid'
    CHECK (payment_status IN ('paid', 'unpaid'));

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

-- Nom libre pour beneficiaire sans fiche client formelle (ex: "Joseph - personnel").
-- Optionnel : si customer_id est renseigne, ce champ peut rester NULL.
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS unpaid_customer_name VARCHAR(120);

-- Pour les ventes deja existantes, paid_at = created_at (elles ont ete payees a la creation).
UPDATE sales SET paid_at = created_at WHERE paid_at IS NULL AND payment_status = 'paid';

-- Index pour le filtre rapide "ventes impayees" dans l'historique.
CREATE INDEX IF NOT EXISTS idx_sales_payment_status ON sales(payment_status) WHERE payment_status = 'unpaid';
