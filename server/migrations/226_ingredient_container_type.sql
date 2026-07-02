-- Migration 226: type de contenant sur l'ingredient
-- Chaque ingredient peut etre defini avec un type de contenant (Seau, Sac...) et une
-- quantite par contenant (container_size, deja presente depuis migration 111).
-- Objectif : raisonner par contenant a l'achat et au transfert Economat -> Pesage
-- (ex : Nappage = Seau de 5 kg ; 3 seaux = 15 kg).

ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS container_type_id uuid REFERENCES ref_entries(id);

COMMENT ON COLUMN ingredients.container_type_id IS
  'Type de contenant par defaut (ref_entries, table_id=container_types). Couple a container_size (quantite par contenant).';

COMMENT ON COLUMN ingredients.container_size IS
  'Quantite par contenant dans l unite de l ingredient (ex : 5 = Seau de 5 kg). Utilisee pour la saisie par contenant a l achat et au transfert.';
