-- 375 — Familles de catégories pour la caisse.
--
-- Les catégories de vente n'avaient aucun regroupement : la caisse les affichait en vrac.
-- `family` (texte libre, modifiable dans Paramètres › Catégories) regroupe les catégories
-- par appartenance : la caisse montre d'abord les familles, puis les catégories de la
-- famille choisie. Sans famille, une catégorie reste visible sous « Autres ».
--
-- Reprise des données existantes par nom (sans effet sur une autre entreprise dont les
-- noms ne correspondent pas) ; l'admin peut tout réaffecter ensuite.
--
-- Rollback : ALTER TABLE categories DROP COLUMN family ;

ALTER TABLE categories ADD COLUMN IF NOT EXISTS family VARCHAR(60);
COMMENT ON COLUMN categories.family IS 'Famille d''appartenance (Boulangerie, Pâtisserie, Salé…), regroupement en caisse (mig 375).';

UPDATE categories SET family = 'Boulangerie'
 WHERE family IS NULL AND (name ILIKE 'BAGUETTE%' OR name ILIKE 'PAIN %' OR name ILIKE 'BELDI%');
UPDATE categories SET family = 'Viennoiserie'
 WHERE family IS NULL AND name ILIKE 'VIENNOISERIE%';
UPDATE categories SET family = 'Pâtisserie'
 WHERE family IS NULL AND (name ILIKE 'ENTREMET%' OR name ILIKE 'PÂTISSERIE%' OR name ILIKE 'PATISSERIE%' OR name ILIKE 'MACARON%'
        OR name ILIKE 'PIÈCES & PORTIONS%' OR name ILIKE 'GÂTEAUX%' OR name ILIKE 'GATEAUX%' OR name ILIKE 'CAKE%');
UPDATE categories SET family = 'Salé'
 WHERE family IS NULL AND (name ILIKE 'SALÉ%' OR name ILIKE 'SALE%' OR name ILIKE 'PLATEAU%');
UPDATE categories SET family = 'Emballages'
 WHERE family IS NULL AND (name ILIKE 'LES BOÎTES%' OR name ILIKE 'LES BOITES%' OR name ILIKE 'SACHET%');
