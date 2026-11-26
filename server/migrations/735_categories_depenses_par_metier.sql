-- 735 — Catégories de dépenses de caisse selon le métier (audit de cohérence des profils).
--
-- « Matériel POS & Caisse » et « Tickets restaurant » étaient proposées à toutes les sociétés.
-- Elles se rattachent aux métiers concernés (synchronisation sectorielle, mig 698-699 : une
-- catégorie utilisée reste active) ; « Informatique & POS » devient « Informatique & logiciels »
-- (libellé d'origine seulement : un nom choisi par la société est gardé).
--
-- Rollback : remettre sectors = '{}' sur ces deux catégories, renommer « Informatique & logiciels »
--   en « Informatique & POS », puis SELECT fn_ref_sync_sectors('rollback_735').

UPDATE expense_categories SET sectors = '{boulangerie,restauration,commerce_detail,negoce,sante,agroalimentaire,agro_conditionne,atelier,discret,fabrication,process,generique}'
 WHERE name = 'Matériel POS & Caisse' AND sectors = '{}';
UPDATE expense_categories SET sectors = '{agroalimentaire,restauration,commerce_detail}'
 WHERE name = 'Tickets restaurant' AND sectors = '{}';
UPDATE expense_categories SET name = 'Informatique & logiciels'
 WHERE name = 'Informatique & POS';

SELECT fn_ref_sync_sectors('migration_735');
