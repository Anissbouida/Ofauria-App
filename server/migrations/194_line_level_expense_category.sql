-- 194: Catégorie par ligne de charge (et non plus par facture)
--
-- Problème : dans Charges & Dépenses, chaque ligne d'une facture reçue / bon
-- de commande affichait UNE seule catégorie partagée (invoices.category_id).
-- Catégoriser une ligne modifiait toutes les lignes de la même facture/BC.
--
-- Correctif : on stocke la catégorie au niveau de la LIGNE (invoice_items et
-- reception_voucher_items). La catégorie effective devient
--   COALESCE(ligne.category_id, facture.category_id)
-- ce qui laisse l'ancien comportement (catégorie facture) en repli tant
-- qu'aucune catégorie de ligne n'a été choisie.

ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES expense_categories(id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_category_id ON invoice_items(category_id);

ALTER TABLE reception_voucher_items
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES expense_categories(id);
CREATE INDEX IF NOT EXISTS idx_rvi_category_id ON reception_voucher_items(category_id);
