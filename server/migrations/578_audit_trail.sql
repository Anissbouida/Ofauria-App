-- G6-07 — Piste d'audit générique.
-- Un seul déclencheur, posé sur toutes les tables métier qui ont une colonne id : chaque
-- modification ou suppression écrit dans audit_trail qui (app.user_id), quand, quelle
-- table, quelle ligne, et les seuls champs changés (ancienne et nouvelle valeur). La
-- création n'est pas tracée (la ligne elle-même la porte, avec created_at).
-- Exclues (volume ou sans intérêt) : journaux et pistes d'audit, compteurs de stock
-- recalculés, caches, miroirs, sessions, files d'attente. Colonnes sensibles masquées.
-- Une nouvelle table métier se rattache par SELECT fn_audit_attach_all().
-- Rollback : SELECT fn_audit_detach_all() ; DROP TABLE audit_trail ;
--   DROP FUNCTION fn_audit_trail_row, fn_audit_attach_all, fn_audit_detach_all.

CREATE TABLE IF NOT EXISTS audit_trail (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  action CHAR(1) NOT NULL CHECK (action IN ('U', 'D')),
  changed JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id UUID,
  origin TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_trail_record ON audit_trail (table_name, record_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_trail_actor ON audit_trail (actor_id, at DESC) WHERE actor_id IS NOT NULL;

-- Ajout seul : ni modification ni suppression d'une trace.
CREATE OR REPLACE FUNCTION fn_audit_trail_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_trail est en ajout seul'; END $$;
DROP TRIGGER IF EXISTS trg_audit_trail_append_only ON audit_trail;
CREATE TRIGGER trg_audit_trail_append_only BEFORE UPDATE OR DELETE ON audit_trail
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trail_append_only();

CREATE OR REPLACE FUNCTION fn_audit_trail_row() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  o JSONB := to_jsonb(OLD);
  n JSONB := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(NEW) ELSE NULL END;
  diff JSONB := '{}'::jsonb;
  k TEXT;
  noise CONSTANT TEXT[] := ARRAY['updated_at', 'created_at', 'search_vector'];
  secret CONSTANT TEXT[] := ARRAY['password_hash', 'pin_code', 'totp_secret_enc', 'totp_backup_codes', 'api_key_hash', 'token_hash', 'secret'];
  actor UUID;
BEGIN
  IF NOT (o ? 'id') THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' THEN
    FOR k IN SELECT jsonb_object_keys(n) LOOP
      IF k = ANY (noise) THEN CONTINUE; END IF;
      IF (o -> k) IS DISTINCT FROM (n -> k) THEN
        diff := diff || jsonb_build_object(k, CASE WHEN k = ANY (secret) THEN '["***", "***"]'::jsonb ELSE jsonb_build_array(o -> k, n -> k) END);
      END IF;
    END LOOP;
    IF diff = '{}'::jsonb THEN RETURN NULL; END IF;
  ELSE
    FOR k IN SELECT jsonb_object_keys(o) LOOP
      IF k = ANY (secret) THEN o := o - k; END IF;
    END LOOP;
    diff := jsonb_build_object('_deleted', o);
  END IF;
  BEGIN actor := NULLIF(current_setting('app.user_id', true), '')::uuid; EXCEPTION WHEN others THEN actor := NULL; END;
  INSERT INTO audit_trail (table_name, record_id, action, changed, actor_id, origin)
  VALUES (TG_TABLE_NAME, o ->> 'id', CASE WHEN TG_OP = 'UPDATE' THEN 'U' ELSE 'D' END, diff, actor,
          NULLIF(current_setting('app.change_origin', true), ''));
  RETURN NULL;
END $$;

-- Tables non suivies : journaux / pistes, compteurs recalculés, caches, miroirs, sessions,
-- files d'attente, tables à fort volume déjà tracées par leurs mouvements.
CREATE OR REPLACE FUNCTION fn_audit_excluded(p_table TEXT) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT p_table = ANY (ARRAY[
    'audit_trail', '_migrations', 'auth_events', 'revoked_tokens', 'sessions', 'notifications', 'email_outbox',
    'scheduled_job_runs', 'unit_factor_cache', 'ingredient_lot_locations', 'inventory', 'product_store_stock',
    'inventory_transactions', 'product_stock_transactions', 'product_lot_movements', 'stock_location_moves',
    'ingredient_stock_zone_transfers', 'production_lot_usage', 'quality_control_counters', 'policy_values_history'])
    OR p_table LIKE '%audit%' OR p_table LIKE '%\_log' OR p_table LIKE '%\_log\_%' OR p_table LIKE '%\_events'
    OR p_table LIKE '%\_history' OR p_table LIKE '%\_snapshots'
$$;

CREATE OR REPLACE FUNCTION fn_audit_attach_all() RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE r RECORD; n INTEGER := 0;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'r' AND NOT c.relispartition
       AND EXISTS (SELECT 1 FROM information_schema.columns ic WHERE ic.table_schema = 'public' AND ic.table_name = c.relname AND ic.column_name = 'id')
       AND NOT fn_audit_excluded(c.relname)
       AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgname = 'trg_audit_trail')
  LOOP
    EXECUTE format('CREATE TRIGGER trg_audit_trail AFTER UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION fn_audit_trail_row()', r.relname);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION fn_audit_detach_all() RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE r RECORD; n INTEGER := 0;
BEGIN
  FOR r IN SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE t.tgname = 'trg_audit_trail' LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_trail ON %I', r.relname);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

SELECT fn_audit_attach_all();
