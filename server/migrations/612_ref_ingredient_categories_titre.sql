-- Première configuration (scénario 0) — titre du référentiel des catégories d'ingrédients.
--
-- Le titre livré par la migration 072 était « Categories ingredients » : sans accents, et dans
-- un vocabulaire que les utilisateurs d'ERP ne reconnaissent pas. Le terme du marché est
-- « famille d'articles » (Sage), « catégorie d'articles » (Odoo), « groupe d'articles » (SAP).
-- Les emballages ayant leur propre table (packaging_categories), le titre précise la nature :
-- « Familles de matières premières ».
--
-- Seul le titre affiché dans Paramètres › Référentiel change. L'identifiant technique
-- (ingredient_categories), les entrées et leurs codes ne sont pas touchés.
-- La condition sur l'ancien titre laisse intact un titre déjà personnalisé par un client.
--
-- INVERSION :
--   UPDATE ref_tables SET label = 'Categories ingredients'
--    WHERE id = 'ingredient_categories' AND label = 'Familles de matières premières';
UPDATE ref_tables
   SET label = 'Familles de matières premières'
 WHERE id = 'ingredient_categories'
   AND label = 'Categories ingredients';
