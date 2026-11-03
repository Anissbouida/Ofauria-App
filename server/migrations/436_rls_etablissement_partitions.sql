-- ═══════════════════════════════════════════════════════════════════════
-- 436 — Cloisonnement par établissement (RLS) et partitionnement par
--       exercice du journal d'audit comptable (lot Bonus 16)
--
--   1. RLS : le serveur déclare le périmètre de la requête dans le paramètre
--      de session app.store_scope (un magasin) ; Postgres filtre alors lui-même
--      les tables comptables, quel que soit le WHERE écrit dans le code (comme
--      un contexte d'application VPD). Sans périmètre déclaré : aucune
--      restriction, comportement inchangé (traitements de fond, admin global).
--      Les écritures communes (store_id NULL) restent visibles de tous.
--      FORCE : la règle s'applique aussi au rôle propriétaire des tables (le
--      serveur s'y connecte encore) ; seul un superutilisateur l'ignore.
--      Les lignes d'écritures suivent leur en-tête.
--   2. ledger_audit_log devient une table partitionnée par exercice (année
--      civile, bornes à minuit heure de Casablanca), avec une partition par
--      défaut de secours. fn_ensure_audit_partition(année) crée la partition
--      d'un exercice ; la tâche planifiée ledger_partitions prépare l'exercice
--      suivant. Les écritures elles-mêmes ne sont pas partitionnées : la clé
--      de partition devrait entrer dans toutes les clés étrangères qui les
--      désignent (lettrage, relevés, analytique, bordereaux…) et la chaîne
--      d'empreintes (mig 413) en dépend.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. RLS par établissement ────────────────────────────────────────────
-- Fonction SQL STABLE en ligne : le planificateur l'intègre à la requête.
CREATE OR REPLACE FUNCTION fn_rls_store_ok(p_store UUID) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.store_scope', true), '') IS NULL
      OR p_store IS NULL
      OR p_store::text = current_setting('app.store_scope', true)
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['journal_entries', 'invoices', 'payments', 'bill_remittances'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS p_store_scope ON %I', t);
    EXECUTE format('CREATE POLICY p_store_scope ON %I USING (fn_rls_store_ok(store_id)) WITH CHECK (fn_rls_store_ok(store_id))', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Lignes : visibles si leur écriture l'est (la RLS de journal_entries s'applique dans la sous-requête).
DROP POLICY IF EXISTS p_store_scope ON journal_entry_lines;
CREATE POLICY p_store_scope ON journal_entry_lines
  USING (NULLIF(current_setting('app.store_scope', true), '') IS NULL
         OR EXISTS (SELECT 1 FROM journal_entries je WHERE je.id = journal_entry_id))
  WITH CHECK (NULLIF(current_setting('app.store_scope', true), '') IS NULL
         OR EXISTS (SELECT 1 FROM journal_entries je WHERE je.id = journal_entry_id));
ALTER TABLE journal_entry_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_lines FORCE ROW LEVEL SECURITY;

-- ─── 2. Journal d'audit partitionné par exercice ─────────────────────────
ALTER TABLE ledger_audit_log RENAME TO ledger_audit_log_legacy;
ALTER INDEX ledger_audit_log_pkey RENAME TO ledger_audit_log_legacy_pkey;
ALTER INDEX idx_lal_at RENAME TO idx_lal_legacy_at;
ALTER INDEX idx_lal_entry RENAME TO idx_lal_legacy_entry;
ALTER INDEX idx_lal_lettrage RENAME TO idx_lal_legacy_lettrage;
ALTER INDEX idx_lal_event RENAME TO idx_lal_legacy_event;

CREATE TABLE ledger_audit_log (
  id           bigint NOT NULL DEFAULT nextval('ledger_audit_log_id_seq'),
  at           timestamptz NOT NULL DEFAULT now(),
  event        varchar(20) NOT NULL CHECK (event IN (
                 'post', 'reverse', 'draft_delete', 'letter', 'unletter', 'reletter',
                 'seal', 'verify', 'outbox_replay', 'year_close', 'fec_export')),
  entry_id     uuid,          -- sans clé étrangère : un brouillon supprimé garde sa trace
  entry_number varchar(50),
  line_id      uuid,
  lettrage_id  uuid,
  actor        uuid REFERENCES users(id) ON DELETE SET NULL,
  client_ip    inet,
  details      jsonb,
  PRIMARY KEY (id, at)
) PARTITION BY RANGE (at);
ALTER SEQUENCE ledger_audit_log_id_seq OWNED BY ledger_audit_log.id;
CREATE TABLE ledger_audit_log_default PARTITION OF ledger_audit_log DEFAULT;

CREATE INDEX IF NOT EXISTS idx_lal_at       ON ledger_audit_log (at DESC);
CREATE INDEX IF NOT EXISTS idx_lal_entry    ON ledger_audit_log (entry_id) WHERE entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lal_lettrage ON ledger_audit_log (lettrage_id) WHERE lettrage_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lal_event    ON ledger_audit_log (event, at DESC);
COMMENT ON TABLE ledger_audit_log IS
  'Journal ajout seul des actions comptables (mig 413), partitionné par exercice (mig 436).';

-- Partition d'un exercice (année civile, minuit heure de Casablanca). Refuse si la
-- partition par défaut contient déjà des traces de cet exercice : le journal étant
-- en ajout seul, elles ne se déplacent pas sans intervention d'un administrateur.
CREATE OR REPLACE FUNCTION fn_ensure_audit_partition(p_year int) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_name text := format('ledger_audit_log_y%s', p_year);
  v_from timestamptz := make_timestamptz(p_year, 1, 1, 0, 0, 0, 'Africa/Casablanca');
  v_to   timestamptz := make_timestamptz(p_year + 1, 1, 1, 0, 0, 0, 'Africa/Casablanca');
BEGIN
  IF p_year NOT BETWEEN 2000 AND 2100 THEN RAISE EXCEPTION 'Exercice % hors limites', p_year; END IF;
  IF to_regclass(v_name) IS NOT NULL THEN RETURN v_name; END IF;
  IF EXISTS (SELECT 1 FROM ledger_audit_log_default WHERE at >= v_from AND at < v_to) THEN
    RAISE EXCEPTION 'La partition par défaut du journal d''audit contient déjà des traces de %', p_year;
  END IF;
  EXECUTE format('CREATE TABLE %I PARTITION OF ledger_audit_log FOR VALUES FROM (%L) TO (%L)', v_name, v_from, v_to);
  RETURN v_name;
END $$;

DO $$
DECLARE y int;
  y0 int := LEAST(EXTRACT(YEAR FROM now() AT TIME ZONE 'Africa/Casablanca')::int,
                  COALESCE((SELECT EXTRACT(YEAR FROM min(at) AT TIME ZONE 'Africa/Casablanca')::int FROM ledger_audit_log_legacy), 9999));
  y1 int := EXTRACT(YEAR FROM now() AT TIME ZONE 'Africa/Casablanca')::int + 1;
BEGIN
  FOR y IN y0..y1 LOOP PERFORM fn_ensure_audit_partition(y); END LOOP;
END $$;

INSERT INTO ledger_audit_log (id, at, event, entry_id, entry_number, line_id, lettrage_id, actor, client_ip, details)
SELECT id, at, event, entry_id, entry_number, line_id, lettrage_id, actor, client_ip, details FROM ledger_audit_log_legacy;

-- Ajout seul, propagé à toutes les partitions (présentes et futures).
DROP TRIGGER IF EXISTS ledger_audit_log_append_only ON ledger_audit_log;
CREATE TRIGGER ledger_audit_log_append_only BEFORE UPDATE OR DELETE ON ledger_audit_log
  FOR EACH ROW EXECUTE FUNCTION trg_audit_append_only();

DROP TABLE ledger_audit_log_legacy;

INSERT INTO scheduled_jobs (key, label, description, domain, interval_minutes, display_order) VALUES
  ('ledger_partitions', 'Partitions d''exercice', 'Prépare la partition du journal d''audit comptable de l''exercice suivant.', 'system', 1440, 92)
ON CONFLICT (key) DO NOTHING;
