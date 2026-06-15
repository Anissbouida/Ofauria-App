-- Migration 164 : Re-stamp du checksum de 115_seed_recipes_croissante_baguettes.sql
--
-- Probleme : la migration 115 a ete modifiee localement pour :
--   1. Fix 'L' (uppercase) -> 'l' (lowercase) sur l'unite de l'eau, qui violait
--      ingredients_unit_check (debloque la chaine 115->163 sur les fresh installs).
--   2. Idempotence via ON CONFLICT et DELETE prealable des recipe_ingredients,
--      pour que la migration soit re-runnable sans planter sur les envs ou les
--      donnees seed existent deja.
--
-- Sur les envs ou 115 a ete appliquee AVANT cette modification, le checksum
-- stocke dans _migrations ne matche plus le contenu actuel du fichier ->
-- migrate.ts considere la migration "modifiee apres application" (OWASP A08-1)
-- et exit avec le code 2 -> bloque le deploy Cloud Run.
--
-- Solution : on remet a jour le checksum stocke pour refleter le contenu actuel.
-- Le contenu de 115 n'est PAS re-execute (deja applique), seul son fingerprint
-- est synchronise. Sur les fresh installs ou 115 vient d'etre executee avec le
-- nouveau contenu, l'UPDATE est un no-op (checksum deja correct).
--
-- SHA-256 du contenu actuel de 115 :
--   77fb0fe6b3e3779269130889b0b1366559b26d1894b22213e0f2f42bc0303378

UPDATE _migrations
   SET checksum = '77fb0fe6b3e3779269130889b0b1366559b26d1894b22213e0f2f42bc0303378'
 WHERE name = '115_seed_recipes_croissante_baguettes.sql';
