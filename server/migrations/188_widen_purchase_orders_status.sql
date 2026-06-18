-- ═══════════════════════════════════════════════════════════════
-- 188: Élargit purchase_orders.status (VARCHAR(20) -> VARCHAR(30))
-- ═══════════════════════════════════════════════════════════════
-- Bug : la migration 055 a ajouté le statut 'en_attente_facturation'
-- (22 caractères) à la contrainte CHECK, mais la colonne status était
-- restée en VARCHAR(20) depuis la migration 033. Lors de la confirmation
-- de réception d'un BC entièrement livré mais avec des prix manquants,
-- le passage à ce statut provoquait l'erreur PostgreSQL :
--   « value too long for type character varying(20) ».
--
-- On élargit la colonne à VARCHAR(30) (marge confortable au-dessus des
-- 22 caractères du plus long statut). L'augmentation de longueur d'un
-- varchar est instantanée (pas de réécriture de table) et la contrainte
-- CHECK ainsi que le DEFAULT sont préservés.

ALTER TABLE purchase_orders ALTER COLUMN status TYPE VARCHAR(30);
