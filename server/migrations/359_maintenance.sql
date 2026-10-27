-- 359 — Maintenance : plans d'entretien et interventions (module générique, toutes industries)
--
-- Deux objets :
--   - plan d'entretien : « tous les N jours, faire X sur tel équipement » (préventif) ;
--     à l'échéance, on crée l'intervention depuis le plan ;
--   - intervention : un travail daté sur un équipement, interne (immobilisation) ou chez
--     un client (équipement décrit en clair + n° de série). Préventive, corrective,
--     installation ou garantie. Elle peut découler d'une réclamation SAV (mig 357).
--
-- Conventions :
--   - statut : requested → scheduled → in_progress → done ; cancelled ;
--   - coût = pièces + main-d'œuvre (heures × taux) ; refacturable au client ou non ;
--   - l'équipement : fixed_asset_id (interne) OU customer_id + equipment_label (client),
--     au moins un libellé pour s'y retrouver.
--
-- Rollback :
--   DROP TABLE maintenance_events, maintenance_interventions, maintenance_plans ;
--   DELETE FROM document_sequences WHERE doc_type = 'maintenance' ;
--   DELETE FROM role_permissions WHERE module = 'maintenance' ;
--   DELETE FROM notification_rules WHERE domain = 'maintenance'.

-- ─── 1. Plans d'entretien (préventif) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS maintenance_plans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          UUID REFERENCES stores(id),
  label             VARCHAR(200) NOT NULL,
  fixed_asset_id    UUID REFERENCES fixed_assets(id),
  customer_id       UUID REFERENCES customers(id),
  equipment_label   VARCHAR(200),
  serial_no         VARCHAR(80),
  frequency_days    INTEGER NOT NULL CHECK (frequency_days BETWEEN 1 AND 3660),
  checklist         TEXT,
  assignee_id       UUID REFERENCES employees(id),
  last_done_on      DATE,
  next_due_on       DATE NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (fixed_asset_id IS NOT NULL OR COALESCE(btrim(equipment_label), '') <> '')
);
CREATE INDEX IF NOT EXISTS idx_maintenance_plans_due ON maintenance_plans (next_due_on) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_maintenance_plans_asset ON maintenance_plans (fixed_asset_id) WHERE fixed_asset_id IS NOT NULL;
COMMENT ON TABLE maintenance_plans IS 'Entretien préventif périodique (mig 359) : équipement interne (immobilisation) ou chez un client.';

-- ─── 2. Interventions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS maintenance_interventions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number            VARCHAR(30) NOT NULL UNIQUE,
  store_id          UUID REFERENCES stores(id),
  kind              VARCHAR(12) NOT NULL DEFAULT 'corrective'
                      CHECK (kind IN ('preventive', 'corrective', 'installation', 'warranty')),
  status            VARCHAR(12) NOT NULL DEFAULT 'requested'
                      CHECK (status IN ('requested', 'scheduled', 'in_progress', 'done', 'cancelled')),
  priority          VARCHAR(10) NOT NULL DEFAULT 'normal'
                      CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  title             VARCHAR(200) NOT NULL,
  -- Équipement : interne ou chez le client.
  fixed_asset_id    UUID REFERENCES fixed_assets(id),
  customer_id       UUID REFERENCES customers(id),
  equipment_label   VARCHAR(200),
  serial_no         VARCHAR(80),
  location          VARCHAR(200),
  -- Origine.
  plan_id           UUID REFERENCES maintenance_plans(id) ON DELETE SET NULL,
  complaint_id      UUID REFERENCES complaints(id) ON DELETE SET NULL,
  project_id        UUID REFERENCES projects(id) ON DELETE SET NULL,
  reported_problem  TEXT,
  -- Exécution.
  assignee_id       UUID REFERENCES employees(id),
  scheduled_at      TIMESTAMPTZ,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  work_done         TEXT,
  downtime_hours    NUMERIC(8,2) CHECK (downtime_hours IS NULL OR downtime_hours >= 0),
  labor_hours       NUMERIC(8,2) CHECK (labor_hours IS NULL OR labor_hours >= 0),
  labor_rate        NUMERIC(12,2) CHECK (labor_rate IS NULL OR labor_rate >= 0),
  parts_cost        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (parts_cost >= 0),
  under_warranty    BOOLEAN NOT NULL DEFAULT false,
  billable          BOOLEAN NOT NULL DEFAULT false,
  billed_amount     NUMERIC(12,2) CHECK (billed_amount IS NULL OR billed_amount >= 0),
  photo_url         TEXT,
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (fixed_asset_id IS NOT NULL OR COALESCE(btrim(equipment_label), '') <> ''),
  CHECK ((status = 'done') = (completed_at IS NOT NULL)),
  CHECK (status <> 'done' OR work_done IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_maint_status    ON maintenance_interventions (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_maint_asset     ON maintenance_interventions (fixed_asset_id) WHERE fixed_asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_maint_customer  ON maintenance_interventions (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_maint_assignee  ON maintenance_interventions (assignee_id, status) WHERE assignee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_maint_store     ON maintenance_interventions (store_id, created_at DESC);
COMMENT ON TABLE maintenance_interventions IS 'Interventions de maintenance (mig 359) : préventive, corrective, installation, garantie ; interne ou chez le client.';

-- ─── 3. Journal ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS maintenance_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intervention_id  UUID NOT NULL REFERENCES maintenance_interventions(id) ON DELETE CASCADE,
  event_type       VARCHAR(12) NOT NULL CHECK (event_type IN ('created', 'comment', 'status', 'assigned', 'scheduled', 'edited')),
  from_value       VARCHAR(40),
  to_value         VARCHAR(40),
  note             TEXT,
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_maintenance_events ON maintenance_events (intervention_id, created_at);

-- ─── 4. Numérotation MNT-AAAA-NNNN (mig 329) ───────────────────────────────
INSERT INTO document_sequences (doc_type, label, module, pattern, padding, reset_period, target_table, target_column, gapless, display_order)
VALUES ('maintenance', 'Intervention de maintenance', 'maintenance', 'MNT-{YYYY}-{SEQ}', 4, 'year', 'maintenance_interventions', 'number', false, 80)
ON CONFLICT (doc_type) DO NOTHING;

-- ─── 5. Droit « Maintenance » (mig 330) : gérant par défaut ────────────────
INSERT INTO role_permissions (role_code, module, can_view, can_create, can_edit, can_delete)
SELECT r.code, 'maintenance', true, true, true, true FROM roles r WHERE r.code = 'manager'
ON CONFLICT (role_code, module) DO NOTHING;

-- ─── 6. Notifications ──────────────────────────────────────────────────────
INSERT INTO notification_rules (type, label, domain) VALUES
  ('maintenance_assigned', 'Intervention affectée',          'maintenance'),
  ('maintenance_due',      'Entretien préventif à échéance', 'maintenance')
ON CONFLICT (type) DO NOTHING;

-- ─── 7. updated_at ─────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS maintenance_plans_touch ON maintenance_plans;
CREATE TRIGGER maintenance_plans_touch BEFORE UPDATE ON maintenance_plans FOR EACH ROW EXECUTE FUNCTION trg_projects_touch();
DROP TRIGGER IF EXISTS maintenance_interventions_touch ON maintenance_interventions;
CREATE TRIGGER maintenance_interventions_touch BEFORE UPDATE ON maintenance_interventions FOR EACH ROW EXECUTE FUNCTION trg_projects_touch();
