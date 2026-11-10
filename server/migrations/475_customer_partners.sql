-- Migration 475 : rôles partenaires du client (phase 4.2)
--
-- Deux liens entre clients, pour les groupes et les filiales :
--   parent_customer_id : entité mère (hiérarchie de groupe).
--   payer_customer_id  : partenaire qui PAIE à la place du client (NULL = le
--                        client paie lui-même). « Une filiale commande, le
--                        siège paie » : le BL reste au nom de la filiale
--                        (livré), la facture part au payeur (facturé/payeur).
--
-- Les deux pointent vers un autre client (jamais soi-même, CHECK). Si le
-- partenaire est supprimé, le lien retombe à NULL (SET NULL) sans casser la
-- fiche. Les cycles plus profonds sont évités côté application (resolvePayer).

ALTER TABLE customers ADD COLUMN IF NOT EXISTS parent_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS payer_customer_id  UUID REFERENCES customers(id) ON DELETE SET NULL;

ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_parent_not_self;
ALTER TABLE customers ADD CONSTRAINT customers_parent_not_self CHECK (parent_customer_id IS NULL OR parent_customer_id <> id);
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_payer_not_self;
ALTER TABLE customers ADD CONSTRAINT customers_payer_not_self CHECK (payer_customer_id IS NULL OR payer_customer_id <> id);

CREATE INDEX IF NOT EXISTS idx_customers_parent ON customers(parent_customer_id) WHERE parent_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_payer ON customers(payer_customer_id) WHERE payer_customer_id IS NOT NULL;
