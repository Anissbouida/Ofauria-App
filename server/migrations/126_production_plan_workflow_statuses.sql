-- Migration 126 : nouveaux statuts du cycle de vie du plan de production
--
-- Contexte (cf. prompt_delta_production_v1.docx, point 1) :
-- Le cycle de statuts du plan doit refleter l'avancement de la preparation
-- ingredients par le magasinier et la reception par le chef. Aujourd'hui le
-- plan reste fige a 'confirmed' pendant toute la phase BSI, ce qui empeche
-- de communiquer visuellement l'etat au chef et au magasinier.
--
-- Nouveau cycle :
--   draft -> confirmed -> awaiting_ingredients -> ready_to_produce
--         -> in_progress -> completed
--
-- Transitions auto (cote serveur) :
--   confirmed -> awaiting_ingredients : declenchee a la generation du BSI
--   awaiting_ingredients -> ready_to_produce : declenchee quand BSI passe a 'pret'
--   ready_to_produce -> awaiting_ingredients : declenchee sur chef reject
--   ready_to_produce -> in_progress : declenchee au demarrage effectif (start)
--
-- Note : on garde 'cancelled' qui a ete ajoute en migration 064.

ALTER TABLE production_plans
  DROP CONSTRAINT IF EXISTS production_plans_status_check;

ALTER TABLE production_plans
  ADD CONSTRAINT production_plans_status_check
    CHECK (status IN (
      'draft',
      'confirmed',
      'awaiting_ingredients',
      'ready_to_produce',
      'in_progress',
      'completed',
      'cancelled'
    ));
