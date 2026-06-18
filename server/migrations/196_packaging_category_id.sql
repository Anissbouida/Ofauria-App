-- 196: Catégorie des consommables référencée sur le référentiel (expense_categories)
--
-- Les consommables (packaging_items) étaient catégorisés par un enum texte
-- (boites/sachets/.../produits_nettoyage...). On aligne sur le référentiel
-- unifié : ajout de category_id (FK expense_categories), comme ingredients
-- (mig 192). Le sélecteur UI devient le CategoryCascadeSelector (Catégorie >
-- Sous-catégorie > Type), racines = Emballages + Entretien & Maintenance +
-- Équipements & Matériel. La colonne `category` (enum) reste pour compat mais
-- n'est plus la source de vérité.

ALTER TABLE packaging_items
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES expense_categories(id);
CREATE INDEX IF NOT EXISTS idx_packaging_items_category_id ON packaging_items(category_id);

-- Backfill best-effort de l'ancien enum vers les feuilles du référentiel.
-- Emballages (racine 20000000-...-005) :
UPDATE packaging_items pi SET category_id = ec.id
FROM expense_categories ec
WHERE ec.parent_id = '20000000-0000-0000-0000-000000000005'
  AND pi.category_id IS NULL
  AND (
    (pi.category = 'boites'      AND ec.name = 'Boites') OR
    (pi.category = 'sachets'     AND ec.name = 'Sacs') OR
    (pi.category = 'etiquettes'  AND ec.name = 'Etiquettes') OR
    (pi.category = 'rubans'      AND ec.name = 'Ficelles & Rubans') OR
    (pi.category = 'films'       AND ec.name = 'Papier boulanger')
  );

-- Produits de nettoyage -> Entretien & Maintenance > Nettoyage > Produits d'entretien
UPDATE packaging_items pi SET category_id = ec.id
FROM expense_categories ec
WHERE ec.name = 'Produits d''entretien'
  AND pi.category = 'produits_nettoyage'
  AND pi.category_id IS NULL;

-- caissettes / supports / materiel_nettoyage / petit_materiel / autre :
-- pas de feuille évidente -> laissés NULL, à recatégoriser via l'UI.
