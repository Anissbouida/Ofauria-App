-- G1-08 (plan d'action 2026-11) — charges constatées d'avance, tâche planifiée.
--
-- La constatation mensuelle (débit 6x / crédit 486) ne passait que par le bouton de
-- l'onglet « Charges constatées d'avance ». La tâche `prepaid_recognition`
-- (services/scheduler.ts) constate chaque jour les mois échus non encore constatés,
-- jusqu'au mois écoulé. Idempotente : une constatation par charge et par mois
-- (contrainte d'unicité de prepaid_charge_recognitions).
--
-- DÉSACTIVÉE à la livraison : elle passe des écritures comptables. À activer dans
-- Paramètres › Tâches planifiées.
--
-- INVERSION : DELETE FROM scheduled_jobs WHERE key = 'prepaid_recognition';
INSERT INTO scheduled_jobs (key, label, description, domain, enabled, interval_minutes, display_order) VALUES
  ('prepaid_recognition',
   'Charges constatées d''avance',
   'Constate les mois échus des charges constatées d''avance, jusqu''au mois écoulé (une constatation par charge et par mois).',
   'accounting', false, 1440, 61)
ON CONFLICT (key) DO NOTHING;
