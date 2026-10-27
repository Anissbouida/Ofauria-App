-- 370 — Import générique : journal des imports et annulation
--
-- L'import guidé (Paramètres › Import et export, lot 7) s'étend aux matières, aux
-- consommables et aux produits, prend les champs personnalisés (mig 369), laisse
-- associer les colonnes du fichier et choisir le mode (créer et mettre à jour, créer
-- seulement, mettre à jour seulement).
--
-- Chaque import est journalisé avec, pour chaque fiche touchée, l'action et l'état
-- antérieur des champs modifiés : l'annulation supprime les fiches créées (ou les
-- désactive si elles sont déjà utilisées) et remet les valeurs d'avant. Seul le dernier
-- import non annulé d'un type de fiche s'annule, pour ne pas défaire un import plus récent.
--
-- Rollback : DROP TABLE data_import_rows, data_imports.

CREATE TABLE IF NOT EXISTS data_imports (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity         VARCHAR(30) NOT NULL,
  file_name      VARCHAR(255),
  mode           VARCHAR(10) NOT NULL CHECK (mode IN ('upsert', 'create', 'update')),
  mapping        JSONB NOT NULL DEFAULT '{}'::jsonb,
  status         VARCHAR(10) NOT NULL DEFAULT 'done' CHECK (status IN ('done', 'undone')),
  created_count  INTEGER NOT NULL DEFAULT 0,
  updated_count  INTEGER NOT NULL DEFAULT 0,
  skipped_count  INTEGER NOT NULL DEFAULT 0,
  undo_report    JSONB,
  store_id       UUID REFERENCES stores(id),
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  undone_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  undone_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_data_imports ON data_imports (entity, created_at DESC);
COMMENT ON TABLE data_imports IS 'Journal des imports de données (mig 370) ; annulable (dernier import d''un type de fiche).';

CREATE TABLE IF NOT EXISTS data_import_rows (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id   UUID NOT NULL REFERENCES data_imports(id) ON DELETE CASCADE,
  line        INTEGER NOT NULL,
  record_id   UUID NOT NULL,
  action      VARCHAR(10) NOT NULL CHECK (action IN ('create', 'update')),
  before      JSONB
);
CREATE INDEX IF NOT EXISTS idx_data_import_rows ON data_import_rows (import_id);
COMMENT ON COLUMN data_import_rows.before IS 'Valeurs des colonnes modifiées avant l''import (mise à jour), dont custom_fields complet.';
