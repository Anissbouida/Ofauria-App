-- Lot 13 : jeux de changements rattachés à une révision précise du brouillon.
-- Aucune activation ou modification de la configuration existante.
CREATE TABLE IF NOT EXISTS config_change_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES config_wizard_sessions(id) ON DELETE RESTRICT,
  session_revision integer NOT NULL CHECK (session_revision >= 0),
  base_version_id bigint REFERENCES config_versions(id) ON DELETE RESTRICT,
  operations jsonb NOT NULL CHECK (jsonb_typeof(operations)='array'),
  issues jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(issues)='array'),
  status text NOT NULL CHECK (status IN ('compiled','blocked','simulated_partial','simulated','applied','obsolete')),
  simulation jsonb,
  published_version_id bigint REFERENCES config_versions(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, session_revision),
  CHECK (status <> 'applied' OR published_version_id IS NOT NULL),
  CHECK (status NOT IN ('simulated_partial','simulated','applied') OR simulation IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS config_change_sets_session ON config_change_sets(session_id, session_revision DESC);
