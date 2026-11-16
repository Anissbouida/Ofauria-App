-- G1-07 (plan d'action 2026-11) — dotations aux amortissements, tâche planifiée.
--
-- Les dotations ne passaient que par le bouton « Générer les dotations » : un mois
-- oublié restait sans dotation. La tâche `depreciation_monthly` (services/scheduler.ts)
-- comptabilise chaque jour les dotations manquantes de l'exercice en cours, jusqu'au mois
-- écoulé. Idempotente : une dotation par immobilisation et par mois (depreciation_entries).
--
-- DÉSACTIVÉE à la livraison : elle passe des écritures comptables. Le gérant l'active
-- dans Paramètres › Tâches planifiées quand le plan d'amortissement est validé (G0-15).
--
-- INVERSION : DELETE FROM scheduled_jobs WHERE key = 'depreciation_monthly';
INSERT INTO scheduled_jobs (key, label, description, domain, enabled, interval_minutes, display_order) VALUES
  ('depreciation_monthly',
   'Dotations aux amortissements',
   'Comptabilise les dotations manquantes de l''exercice jusqu''au mois écoulé (une par immobilisation et par mois).',
   'accounting', false, 1440, 60)
ON CONFLICT (key) DO NOTHING;
