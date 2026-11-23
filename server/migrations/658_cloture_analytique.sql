-- ═══════════════════════════════════════════════════════════════════════
-- 658 — Clôture analytique mensuelle (lot C)
-- ═══════════════════════════════════════════════════════════════════════
-- POURQUOI
--   Un coût de revient publié changeait à chaque modification du paramétrage (une charge,
--   une capacité, une affectation) : les marges d'un mois passé n'étaient pas stables.
--
-- QUOI
--   1. analytic_periods : un mois d'un établissement, ouvert ou clôturé. À la clôture,
--      tous les plans du mois sont recalculés puis le modèle du mois (centres, taux,
--      activité, écarts) est figé dans snapshot. Tant que le mois reste clôturé, le
--      calcul d'un plan de ce mois lit ces taux figés : le paramétrage n'a plus d'effet.
--      Rouvrir : gérant, tracé.
--   2. Journal d'audit (mig 328) branché sur les périodes et sur le paramétrage
--      analytique (charges, montants réels, centres, cessions, affectations du personnel).
--
-- INVERSION
--   DROP TABLE analytic_periods ; DROP TRIGGER <table>_config_audit sur les tables listées.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS analytic_periods (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid REFERENCES stores(id),
  period      date NOT NULL CHECK (period = date_trunc('month', period)::date),
  status      varchar(8) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  snapshot    jsonb,
  closed_at   timestamptz,
  closed_by   uuid REFERENCES users(id),
  reopened_at timestamptz,
  reopened_by uuid REFERENCES users(id),
  reopen_reason text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'open' OR (snapshot IS NOT NULL AND closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_analytic_periods_store_period
  ON analytic_periods (COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid), period);
COMMENT ON TABLE analytic_periods IS
  'Mig 658 : clôture analytique d''un mois. closed : snapshot = modèle du mois figé (taux des centres, activité, écarts) ; le calcul des plans du mois le lit au lieu du paramétrage courant.';

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('analytic_periods',          'id',             'store_id'),
    ('analytic_charges',          'id',             'store_id'),
    ('analytic_charge_actuals',   'charge_id',      NULL),
    ('cost_centers',              'id',             'store_id'),
    ('cost_center_transfers',     'from_center_id', NULL),
    ('employee_cost_allocations', 'employee_id',    NULL)
  ) AS t(tbl, keycol, subcol)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', r.tbl || '_config_audit', r.tbl);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION log_config_change(%L, %L)',
      r.tbl || '_config_audit', r.tbl, r.keycol, COALESCE(r.subcol, ''));
  END LOOP;
END $$;
