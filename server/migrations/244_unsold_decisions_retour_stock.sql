-- Migration 244 : etendre les CHECK unsold_decisions a 'retour_stock'.
--
-- Contexte : computeSuggestion (unsold-decision.repository.ts) suggere depuis
-- longtemps 'retour_stock' pour les produits DLV encore valides mais non
-- reexposables (retour reserve). Le POS propose le bouton, la caissiere
-- l'utilise, et l'INSERT viole les CHECK de la mig 062 (qui n'acceptent que
-- reexpose/recycle/waste). Consequence : rollback de tout le batch, fermeture
-- de caisse bloquee des qu'un tel produit apparait.
--
-- Fix : ajouter 'retour_stock' dans les deux CHECK (suggested_destination +
-- final_destination). Pattern DROP IF EXISTS + ADD pour etre idempotent
-- (les CHECK ont des noms auto-generes, on les recree explicitement nommes
-- pour rendre la contrainte facilement gerable).

BEGIN;

-- Nom auto-genere par PG lorsque la contrainte a ete cree sans nom explicite.
-- On tente d'abord de dropper le nom conventionnel, puis on introspecte via
-- DO $$ si le drop echoue (setups avec des noms auto differents).
ALTER TABLE unsold_decisions
  DROP CONSTRAINT IF EXISTS unsold_decisions_suggested_destination_check;
ALTER TABLE unsold_decisions
  DROP CONSTRAINT IF EXISTS unsold_decisions_final_destination_check;

-- Fallback : introspection au cas ou les CHECK auraient un nom different.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'unsold_decisions'::regclass
      AND contype = 'c'
      AND (
        pg_get_constraintdef(oid) ILIKE '%suggested_destination%'
        OR pg_get_constraintdef(oid) ILIKE '%final_destination%'
      )
  LOOP
    EXECUTE 'ALTER TABLE unsold_decisions DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END $$;

ALTER TABLE unsold_decisions
  ADD CONSTRAINT unsold_decisions_suggested_destination_check
  CHECK (suggested_destination IN ('reexpose', 'recycle', 'waste', 'retour_stock'));

ALTER TABLE unsold_decisions
  ADD CONSTRAINT unsold_decisions_final_destination_check
  CHECK (final_destination IN ('reexpose', 'recycle', 'waste', 'retour_stock'));

COMMIT;
