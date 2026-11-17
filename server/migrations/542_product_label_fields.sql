-- G2-09 (plan d'action 2026-11) — champs d'étiquette du produit.
--
-- L'étiquette réglementaire demande, en plus de la liste des ingrédients et des allergènes
-- (calculés depuis la nomenclature, services/product-label.ts), trois mentions propres au
-- produit qui n'existaient pas :
--
--   legal_name         : dénomination légale de vente (« Pain de tradition française »),
--                        distincte du nom commercial ; à défaut, le nom du produit
--   storage_conditions : conditions de conservation (« À conserver entre 0 et 4 °C »)
--   label_mentions     : mentions libres (« Décongelé, ne pas recongeler », origine…)
--
-- Les trois colonnes sont créées vides. Rien n'est rempli : le contenu obligatoire reste à
-- valider avec le référent qualité (réglementation ONSSA).
--
-- INVERSION : ALTER TABLE products DROP COLUMN IF EXISTS legal_name,
--               DROP COLUMN IF EXISTS storage_conditions, DROP COLUMN IF EXISTS label_mentions;
ALTER TABLE products ADD COLUMN IF NOT EXISTS legal_name         varchar(200);
ALTER TABLE products ADD COLUMN IF NOT EXISTS storage_conditions varchar(300);
ALTER TABLE products ADD COLUMN IF NOT EXISTS label_mentions     varchar(500);
