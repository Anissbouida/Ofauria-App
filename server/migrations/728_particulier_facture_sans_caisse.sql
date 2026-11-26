-- 728 — Particulier facturé pour les profils sans caisse (audit de cohérence des profils, lot L2).
--
-- Le type de client « Particulier » (réglé au comptoir) suppose une caisse : l'avance et le solde
-- d'une commande s'encaissent dans une session. Les profils sans module Point de vente qui le
-- proposaient encore (e-commerce, agriculture, textile) prennent le « Particulier (facturé) »
-- comme le BTP, les services, le transport et la fabrication (mig 701) : commande livrée sur bon
-- de livraison et facturée. Le contrôleur des commandes refuse de toute façon un client réglé au
-- comptoir quand la société n'a pas de caisse.
--
-- Rollback : retirer ecommerce, agriculture, textile de excluded_sectors (particulier) et de
--   sectors (client_prive), puis SELECT fn_ref_sync_sectors('rollback_728').

UPDATE ref_entries
   SET excluded_sectors = (SELECT array_agg(DISTINCT s ORDER BY s) FROM unnest(excluded_sectors || '{ecommerce,agriculture,textile}'::text[]) s)
 WHERE table_id = 'customer_types' AND code = 'particulier';

UPDATE ref_entries
   SET sectors = (SELECT array_agg(DISTINCT s ORDER BY s) FROM unnest(sectors || '{ecommerce,agriculture,textile}'::text[]) s)
 WHERE table_id = 'customer_types' AND code = 'client_prive';

SELECT fn_ref_sync_sectors('migration_728');
