-- 195: Élargit packaging_items aux consommables non-alimentaires
--
-- packaging_items ne servait qu'aux emballages. On le generalise pour couvrir
-- tous les consommables non-alimentaires de l'Economat (memes besoins : stock
-- simple, prix, fournisseur, PAS de lots/DLC) :
--   - produits_nettoyage  (detergents, desinfectants...)
--   - materiel_nettoyage  (balais, eponges, chiffons...)
--   - petit_materiel      (poches a douille, moules jetables, gants...)
--
-- On etend simplement la contrainte CHECK de la colonne category (aucune
-- nouvelle table). L'ajout d'une famille future = une valeur de plus ici.
-- Le regroupement en "familles" (Emballages / Nettoyage / Petit materiel /
-- Autres) est fait cote frontend, pas besoin de hierarchie en base.

ALTER TABLE packaging_items DROP CONSTRAINT IF EXISTS packaging_items_category_check;
ALTER TABLE packaging_items ADD CONSTRAINT packaging_items_category_check
  CHECK (category IN (
    'caissettes','boites','sachets','films','etiquettes','rubans','supports',
    'produits_nettoyage','materiel_nettoyage','petit_materiel',
    'autre'
  ));
