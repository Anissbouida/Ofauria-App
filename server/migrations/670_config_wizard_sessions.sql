-- Assistant multisectoriel, lot 1. Additif : aucune configuration active modifiée.
CREATE TABLE IF NOT EXISTS config_wizard_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('initial','evolution','upgrade')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','simulated','applied','abandoned')),
  mode text NOT NULL CHECK (mode IN ('quick','advanced')),
  current_step text NOT NULL DEFAULT 'company',
  answers jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answers) = 'object'),
  issues jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(issues) = 'array'),
  base_version_id bigint REFERENCES config_versions(id) ON DELETE RESTRICT,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS config_wizard_one_initial_draft ON config_wizard_sessions(kind) WHERE kind = 'initial' AND status IN ('draft','simulated');
CREATE INDEX IF NOT EXISTS config_wizard_sessions_updated ON config_wizard_sessions(updated_at DESC);
