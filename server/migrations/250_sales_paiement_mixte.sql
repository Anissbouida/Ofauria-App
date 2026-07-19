-- Migration 250 : paiement mixte (especes + carte) sur les ventes POS.
--
-- Une vente peut etre reglee partiellement en especes et partiellement en
-- carte (payment_method = 'mixed'). La ventilation est stockee dans deux
-- colonnes dediees : cash_amount + card_amount = total. Les ventes mono-mode
-- gardent ces colonnes a NULL (le montant est implicite via payment_method).
--
-- Le CHECK fige sur sales.payment_method a ete supprime en mig 176 : le
-- referentiel payment_methods (mig 058) est la source de verite, on y ajoute
-- simplement l'entree 'mixed'.

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS cash_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS card_amount NUMERIC(12, 2);

-- Coherence : pour une vente mixte les deux parts sont renseignees, positives,
-- et leur somme vaut le total (tolerance centime pour les arrondis).
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_mixed_amounts_check;
ALTER TABLE sales ADD CONSTRAINT sales_mixed_amounts_check CHECK (
  payment_method <> 'mixed'
  OR (
    cash_amount IS NOT NULL AND card_amount IS NOT NULL
    AND cash_amount >= 0 AND card_amount >= 0
    AND ABS((cash_amount + card_amount) - total) < 0.01
  )
);

INSERT INTO ref_entries (table_id, code, label, description, color, display_order)
VALUES ('payment_methods', 'mixed', 'Mixte', 'Especes + carte sur la meme vente', '#0ea5e9', 8)
ON CONFLICT (table_id, code) DO NOTHING;
