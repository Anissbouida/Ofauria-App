-- 731 — Vocabulaire : replis neutres, termes de boulangerie portés par les profils qui les
-- emploient (audit de cohérence des profils, lot L6).
--
-- Quand un profil ne fixait pas un terme, l'application affichait le terme historique de la
-- boulangerie : « Ingrédient », « Fournée », « Pesage », « Économat », « Bon de sortie
-- ingrédients »… pour une entreprise de BTP, de transport ou de services. Les replis du code
-- (shared/src/constants/vocabulary.ts) deviennent neutres (Article, Lot de fabrication, Zone de
-- préparation, Réserve, Nomenclature…). Les termes historiques sont d'abord inscrits dans les
-- profils qui les emploient, sans écraser un terme déjà posé : Ofauria (boulangerie) garde
-- exactement son vocabulaire ; restauration et agroalimentaire gardent recettes et ingrédients.
--
-- Rollback : DELETE FROM sector_labels des lignes ajoutées ci-dessous (repérables par leur
--   valeur) et remettre les replis dans vocabulary.ts.

INSERT INTO sector_labels (sector_pack, label_key, label_value)
SELECT 'boulangerie', v.k, v.l FROM (VALUES
  ('batch', 'Fournée'), ('batch_cost', 'Coût fournée'),
  ('finished_products_tab', 'Recettes produits finis'),
  ('base_prep', 'Préparation de base'), ('base_preps', 'Préparations de base'),
  ('search_recipes', 'Rechercher une recette ou un produit...'),
  ('search_base_preps', 'Rechercher une préparation de base...'),
  ('ingredient', 'Ingrédient'), ('ingredients', 'Ingrédients'),
  ('weighing_zone', 'Pesage'), ('reserve_zone', 'Économat'),
  ('doc_bon_sortie', 'Bon de sortie ingrédients')
) AS v(k, l)
WHERE EXISTS (SELECT 1 FROM sector_packs WHERE code = 'boulangerie')
ON CONFLICT DO NOTHING;

INSERT INTO sector_labels (sector_pack, label_key, label_value)
SELECT p.code, v.k, v.l
  FROM sector_packs p
 CROSS JOIN (VALUES
  ('recipe', 'Recette'), ('recipes', 'Recettes'),
  ('finished_products_tab', 'Recettes produits finis'),
  ('base_prep', 'Préparation de base'), ('base_preps', 'Préparations de base'),
  ('search_recipes', 'Rechercher une recette ou un produit...'),
  ('search_base_preps', 'Rechercher une préparation de base...'),
  ('ingredient', 'Ingrédient'), ('ingredients', 'Ingrédients')
 ) AS v(k, l)
 WHERE p.code IN ('restauration', 'agroalimentaire', 'agro_conditionne')
ON CONFLICT DO NOTHING;
