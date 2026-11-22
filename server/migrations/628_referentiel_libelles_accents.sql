-- 628 — Référentiel : accents rétablis dans les libellés et descriptions des tables.
--
-- POURQUOI
--   Les tables du référentiel créées par les premières migrations (058, 059 et suivantes)
--   ont des libellés sans accents (« Categories de depenses », « Unites de mesure »…),
--   affichés tels quels dans Paramètres › Référentiel. Constat du contrôle des Paramètres
--   (audit UX/UI 2026-11, § 10.3).
--
-- CE QUI CHANGE
--   Texte seulement (ref_tables.label, ref_tables.description), table par table. Chaque
--   UPDATE ne touche la ligne que si le texte est encore celui d'origine : un libellé
--   renommé par l'utilisateur est laissé tel quel. Aucun identifiant, aucune donnée métier.
--
-- INVERSION : rejouer les UPDATE en échangeant valeur d'origine et valeur corrigée.

UPDATE ref_tables SET label = 'Motifs d''absence' WHERE id = 'absence_reasons' AND label = 'Motifs d absence';
UPDATE ref_tables SET description = 'Maladie, congé, formation…' WHERE id = 'absence_reasons' AND description = 'Maladie, conge, formation...';

UPDATE ref_tables SET description = 'Sac, carton, poche, bloc, boîte… ouverts au transfert vers le pesage'
  WHERE id = 'container_types' AND description = 'Sac, carton, poche, bloc, boite... ouverts au transfert vers le pesage';

UPDATE ref_tables SET description = 'CDI, CDD, stage, intérim…' WHERE id = 'contract_types' AND description = 'CDI, CDD, Stage, Interim...';

UPDATE ref_tables SET label = 'Fonctions des employés' WHERE id = 'employee_roles' AND label = 'Fonctions des employes';
UPDATE ref_tables SET description = 'Boulanger, pâtissier, vendeuse, caissier…' WHERE id = 'employee_roles' AND description = 'Boulanger, Patissier, Vendeuse, Caissier...';

UPDATE ref_tables SET label = 'Catégories de dépenses' WHERE id = 'expense_categories' AND label = 'Categories de depenses';
UPDATE ref_tables SET description = 'Hiérarchie à 3 niveaux : catégorie, sous-catégorie, type'
  WHERE id = 'expense_categories' AND description = 'Hierarchie 3 niveaux : categorie, sous-categorie, type';

UPDATE ref_tables SET label = 'Catégories de revenus' WHERE id = 'revenue_categories' AND label = 'Categories de revenus';
UPDATE ref_tables SET description = 'Hiérarchie à 3 niveaux : catégorie, sous-catégorie, type'
  WHERE id = 'revenue_categories' AND description = 'Hierarchie 3 niveaux : categorie, sous-categorie, type';

UPDATE ref_tables SET label = 'Types de congé' WHERE id = 'leave_types' AND label = 'Types de conge';
UPDATE ref_tables SET description = 'Congé annuel, maladie, sans solde…' WHERE id = 'leave_types' AND description = 'Conge annuel, maladie, sans solde...';

UPDATE ref_tables SET description = 'Farines, sucres, produits laitiers…' WHERE id = 'ingredient_categories' AND description = 'Farines, sucres, produits laitiers...';

UPDATE ref_tables SET description = 'Invendu, casse, périmé…' WHERE id = 'loss_reasons' AND description = 'Invendu, casse, perime...';
UPDATE ref_tables SET description = 'Production, vitrine, périmé, recyclage…' WHERE id = 'loss_types' AND description = 'Production, vitrine, perime, recyclage...';

UPDATE ref_tables SET label = 'Catégories d''emballages' WHERE id = 'packaging_categories' AND label = 'Categories emballages';
UPDATE ref_tables SET description = 'Boîtes, sacs, étiquettes, papier boulanger, ficelles et rubans…'
  WHERE id = 'packaging_categories' AND description = 'Boites, sacs, etiquettes, papier boulanger, ficelles & rubans...';

UPDATE ref_tables SET description = 'Espèces, carte, virement, chèque…' WHERE id = 'payment_methods' AND description = 'Especes, carte, virement, cheque...';

UPDATE ref_tables SET label = 'Catégories de produits' WHERE id = 'product_categories' AND label = 'Categories de produits';

UPDATE ref_tables SET description = 'Brûlé, raté, machine, erreur humaine…' WHERE id = 'production_loss_reasons' AND description = 'Brule, rate, machine, erreur humaine...';

UPDATE ref_tables SET label = 'Types de découpe' WHERE id = 'type_decoupe' AND label = 'Types de decoupe';
UPDATE ref_tables SET description = 'Méthodes de découpe pour les cadres et plaques de production'
  WHERE id = 'type_decoupe' AND description = 'Methodes de decoupe pour les cadres/plaques de production';

UPDATE ref_tables SET label = 'Unités de mesure' WHERE id = 'units' AND label = 'Unites de mesure';
UPDATE ref_tables SET description = 'Gramme, kilogramme, litre, pièce…' WHERE id = 'units' AND description = 'Gramme, kilogramme, litre, piece...';

UPDATE ref_tables SET description = 'Vitrine J+1, recycler, détruire…' WHERE id = 'unsold_destinations' AND description = 'Vitrine J+1, recycler, detruire...';

UPDATE ref_tables SET label = 'Unités de rendement' WHERE id = 'yield_units' AND label = 'Unites de rendement';
UPDATE ref_tables SET description = 'Unités de mesure pour le rendement des recettes'
  WHERE id = 'yield_units' AND description = 'Unites de mesure pour le rendement des recettes';
