-- Migration 124 : retire le PIN de pointage et prepare l'integration empreinte
--
-- Contexte : la migration 123 avait introduit un PIN bcrypt sur employees pour
-- une badgeuse self-service web. Ce besoin est abandonne au profit d'une vraie
-- pointeuse a empreinte digitale (hardware), qui ecrira directement dans la
-- table attendance via son SDK.
--
-- Ce que la pointeuse empreinte aura besoin :
--   - attendance.check_in / check_out          (deja existants)
--   - attendance.check_in_method = 'fingerprint'  (ajout dans CHECK constraint)
--   - attendance.check_in_terminal = '<id appareil>'  (deja existant)
--
-- On garde donc toute l'infra de tracabilite ajoutee par 123. On retire juste
-- la colonne pin_code (specifique au PIN) et on autorise la valeur
-- 'fingerprint' dans la contrainte CHECK.

BEGIN;

-- ─── 1. Supprimer le PIN code (donnees test eventuelles incluses) ───
ALTER TABLE employees
  DROP COLUMN IF EXISTS pin_code;

-- ─── 2. Permettre la valeur 'fingerprint' dans check_in_method / check_out_method ───
ALTER TABLE attendance
  DROP CONSTRAINT IF EXISTS attendance_check_in_method_check,
  DROP CONSTRAINT IF EXISTS attendance_check_out_method_check;

ALTER TABLE attendance
  ADD CONSTRAINT attendance_check_in_method_check
    CHECK (check_in_method IN ('manual', 'pin', 'badge', 'fingerprint') OR check_in_method IS NULL),
  ADD CONSTRAINT attendance_check_out_method_check
    CHECK (check_out_method IN ('manual', 'pin', 'badge', 'fingerprint') OR check_out_method IS NULL);

-- Note : on conserve 'pin' dans le CHECK pour ne pas casser d'eventuels enregistrements
-- de test deja ecrits par la badgeuse retiree. On nettoiera plus tard si besoin.

COMMIT;
