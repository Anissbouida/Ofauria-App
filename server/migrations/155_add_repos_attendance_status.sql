-- Migration 155 : ajoute le statut 'repos' au pointage (jour de repos hebdomadaire paye).
--
-- Contexte : la boulangerie tourne 7j/7 (boulangers de nuit, vendeuses le matin,
-- patissiers en journee). Chaque employe a un jour de repos hebdomadaire,
-- different selon le poste. Au Maroc, ce jour de repos est paye (inclus dans
-- le salaire mensuel) — d'ou la necessite de le tracer distinctement de
-- 'absent' (qui lui n'est pas paye) pour la lecture des rapports et la paie.
--
-- Impact paie : 'repos' compte comme un jour travaille (cf. weekly-payroll
-- et payroll mensuel) — voir code applicatif.

ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_status_check;
ALTER TABLE attendance ADD CONSTRAINT attendance_status_check
  CHECK (status IN ('present', 'absent', 'late', 'half_day', 'repos'));
