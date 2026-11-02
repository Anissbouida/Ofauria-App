-- 423 — Action corrective HACCP d'origine « procédé » (épic labo L2, partie 2)
--
-- POURQUOI
--   Un relevé de procédé hors tolérance (mig 422) doit ouvrir une action
--   corrective HACCP, comme un relevé de température d'équipement hors plage.
--   Le CHECK de source_kind (mig 315) n'autorisait que temperature / cleaning /
--   reception / other : on ajoute 'process' pour tracer l'origine « fournée ».
--
-- IDEMPOTENT : remplace le CHECK par une version qui inclut 'process'.
-- INVERSION : revenir au CHECK sans 'process' (aucune ligne 'process' ne doit
--   alors subsister).

ALTER TABLE haccp_corrective_actions
  DROP CONSTRAINT IF EXISTS haccp_corrective_actions_source_kind_check;

ALTER TABLE haccp_corrective_actions
  ADD CONSTRAINT haccp_corrective_actions_source_kind_check
  CHECK (source_kind IN ('temperature', 'cleaning', 'reception', 'process', 'other'));
