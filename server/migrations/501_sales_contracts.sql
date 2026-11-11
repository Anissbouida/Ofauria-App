-- Phase 11 (D3-37) — contrats-cadres / commandes ouvertes.
--
-- Un engagement de volume (quantité d'un article) ou de valeur (montant total)
-- sur une période, consommé par des « appels » = des commandes rattachées. On
-- suit le consommé et le restant. Additif : table neuve + colonne de lien sur
-- orders ; une commande sans contrat (le cas courant) est inchangée.

CREATE TABLE IF NOT EXISTS sales_contracts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number             text NOT NULL UNIQUE,
  customer_id        uuid NOT NULL REFERENCES customers(id),
  basis              text NOT NULL CHECK (basis IN ('quantity', 'value')),
  product_id         uuid REFERENCES products(id),      -- requis si basis='quantity'
  committed_quantity numeric(14,3),                     -- engagement de volume
  committed_value    numeric(14,2),                     -- engagement de valeur (DH)
  unit_price         numeric(12,2),                     -- prix convenu, optionnel
  start_date         date NOT NULL,
  end_date           date,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  notes              text,
  created_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_contract_commitment CHECK (
    (basis = 'quantity' AND product_id IS NOT NULL AND committed_quantity > 0)
    OR (basis = 'value' AND committed_value > 0)
  )
);

-- Appel : une commande rattachée à un contrat (tire sur l'engagement).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sales_contract_id uuid REFERENCES sales_contracts(id);
CREATE INDEX IF NOT EXISTS idx_orders_sales_contract
  ON orders (sales_contract_id) WHERE sales_contract_id IS NOT NULL;

-- Série de numérotation CTR.
INSERT INTO document_sequences (doc_type, label, module, pattern, padding, reset_period, target_table, target_column)
VALUES ('sales_contract', 'Contrat-cadre', 'sales', 'CTR-{YYYY}-{SEQ}', 4, 'year', 'sales_contracts', 'number')
ON CONFLICT (doc_type) DO NOTHING;
