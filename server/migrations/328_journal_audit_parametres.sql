-- ═══════════════════════════════════════════════════════════════════════
-- 328 — Journal d'audit transverse du paramétrage
--   Jusqu'ici seuls les achats, les nomenclatures et le référentiel étaient
--   tracés. Les paramètres société, magasins, utilisateurs, droits,
--   imprimantes, paramètres de paie, codes TVA… changeaient sans trace.
--
--   config_audit_log : journal SGBD en ajout seul, une ligne par INSERT /
--   UPDATE / DELETE, avec le diff champ par champ.
--     record_id  : clé de la ligne (texte : les tables ont des clés uuid,
--                  entières ou date) ;
--     subject_id : rattachement utile au filtrage (l'utilisateur dont on
--                  change les droits, le magasin d'une imprimante) ;
--     changed_by : current_setting('app.user_id') posé par l'API, sinon la
--                  colonne updated_by de la ligne.
--   Les secrets (mot de passe, PIN) sont masqués ; le logo (data URI de
--   plusieurs centaines de Ko) est remplacé par une empreinte.
--
--   Les triggers ne sont posés que sur les tables présentes : une partie
--   d'entre elles (module_parameters, tax_codes…) vient de migrations qui
--   ne sont pas encore sur toutes les bases.
--
-- INVERSION
--   DROP TABLE config_audit_log ; DROP FUNCTION log_config_change(),
--   config_audit_append_only() ; DROP TRIGGER <table>_config_audit ON <table>
--   pour chaque table de la liste ci-dessous.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS config_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  table_name  VARCHAR(60) NOT NULL,
  operation   VARCHAR(10) NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  record_id   TEXT,
  subject_id  TEXT,
  changed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  diff        JSONB,          -- {champ: {old, new}} : champs modifiés seulement (UPDATE)
  old_row     JSONB,
  new_row     JSONB
);
CREATE INDEX IF NOT EXISTS idx_cal_date    ON config_audit_log (changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_cal_table   ON config_audit_log (table_name, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_cal_record  ON config_audit_log (table_name, record_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_cal_subject ON config_audit_log (subject_id, changed_at DESC) WHERE subject_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cal_by      ON config_audit_log (changed_by, changed_at DESC);
COMMENT ON TABLE config_audit_log IS
  'Journal SGBD append-only du paramétrage : société, magasins, utilisateurs, droits, imprimantes, paie, TVA (mig 328).';

-- Ajout seul : le rôle applicatif possède la table, on protège par trigger.
CREATE OR REPLACE FUNCTION config_audit_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'config_audit_log est en ajout seul (append-only)';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS config_audit_log_append_only ON config_audit_log;
CREATE TRIGGER config_audit_log_append_only
  BEFORE UPDATE OR DELETE ON config_audit_log
  FOR EACH ROW EXECUTE FUNCTION config_audit_append_only();

-- TG_ARGV[0] : colonne clé (défaut id) ; TG_ARGV[1] : colonne de rattachement (optionnelle).
CREATE OR REPLACE FUNCTION log_config_change()
RETURNS TRIGGER AS $$
DECLARE
  v_old    JSONB;
  v_new    JSONB;
  v_diff   JSONB := '{}'::jsonb;
  v_key    TEXT;
  v_keycol TEXT := COALESCE(NULLIF(TG_ARGV[0], ''), 'id');
  v_subcol TEXT := NULLIF(TG_ARGV[1], '');
  v_by     UUID;
  v_ctx    TEXT;
  -- Bruit technique : horodatages et compteurs de connexion (tracés dans auth_events).
  v_noise  TEXT[] := ARRAY['updated_at', 'updated_by', 'created_at',
                           'failed_login_count', 'last_failed_login_at', 'locked_until', 'token_version'];
  v_secret TEXT[] := ARRAY['password_hash', 'pin_code'];
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;

  -- Masquage avant diff : un changement de secret reste visible (« modifié »)
  -- sans que la valeur, même hachée, soit recopiée dans le journal.
  FOREACH v_key IN ARRAY v_secret LOOP
    IF v_old ? v_key THEN
      v_old := jsonb_set(v_old, ARRAY[v_key], CASE WHEN v_old ->> v_key IS NULL THEN 'null'::jsonb ELSE to_jsonb('•••• ' || left(md5(v_old ->> v_key), 6)) END);
    END IF;
    IF v_new ? v_key THEN
      v_new := jsonb_set(v_new, ARRAY[v_key], CASE WHEN v_new ->> v_key IS NULL THEN 'null'::jsonb ELSE to_jsonb('•••• ' || left(md5(v_new ->> v_key), 6)) END);
    END IF;
  END LOOP;
  IF v_old ? 'logo_url' AND v_old ->> 'logo_url' IS NOT NULL THEN
    v_old := jsonb_set(v_old, '{logo_url}', to_jsonb('image ' || left(md5(v_old ->> 'logo_url'), 8) || ' (' || (length(v_old ->> 'logo_url') / 1024) || ' Ko)'));
  END IF;
  IF v_new ? 'logo_url' AND v_new ->> 'logo_url' IS NOT NULL THEN
    v_new := jsonb_set(v_new, '{logo_url}', to_jsonb('image ' || left(md5(v_new ->> 'logo_url'), 8) || ' (' || (length(v_new ->> 'logo_url') / 1024) || ' Ko)'));
  END IF;

  IF TG_OP = 'UPDATE' THEN
    FOR v_key IN SELECT jsonb_object_keys(v_old || v_new) LOOP
      IF NOT (v_key = ANY (v_noise)) AND (v_old -> v_key) IS DISTINCT FROM (v_new -> v_key) THEN
        v_diff := v_diff || jsonb_build_object(v_key, jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key));
      END IF;
    END LOOP;
    IF v_diff = '{}'::jsonb THEN RETURN NULL; END IF;   -- rien de métier n'a changé
  END IF;

  -- Auteur : contexte posé par l'API (transaction), sinon updated_by de la ligne.
  v_ctx := current_setting('app.user_id', true);
  IF v_ctx IS NOT NULL AND v_ctx ~ '^[0-9a-fA-F-]{36}$' THEN
    v_by := v_ctx::uuid;
  ELSIF COALESCE(v_new ->> 'updated_by', '') ~ '^[0-9a-fA-F-]{36}$' THEN
    v_by := (v_new ->> 'updated_by')::uuid;
  END IF;

  INSERT INTO config_audit_log (table_name, operation, record_id, subject_id, changed_by, diff, old_row, new_row)
  VALUES (
    TG_TABLE_NAME, TG_OP,
    COALESCE(v_new ->> v_keycol, v_old ->> v_keycol),
    CASE WHEN v_subcol IS NULL THEN NULL ELSE COALESCE(v_new ->> v_subcol, v_old ->> v_subcol) END,
    v_by, NULLIF(v_diff, '{}'::jsonb), v_old, v_new
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Pose des triggers : (table, colonne clé, colonne de rattachement).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('company_settings',   'id',           NULL),
    ('stores',             'id',           NULL),
    ('users',              'id',           'id'),
    ('user_permissions',   'module',       'user_id'),
    ('printer_configs',    'id',           'store_id'),
    ('sales_channels',     'id',           NULL),
    ('payroll_settings',   'id',           NULL),
    ('payroll_tax_scales', 'id',           NULL),
    ('public_holidays',    'holiday_date', NULL),
    ('module_parameters',  'key',          NULL),
    ('tax_codes',          'id',           NULL)
  ) AS t(tbl, keycol, subcol)
  LOOP
    IF to_regclass('public.' || r.tbl) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', r.tbl || '_config_audit', r.tbl);
      EXECUTE format(
        'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION log_config_change(%L, %L)',
        r.tbl || '_config_audit', r.tbl, r.keycol, COALESCE(r.subcol, '')
      );
    END IF;
  END LOOP;
END $$;
