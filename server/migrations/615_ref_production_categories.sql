-- Catégories de production éditables dans Paramètres › Référentiel (scénario 1, constat 18).
--
-- La table recipe_categories (mig 166) classe les fiches techniques par famille de
-- production (Boulangerie, Viennoiserie, Pâtisserie…). Elle n'avait AUCUN écran ni route
-- d'écriture : seule la lecture existait (GET /recipes/categories). Sur une base remise à
-- neuf, la liste « Catégorie de production » de la fiche restait donc vide, sans moyen de
-- la remplir.
--
-- Elle devient un référentiel « natif » (comme les catégories de produits) : liste,
-- ajout, modification et suppression passent par l'adaptateur production_categories
-- (referentiel.repository.ts). Aucune donnée n'est créée ici : la configuration se fait
-- par l'écran.
--
-- INVERSION : DELETE FROM ref_tables WHERE id = 'production_categories';
INSERT INTO ref_tables (id, label, description, icon, source, native_table, editable, display_order)
VALUES ('production_categories', 'Catégories de production',
        'Familles de fabrication des fiches techniques (boulangerie, viennoiserie, pâtisserie…).',
        'Factory', 'native', 'recipe_categories', true, 25)
ON CONFLICT (id) DO NOTHING;
