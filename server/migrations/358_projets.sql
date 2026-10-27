-- 358 — Projets : projets, tâches et temps passé (module générique, toutes industries)
--
-- Un projet = un travail suivi dans le temps pour un client (ou en interne) : chantier,
-- événement traiteur, mission, commande sur devis, projet interne. Il porte des tâches
-- (à faire → en cours → faites), et le personnel y déclare son temps par ligne (date,
-- heures, type d'activité, facturable ou non). Chaque ligne fige un coût horaire (ce
-- que coûte l'heure de la personne) et un taux de facturation (ce qu'on facture au
-- client), pour connaître à tout moment le coût réel, le facturable et la marge.
--
-- Conventions :
--   - statut projet : draft → active → on_hold / completed / cancelled ;
--   - facturation : none (interne / inclus), fixed (forfait = budget_amount),
--     time (au temps passé, taux horaire du projet, par défaut celui de l'activité) ;
--   - coût horaire d'un salarié = hourly_rate, sinon mensuel / 208 h, sinon hebdo / 48 h ;
--   - les tâches et le temps restent liés au projet même clôturé (historique).
--
-- Rollback :
--   DROP TABLE project_time_entries, project_tasks, projects ;
--   DELETE FROM document_sequences WHERE doc_type = 'project' ;
--   DELETE FROM ref_entries WHERE table_id = 'project_activity_types' ;
--   DELETE FROM ref_tables WHERE id = 'project_activity_types' ;
--   DELETE FROM role_permissions WHERE module = 'projects' ;
--   DELETE FROM notification_rules WHERE domain = 'projects'.

-- ─── 1. Projets ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number           VARCHAR(30) NOT NULL UNIQUE,
  name             VARCHAR(200) NOT NULL,
  description      TEXT,
  store_id         UUID REFERENCES stores(id),
  customer_id      UUID REFERENCES customers(id),
  order_id         UUID REFERENCES orders(id),
  status           VARCHAR(12) NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'active', 'on_hold', 'completed', 'cancelled')),
  priority         VARCHAR(10) NOT NULL DEFAULT 'normal'
                     CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  start_date       DATE,
  due_date         DATE,
  completed_at     TIMESTAMPTZ,
  manager_id       UUID REFERENCES users(id),
  billing_type     VARCHAR(8) NOT NULL DEFAULT 'none' CHECK (billing_type IN ('none', 'fixed', 'time')),
  hourly_rate      NUMERIC(12,2) CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
  budget_amount    NUMERIC(12,2) CHECK (budget_amount IS NULL OR budget_amount >= 0),
  estimated_hours  NUMERIC(10,2) CHECK (estimated_hours IS NULL OR estimated_hours >= 0),
  notes            TEXT,
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (due_date IS NULL OR start_date IS NULL OR due_date >= start_date),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_projects_status   ON projects (status, due_date);
CREATE INDEX IF NOT EXISTS idx_projects_customer ON projects (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_store    ON projects (store_id, created_at DESC);
COMMENT ON TABLE projects IS 'Projets (mig 358) : chantier, événement, mission, commande sur devis. Client et commande optionnels.';

-- ─── 2. Tâches ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_tasks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_task_id   UUID REFERENCES project_tasks(id) ON DELETE SET NULL,
  title            VARCHAR(200) NOT NULL,
  description      TEXT,
  status           VARCHAR(12) NOT NULL DEFAULT 'todo'
                     CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled')),
  priority         VARCHAR(10) NOT NULL DEFAULT 'normal'
                     CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  assignee_id      UUID REFERENCES employees(id),
  start_date       DATE,
  due_date         DATE,
  estimated_hours  NUMERIC(10,2) CHECK (estimated_hours IS NULL OR estimated_hours >= 0),
  display_order    INTEGER NOT NULL DEFAULT 0,
  completed_at     TIMESTAMPTZ,
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'done') = (completed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_project_tasks_project  ON project_tasks (project_id, display_order);
CREATE INDEX IF NOT EXISTS idx_project_tasks_assignee ON project_tasks (assignee_id, status) WHERE assignee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_tasks_due      ON project_tasks (due_date) WHERE status IN ('todo', 'in_progress');

-- ─── 3. Temps passé ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_time_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id          UUID REFERENCES project_tasks(id) ON DELETE SET NULL,
  employee_id      UUID NOT NULL REFERENCES employees(id),
  work_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  hours            NUMERIC(6,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  activity_code    VARCHAR(60),
  note             TEXT,
  billable         BOOLEAN NOT NULL DEFAULT true,
  -- Figés à la saisie : le coût de l'heure de la personne et le taux facturé au client.
  cost_rate        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cost_rate >= 0),
  billing_rate     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (billing_rate >= 0),
  invoice_id       UUID REFERENCES invoices(id),
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_time_project  ON project_time_entries (project_id, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_project_time_employee ON project_time_entries (employee_id, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_project_time_unbilled ON project_time_entries (project_id) WHERE billable AND invoice_id IS NULL;
COMMENT ON TABLE project_time_entries IS 'Temps passé par salarié et par projet (mig 358). cost_rate / billing_rate figés à la saisie.';

-- ─── 4. Numérotation PRJ-AAAA-NNNN (mig 329) ───────────────────────────────
INSERT INTO document_sequences (doc_type, label, module, pattern, padding, reset_period, target_table, target_column, gapless, display_order)
VALUES ('project', 'Projet', 'projects', 'PRJ-{YYYY}-{SEQ}', 4, 'year', 'projects', 'number', false, 75)
ON CONFLICT (doc_type) DO NOTHING;

-- ─── 5. Types d'activité : référentiel éditable, avec taux facturable ──────
INSERT INTO ref_tables (id, label, description, icon, source, editable, display_order)
VALUES ('project_activity_types', 'Types d''activité (projets)', 'Ce qu''on fait sur un projet ; le taux horaire facturable par défaut est dans les métadonnées (billing_rate).', 'Timer', 'ref_entries', true, 61)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ref_entries (table_id, code, label, description, display_order, metadata)
VALUES
  ('project_activity_types', 'preparation', 'Préparation',        'Mise en place, achats, organisation',           10, '{"billing_rate": 0}'::jsonb),
  ('project_activity_types', 'execution',   'Réalisation',        'Travail principal sur place ou en atelier',     20, '{"billing_rate": 0}'::jsonb),
  ('project_activity_types', 'delivery',    'Livraison / service', 'Transport, installation, service sur place',   30, '{"billing_rate": 0}'::jsonb),
  ('project_activity_types', 'meeting',     'Réunion / échange',  'Rendez-vous client, coordination',               40, '{"billing_rate": 0}'::jsonb),
  ('project_activity_types', 'admin',       'Administratif',      'Devis, facture, suivi',                          50, '{"billing_rate": 0}'::jsonb)
ON CONFLICT (table_id, code) DO NOTHING;

-- ─── 6. Droit « Projets » (mig 330) : gérant par défaut, l'admin a tout ────
INSERT INTO role_permissions (role_code, module, can_view, can_create, can_edit, can_delete)
SELECT r.code, 'projects', true, true, true, true FROM roles r WHERE r.code = 'manager'
ON CONFLICT (role_code, module) DO NOTHING;

-- ─── 7. Notifications ──────────────────────────────────────────────────────
INSERT INTO notification_rules (type, label, domain) VALUES
  ('project_task_assigned', 'Tâche de projet affectée', 'projects'),
  ('project_task_overdue',  'Tâche de projet en retard', 'projects')
ON CONFLICT (type) DO NOTHING;

-- ─── 8. updated_at ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_projects_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS projects_touch ON projects;
CREATE TRIGGER projects_touch BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION trg_projects_touch();
DROP TRIGGER IF EXISTS project_tasks_touch ON project_tasks;
CREATE TRIGGER project_tasks_touch BEFORE UPDATE ON project_tasks FOR EACH ROW EXECUTE FUNCTION trg_projects_touch();
