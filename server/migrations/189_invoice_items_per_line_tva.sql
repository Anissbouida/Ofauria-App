-- ═══════════════════════════════════════════════════════════════
-- 189: TVA par ligne sur invoice_items
-- ═══════════════════════════════════════════════════════════════
-- Jusqu'ici la TVA etait stockee uniquement au niveau de l'en-tete de
-- facture (invoices.tax_amount), avec un seul taux deduit du HT/TTC. Or
-- une facture peut melanger des articles a taux differents (au Maroc :
-- 0 / 7 / 10 / 14 / 20 %). On porte donc la TVA au niveau de la ligne.
--
-- Modele :
--   - tva_rate   : taux en pourcentage applique a la ligne (ex: 20.00).
--                  NULL = la ligne n'a pas de TVA explicite -> la facture
--                  retombe sur la TVA globale d'en-tete (retrocompat des
--                  factures saisies en HT/TVA/TTC sans detail de lignes).
--   - tva_amount : montant TVA de la ligne = round(subtotal * tva_rate/100).
--                  Stocke pour eviter tout drift d'arrondi a l'affichage et
--                  dans la generation des ecritures.
--
-- Retrocompat : les lignes existantes restent a NULL. La facture conserve
-- son tax_amount d'en-tete tel quel (totaux et ecritures historiques
-- inchanges). Seules les factures (re)editees avec un taux par ligne
-- basculent sur le calcul "somme des TVA lignes".

ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS tva_rate   DECIMAL(5,2);
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS tva_amount DECIMAL(12,2);

-- Garde-fou : un taux negatif ou > 100 % n'a aucun sens.
ALTER TABLE invoice_items DROP CONSTRAINT IF EXISTS chk_invoice_items_tva_rate;
ALTER TABLE invoice_items ADD CONSTRAINT chk_invoice_items_tva_rate
  CHECK (tva_rate IS NULL OR (tva_rate >= 0 AND tva_rate <= 100));
