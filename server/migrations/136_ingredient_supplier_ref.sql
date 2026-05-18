-- Ajoute le code article fournisseur + lien typé vers suppliers.
-- Le champ texte legacy `supplier` reste pour rétrocompat.
-- L'unicité (supplier_id, supplier_reference) empêche les doublons d'import.

ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS supplier_reference VARCHAR(50);
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ingredients_supplier_ref
  ON ingredients (supplier_id, supplier_reference)
  WHERE supplier_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ingredients_supplier_id
  ON ingredients (supplier_id)
  WHERE supplier_id IS NOT NULL;
