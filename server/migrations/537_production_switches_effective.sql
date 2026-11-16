-- G1-05 (plan d'action 2026-11) — interrupteurs de production rendus effectifs.
--
-- production_steps_enabled, production_yield_enabled et production_cost_enabled étaient
-- enregistrés mais lus nulle part : ils valaient « désactivé » (valeur par défaut) alors
-- que les étapes, le rendement et le coût de revient sont utilisés tous les jours.
--
-- À partir de cette livraison le code les lit (panneaux masqués, saisies refusées). Pour
-- ne rien éteindre, ils sont d'abord alignés sur la réalité : ACTIVÉS. Le gérant pourra
-- ensuite en couper un depuis Production › Paramétrage, et la coupure aura un effet.
--
-- production_frigo_enabled et production_calcul_inverse_enabled ne figurent sur aucun
-- écran et ne sont pas branchés : ces fonctions dépendent des options de secteur
-- (mig 507). Leurs colonnes restent, sans effet.
--
-- INVERSION : remettre les valeurs par défaut à false ; les valeurs d'avant étaient false.
ALTER TABLE company_settings ALTER COLUMN production_steps_enabled SET DEFAULT true;
ALTER TABLE company_settings ALTER COLUMN production_yield_enabled SET DEFAULT true;
ALTER TABLE company_settings ALTER COLUMN production_cost_enabled  SET DEFAULT true;

UPDATE company_settings
   SET production_steps_enabled = true, production_yield_enabled = true, production_cost_enabled = true
 WHERE id = 1;
