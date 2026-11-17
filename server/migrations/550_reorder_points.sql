-- G5-02 (plan d'action 2026-11) — point de commande et stock de sécurité.
--
-- Le seuil d'alerte existant (inventory.minimum_threshold, par article et par
-- établissement) EST le point de commande : c'est lui que lisent les alertes de stock
-- et la liste « À commander ». On lui adjoint :
--   safety_stock      : stock de sécurité ;
--   max_stock         : niveau à atteindre quand on commande (NULL = deux fois le point
--                       de commande, la règle actuelle de « À commander ») ;
--   replenish_mode    : manuel (défaut, les valeurs saisies font foi) | calcule (le
--                       recalcul hebdomadaire les met à jour) ;
--   avg_daily_usage, proposed_reorder_point, proposed_safety_stock, proposed_at :
--                       dernier calcul ; pour un article en mode manuel, c'est une
--                       proposition à valider, jamais appliquée d'office.
-- Calcul : consommation moyenne journalière sur N jours × délai du fournisseur préféré
-- (supplier_items.lead_time_days, mig 404 ; défaut paramétrable) + stock de sécurité
-- (en mode calculé : consommation moyenne × nombre de jours de sécurité).
-- Paramètres : stock.replenishment {usage_days, default_lead_days, safety_days}.
-- Tâche planifiée : reorder_points, hebdomadaire.
--
-- INVERSION :
--   DELETE FROM scheduled_jobs WHERE key = 'reorder_points';
--   DELETE FROM module_parameters WHERE key = 'stock.replenishment';
--   ALTER TABLE inventory DROP COLUMN safety_stock, DROP COLUMN max_stock, DROP COLUMN replenish_mode,
--     DROP COLUMN avg_daily_usage, DROP COLUMN proposed_reorder_point, DROP COLUMN proposed_safety_stock,
--     DROP COLUMN proposed_at;
ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS safety_stock            numeric(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_stock               numeric(12,4),
  ADD COLUMN IF NOT EXISTS replenish_mode          varchar(10)   NOT NULL DEFAULT 'manuel',
  ADD COLUMN IF NOT EXISTS avg_daily_usage         numeric(12,4),
  ADD COLUMN IF NOT EXISTS proposed_reorder_point  numeric(12,4),
  ADD COLUMN IF NOT EXISTS proposed_safety_stock   numeric(12,4),
  ADD COLUMN IF NOT EXISTS proposed_at             timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_inventory_replenish_mode') THEN
    ALTER TABLE inventory ADD CONSTRAINT chk_inventory_replenish_mode CHECK (replenish_mode IN ('manuel', 'calcule'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_inventory_stock_levels') THEN
    ALTER TABLE inventory ADD CONSTRAINT chk_inventory_stock_levels
      CHECK (safety_stock >= 0 AND (max_stock IS NULL OR max_stock >= minimum_threshold));
  END IF;
END $$;

INSERT INTO module_parameters (key, value, description)
VALUES ('stock.replenishment', '{"usage_days": 56, "default_lead_days": 2, "safety_days": 1}'::jsonb,
        'Point de commande : jours de consommation pris en compte, délai fournisseur par défaut, jours de stock de sécurité')
ON CONFLICT (key) DO NOTHING;

INSERT INTO scheduled_jobs (key, label, description, domain, interval_minutes, display_order)
VALUES ('reorder_points', 'Points de commande', 'Recalcule chaque semaine consommation moyenne, stock de sécurité et point de commande : appliqués aux articles en mode calculé, proposés pour les autres.', 'stock', 10080, 32)
ON CONFLICT (key) DO NOTHING;
