-- G5-03 (plan d'action 2026-11) — classes ABC et inventaire tournant.
--
--   inventory.abc_class / abc_value / abc_computed_at : classe de l'article dans son
--     établissement, d'après la valeur consommée sur 12 mois (sorties usage et production
--     × coût unitaire). A = articles qui font les premiers 80 % de la valeur, B = jusqu'à
--     95 %, C = le reste (et tout article sans consommation).
--   Paramètres stock.cycle_count : parts A / B, fréquence de comptage par classe (jours),
--     nombre maximum d'articles par campagne.
--   Une campagne tournante est une campagne partielle du module Inventaires (mig 367)
--     limitée aux articles dus : jamais comptés, ou dont le dernier comptage validé est
--     plus vieux que la fréquence de leur classe.
--   Tâche cycle_counts (hebdomadaire) : recalcule les classes et ouvre la campagne
--     tournante de chaque établissement sans inventaire en cours. Créée DÉSACTIVÉE : elle
--     ouvre des campagnes sur les données réelles, le client l'active dans Paramètres ›
--     Tâches planifiées.
--
-- INVERSION :
--   DELETE FROM scheduled_jobs WHERE key = 'cycle_counts';
--   DELETE FROM module_parameters WHERE key = 'stock.cycle_count';
--   ALTER TABLE inventory DROP COLUMN abc_class, DROP COLUMN abc_value, DROP COLUMN abc_computed_at;
ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS abc_class       char(1),
  ADD COLUMN IF NOT EXISTS abc_value       numeric(14,2),
  ADD COLUMN IF NOT EXISTS abc_computed_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_inventory_abc_class') THEN
    ALTER TABLE inventory ADD CONSTRAINT chk_inventory_abc_class CHECK (abc_class IS NULL OR abc_class IN ('A', 'B', 'C'));
  END IF;
END $$;

INSERT INTO module_parameters (key, value, description)
VALUES ('stock.cycle_count', '{"a_share": 80, "b_share": 95, "a_days": 30, "b_days": 90, "c_days": 180, "max_lines": 40}'::jsonb,
        'Inventaire tournant : parts de valeur des classes A et B (%), fréquence de comptage par classe (jours), articles par campagne')
ON CONFLICT (key) DO NOTHING;

INSERT INTO scheduled_jobs (key, label, description, domain, interval_minutes, enabled, display_order)
VALUES ('cycle_counts', 'Inventaire tournant', 'Recalcule les classes ABC et ouvre chaque semaine la campagne de comptage des articles dus (A tous les mois, B tous les trimestres, C tous les semestres).', 'stock', 10080, false, 33)
ON CONFLICT (key) DO NOTHING;
