-- Rattrapage de schéma — colonnes de `sales` absentes des migrations du dépôt.
--
-- La base déployée porte sur `sales` les colonnes `advance_amount`, `advance_date`
-- et `order_id` (ventes d'avance et de livraison liées à une commande), que
-- `sale.repository.create` écrit. Or AUCUNE migration du dépôt ne les crée : elles
-- ont été ajoutées hors du flux de migrations. Conséquence : une base reconstruite
-- uniquement depuis les migrations (CI, base de test) n'a pas ces colonnes et tout
-- checkout échoue (42703). Cette migration rattrape l'écart.
--
-- Idempotente : `ADD COLUMN IF NOT EXISTS` est un no-op sur la base déployée qui
-- possède déjà ces colonnes ; elle ne les crée que sur une base reconstruite.

ALTER TABLE sales ADD COLUMN IF NOT EXISTS advance_amount NUMERIC(10,2) DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS advance_date  TIMESTAMPTZ;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS order_id      UUID REFERENCES orders(id) ON DELETE SET NULL;
