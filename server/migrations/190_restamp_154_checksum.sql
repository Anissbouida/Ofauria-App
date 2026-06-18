-- Migration 190 : Re-stamp du checksum de 154_payment_cashed_status.sql
--
-- Probleme : sur cet environnement, le checksum stocke dans _migrations pour la
-- migration 154 est un placeholder ('00') qui ne correspond pas au contenu
-- actuel du fichier. migrate.ts considere alors la migration "modifiee apres
-- application" (OWASP A08-1) et sort en code 2 -> bloque tout pipeline qui se
-- fie au code de sortie de la commande migrate.
--
-- Le contenu de 154 sur disque est identique a la version committee (HEAD) : il
-- s'agit donc d'un fingerprint obsolete, pas d'une alteration. On synchronise le
-- checksum stocke sur le contenu actuel. 154 n'est PAS re-execute (deja
-- applique), seul son empreinte est mise a jour. Sur les envs ou le checksum est
-- deja correct (ou 154 absente), l'UPDATE est un no-op.
--
-- Meme pattern que la migration 164 (re-stamp de 115).
--
-- SHA-256 du contenu actuel de 154 :
--   f41c0302d1b33a4b017697cabbcc08480f8bfe3bc036464912400c6fc2d7335a

UPDATE _migrations
   SET checksum = 'f41c0302d1b33a4b017697cabbcc08480f8bfe3bc036464912400c6fc2d7335a'
 WHERE name = '154_payment_cashed_status.sql';
