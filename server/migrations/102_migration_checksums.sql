-- OWASP A08-1 : stocker le SHA-256 du contenu de chaque migration appliquee.
-- Permet de detecter si un fichier SQL a ete modifie apres son application
-- (rollback partiel, compromise supply chain, etc.).

ALTER TABLE _migrations
  ADD COLUMN IF NOT EXISTS checksum CHAR(64);
