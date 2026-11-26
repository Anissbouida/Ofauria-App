-- 733 — Types de vente et types de perte selon le métier (audit de cohérence des profils).
--
-- « Du jour » (vendu le jour même) et « À date limite de vente » étaient proposés à toutes les
-- sociétés, comme les pertes « Production », « Périmé » et « Recyclage » ; un produit neuf
-- naissait « Du jour » (défaut de colonne de la mig 061), ce qui déclenchait des suggestions de
-- destruction en fin de journée. Les valeurs se rattachent désormais aux métiers qui les emploient
-- (synchronisation des référentiels sectoriels, mig 698) ; un produit neuf est « Sur stock » par
-- défaut (le code propose « Du jour » quand la capacité « DLC du jour » est active).
--
-- Rollback : remettre sectors = '{}' sur ces cinq valeurs, puis SELECT fn_ref_sync_sectors('rollback_733') ;
--   ALTER TABLE products ALTER COLUMN sale_type SET DEFAULT 'jour'.

UPDATE ref_entries SET sectors = '{agroalimentaire,restauration}'
 WHERE table_id = 'product_sale_types' AND code = 'jour' AND sectors = '{}';
UPDATE ref_entries SET sectors = '{agroalimentaire,restauration,agriculture,sante,commerce_detail,negoce,process}'
 WHERE table_id = 'product_sale_types' AND code = 'dlv' AND sectors = '{}';
UPDATE ref_entries SET sectors = '{agroalimentaire,restauration,atelier,discret,fabrication,process,textile,agriculture,generique}'
 WHERE table_id = 'loss_types' AND code = 'production' AND sectors = '{}';
UPDATE ref_entries SET sectors = '{agroalimentaire,restauration,agriculture,sante,commerce_detail,negoce,process,generique}'
 WHERE table_id = 'loss_types' AND code = 'perime' AND sectors = '{}';
UPDATE ref_entries SET sectors = '{agroalimentaire,restauration}'
 WHERE table_id = 'loss_types' AND code = 'recyclage' AND sectors = '{}';

ALTER TABLE products ALTER COLUMN sale_type SET DEFAULT 'stock';

SELECT fn_ref_sync_sectors('migration_733');
