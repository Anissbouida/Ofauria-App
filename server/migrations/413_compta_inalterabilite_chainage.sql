-- ═══════════════════════════════════════════════════════════════════════
-- 413 — Inaltérabilité de la comptabilité (lot Essentiel 1)
--
-- POURQUOI
--   La mig 311 fige déjà les écritures comptabilisées (triggers de garde).
--   Trois trous restaient :
--     1. un trigger se désactive d'une commande (ALTER TABLE … DISABLE TRIGGER) :
--        c'était le cas de trg_journal_line_guard sur la base de dev ; rien ne
--        permettait de savoir si une écriture avait été retouchée entre-temps ;
--     2. sur une écriture comptabilisée, le libellé, l'auteur (posted_by), la
--        date de validation, le magasin et le libellé/l'ordre des lignes
--        restaient modifiables ;
--     3. aucune trace de qui extourne, lettre ou délettre.
--
-- PORTÉE
--   1. Réactivation des triggers de garde.
--   2. Gardes étendues aux champs restés modifiables.
--   3. Chaînage par empreinte SHA-256 : chaque écriture comptabilisée reçoit
--      un numéro de chaîne, l'empreinte de son contenu et une empreinte chaînée
--      (empreinte précédente + empreinte du contenu). Retoucher une écriture
--      scellée, même triggers coupés, se voit à la vérification. Le scellement
--      est différé (fn_ledger_seal, tâche planifiée ledger_seal, clôture de
--      période) : il ne prend aucun verrou dans les transactions métier.
--   4. Ancrage à la clôture : chaque passage d'une période en closed/locked
--      scelle le grand livre et inscrit la tête de chaîne dans
--      fiscal_period_events (ajout seul) — l'empreinte à reporter sur le PV.
--   5. ledger_audit_log : journal ajout seul des actions comptables
--      (validation, extourne, lettrage, scellement, vérification, rejeu).
--
-- LIMITE
--   Un superutilisateur qui recalcule toute la chaîne ET les ancres ne serait
--   détecté que par comparaison avec une empreinte conservée hors de la base
--   (PV de clôture imprimé, export transmis au cabinet).
--
-- INVERSION
--   DROP TABLE ledger_audit_log ; DROP FUNCTION fn_ledger_seal(int),
--   fn_ledger_verify(int), fn_journal_entry_content(uuid), fn_ledger_actor(),
--   trg_journal_entry_audit(), trg_journal_line_lettrage_audit() ;
--   ALTER TABLE journal_entries DROP COLUMN chain_seq, content_hash, chain_hash, sealed_at ;
--   ALTER TABLE fiscal_period_events DROP COLUMN chain_seq, chain_hash ;
--   restaurer trg_journal_entry_guard / trg_journal_line_guard / trg_fiscal_period_status
--   (mig 311) et check_period_lock (mig 181) ; DELETE FROM scheduled_jobs WHERE key = 'ledger_seal'.
-- ═══════════════════════════════════════════════════════════════════════

-- ═══ 1. Réactivation des gardes ═════════════════════════════════════════
ALTER TABLE journal_entries     ENABLE TRIGGER trg_check_journal_entry_balance;
ALTER TABLE journal_entries     ENABLE TRIGGER trg_check_period_lock;
ALTER TABLE journal_entries     ENABLE TRIGGER trg_journal_entry_guard;
ALTER TABLE journal_entry_lines ENABLE TRIGGER trg_journal_line_guard;
ALTER TABLE fiscal_periods      ENABLE TRIGGER trg_fiscal_period_status;

-- ═══ 2. Colonnes de chaînage ════════════════════════════════════════════
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS chain_seq    bigint,
  ADD COLUMN IF NOT EXISTS content_hash char(64),
  ADD COLUMN IF NOT EXISTS chain_hash   char(64),
  ADD COLUMN IF NOT EXISTS sealed_at    timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uq_je_chain_seq ON journal_entries (chain_seq) WHERE chain_seq IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_je_unsealed ON journal_entries (posted_at)
  WHERE chain_seq IS NULL AND status IN ('posted','reversed');
COMMENT ON COLUMN journal_entries.chain_seq    IS 'Rang dans la chaîne d''inaltérabilité (mig 413), sans trou.';
COMMENT ON COLUMN journal_entries.content_hash IS 'SHA-256 du contenu canonique (fn_journal_entry_content) au scellement.';
COMMENT ON COLUMN journal_entries.chain_hash   IS 'SHA-256(chain_hash précédent || content_hash) : retoucher une écriture casse la chaîne.';

ALTER TABLE fiscal_period_events
  ADD COLUMN IF NOT EXISTS chain_seq  bigint,
  ADD COLUMN IF NOT EXISTS chain_hash char(64);
COMMENT ON COLUMN fiscal_period_events.chain_hash IS
  'Tête de chaîne au moment de la clôture/verrouillage (mig 413) : empreinte à reporter sur le PV de clôture.';

-- ═══ 3. Gardes étendues ═════════════════════════════════════════════════
-- En-tête : tout ce qui fait le contenu d'une écriture comptabilisée est figé ;
-- seuls changent le statut (posted -> reversed), le lien d'extourne (une fois)
-- et les colonnes de chaînage (une fois, par le scellement).
CREATE OR REPLACE FUNCTION trg_journal_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'draft' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Écriture % : suppression interdite, utilisez l''extourne', OLD.entry_number USING ERRCODE = 'OF409';
  END IF;
  IF OLD.status IN ('posted','reversed') THEN
    IF NEW.entry_number IS DISTINCT FROM OLD.entry_number OR NEW.entry_date IS DISTINCT FROM OLD.entry_date
       OR NEW.journal_id IS DISTINCT FROM OLD.journal_id OR NEW.fiscal_period_id IS DISTINCT FROM OLD.fiscal_period_id
       OR NEW.source_id IS DISTINCT FROM OLD.source_id OR NEW.source_kind IS DISTINCT FROM OLD.source_kind
       OR NEW.source_detail IS DISTINCT FROM OLD.source_detail OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.posted_at IS DISTINCT FROM OLD.posted_at OR NEW.posted_by IS DISTINCT FROM OLD.posted_by
       OR NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.reversal_of_entry_id IS DISTINCT FROM OLD.reversal_of_entry_id THEN
      RAISE EXCEPTION 'Écriture % comptabilisée : en-tête figé, utilisez l''extourne', OLD.entry_number USING ERRCODE = 'OF409';
    END IF;
    IF OLD.reversed_by_entry_id IS NOT NULL AND NEW.reversed_by_entry_id IS DISTINCT FROM OLD.reversed_by_entry_id THEN
      RAISE EXCEPTION 'Écriture % : le lien d''extourne ne se modifie pas', OLD.entry_number USING ERRCODE = 'OF409';
    END IF;
    IF OLD.status = 'reversed' AND NEW.status <> 'reversed' THEN
      RAISE EXCEPTION 'Écriture % déjà extournée', OLD.entry_number USING ERRCODE = 'OF409';
    END IF;
    IF OLD.status = 'posted' AND NEW.status NOT IN ('posted','reversed') THEN
      RAISE EXCEPTION 'Écriture % comptabilisée : retour en brouillon interdit', OLD.entry_number USING ERRCODE = 'OF409';
    END IF;
  END IF;
  IF OLD.chain_seq IS NOT NULL AND (NEW.chain_seq IS DISTINCT FROM OLD.chain_seq
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash OR NEW.chain_hash IS DISTINCT FROM OLD.chain_hash
       OR NEW.sealed_at IS DISTINCT FROM OLD.sealed_at) THEN
    RAISE EXCEPTION 'Écriture % scellée : empreinte non modifiable', OLD.entry_number USING ERRCODE = 'OF409';
  END IF;
  RETURN NEW;
END $$;

-- Lignes : libellé et ordre rejoignent compte, tiers et montants ; lettrage et
-- axes d'analyse (po_line_id, receipt_item_id, supplier_id) restent libres.
CREATE OR REPLACE FUNCTION trg_journal_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text; v_num text;
BEGIN
  SELECT status, entry_number INTO v_status, v_num FROM journal_entries
   WHERE id = CASE WHEN TG_OP = 'INSERT' THEN NEW.journal_entry_id ELSE OLD.journal_entry_id END;
  IF v_status IS NULL OR v_status = 'draft' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id
     AND NEW.auxiliary_id IS NOT DISTINCT FROM OLD.auxiliary_id AND NEW.debit = OLD.debit AND NEW.credit = OLD.credit
     AND NEW.journal_entry_id = OLD.journal_entry_id AND NEW.line_order = OLD.line_order
     AND NEW.label IS NOT DISTINCT FROM OLD.label THEN
    RETURN NEW;   -- lettrage et axes d'analyse : autorisés
  END IF;
  RAISE EXCEPTION 'Écriture % comptabilisée : lignes figées (hors lettrage)', v_num USING ERRCODE = 'OF409';
END $$;

-- Verrou de période : le scellement (colonnes de chaînage seules) passe même
-- sur une période verrouillée — il ne change rien au contenu.
CREATE OR REPLACE FUNCTION check_period_lock() RETURNS TRIGGER AS $$
DECLARE
  v_status VARCHAR(20);
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - ARRAY['chain_seq','content_hash','chain_hash','sealed_at'])
       = (to_jsonb(OLD) - ARRAY['chain_seq','content_hash','chain_hash','sealed_at']) THEN
    RETURN NEW;
  END IF;

  SELECT status INTO v_status
  FROM fiscal_periods
  WHERE id = NEW.fiscal_period_id;

  IF v_status = 'locked' THEN
    RAISE EXCEPTION 'Periode comptable verrouillee : modification impossible';
  END IF;

  IF v_status = 'closed' AND TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Periode comptable cloturee : nouvelle ecriture impossible';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ═══ 4. Contenu canonique et empreintes ═════════════════════════════════
-- Contenu figé d'une écriture, sérialisé en JSON (échappement sûr, ordre
-- stable). Exclus : statut, lien d'extourne, lettrage et axes d'analyse, qui
-- évoluent légitimement après validation. Horodatage en UTC pour ne pas
-- dépendre du fuseau de la session. Préfixe 'v1' : format versionné.
CREATE OR REPLACE FUNCTION fn_journal_entry_content(p_id uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_array(
           'v1', je.id::text, je.entry_number, j.code, to_char(je.entry_date, 'YYYY-MM-DD'),
           je.fiscal_period_id::text, COALESCE(je.description, ''), je.source_kind,
           COALESCE(je.source_id::text, ''), COALESCE(je.source_detail, ''),
           COALESCE(to_char(je.posted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), ''),
           COALESCE(je.posted_by::text, ''), COALESCE(je.store_id::text, ''),
           COALESCE(je.reversal_of_entry_id::text, ''),
           COALESCE((SELECT jsonb_agg(jsonb_build_array(
                               l.line_order, l.account_id::text, COALESCE(l.auxiliary_id::text, ''),
                               l.debit::text, l.credit::text, COALESCE(l.label, ''))
                             ORDER BY l.line_order)
                       FROM journal_entry_lines l WHERE l.journal_entry_id = je.id), '[]'::jsonb)
         )::text
    FROM journal_entries je
    JOIN journals j ON j.id = je.journal_id
   WHERE je.id = p_id
$$;
COMMENT ON FUNCTION fn_journal_entry_content(uuid) IS
  'Contenu canonique d''une écriture (mig 413) : base des empreintes de chaînage.';

-- Scelle les écritures comptabilisées non scellées, dans l'ordre de validation.
-- Un seul scellement à la fois (verrou consultatif de transaction).
CREATE OR REPLACE FUNCTION fn_ledger_seal(p_limit int DEFAULT NULL) RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  v_seq     bigint;
  v_prev    text;
  v_content text;
  r         record;
  n         int := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ofauria.ledger_seal'));
  SELECT je.chain_seq, je.chain_hash INTO v_seq, v_prev
    FROM journal_entries je WHERE je.chain_seq IS NOT NULL ORDER BY je.chain_seq DESC LIMIT 1;
  v_seq  := COALESCE(v_seq, 0);
  v_prev := COALESCE(v_prev, repeat('0', 64));
  FOR r IN
    SELECT je.id FROM journal_entries je
     WHERE je.chain_seq IS NULL AND je.status IN ('posted','reversed')
     ORDER BY COALESCE(je.posted_at, je.created_at), je.entry_number
     LIMIT p_limit
  LOOP
    v_content := encode(sha256(convert_to(fn_journal_entry_content(r.id), 'UTF8')), 'hex');
    v_seq  := v_seq + 1;
    v_prev := encode(sha256(convert_to(v_prev || v_content, 'UTF8')), 'hex');
    UPDATE journal_entries
       SET chain_seq = v_seq, content_hash = v_content, chain_hash = v_prev, sealed_at = now()
     WHERE id = r.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- Recalcule toute la chaîne et les ancres de clôture. Ne renvoie que les
-- anomalies (au plus p_max) : aucune ligne = grand livre intact.
CREATE OR REPLACE FUNCTION fn_ledger_verify(p_max int DEFAULT 100)
RETURNS TABLE (seq bigint, entry_id uuid, entry_no varchar, problem text) LANGUAGE plpgsql STABLE AS $$
DECLARE
  r          record;
  v_expected bigint := 0;
  v_prev     text := repeat('0', 64);
  n          int := 0;
BEGIN
  FOR r IN
    SELECT je.id, je.entry_number, je.chain_seq, je.content_hash, je.chain_hash, je.status
      FROM journal_entries je WHERE je.chain_seq IS NOT NULL ORDER BY je.chain_seq
  LOOP
    v_expected := v_expected + 1;
    seq := r.chain_seq; entry_id := r.id; entry_no := r.entry_number;
    IF r.chain_seq <> v_expected THEN
      problem := format('Rang %s manquant : écriture scellée supprimée ?', v_expected);
      RETURN NEXT; n := n + 1;
      v_expected := r.chain_seq;
    END IF;
    IF r.status NOT IN ('posted','reversed') THEN
      problem := 'Écriture scellée repassée en brouillon';
      RETURN NEXT; n := n + 1;
    END IF;
    IF encode(sha256(convert_to(fn_journal_entry_content(r.id), 'UTF8')), 'hex') <> r.content_hash THEN
      problem := 'Contenu modifié depuis le scellement';
      RETURN NEXT; n := n + 1;
    END IF;
    IF encode(sha256(convert_to(v_prev || r.content_hash, 'UTF8')), 'hex') <> r.chain_hash THEN
      problem := 'Chaînage rompu : empreinte altérée';
      RETURN NEXT; n := n + 1;
    END IF;
    v_prev := r.chain_hash;
    EXIT WHEN n >= p_max;
  END LOOP;

  -- Ancres : la tête de chaîne inscrite à chaque clôture doit toujours exister.
  FOR r IN
    SELECT e.chain_seq, e.chain_hash, fp.month, fp.year, je.id AS je_id, je.entry_number, je.chain_hash AS current_hash
      FROM fiscal_period_events e
      JOIN fiscal_periods fp ON fp.id = e.period_id
      LEFT JOIN journal_entries je ON je.chain_seq = e.chain_seq
     WHERE e.chain_seq IS NOT NULL
     ORDER BY e.at
  LOOP
    EXIT WHEN n >= p_max;
    IF r.current_hash IS DISTINCT FROM r.chain_hash THEN
      seq := r.chain_seq; entry_id := r.je_id; entry_no := r.entry_number;
      problem := format('Ancre de clôture %s/%s ne correspond plus au grand livre', lpad(r.month::text, 2, '0'), r.year);
      RETURN NEXT; n := n + 1;
    END IF;
  END LOOP;
  RETURN;
END $$;

-- ═══ 5. Ancrage à la clôture ════════════════════════════════════════════
-- Reprise de la mig 311 : on scelle avant d'inscrire l'événement, qui porte
-- désormais la tête de chaîne.
CREATE OR REPLACE FUNCTION trg_fiscal_period_status() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_prev text; v_seq bigint; v_hash text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF OLD.status = 'locked' THEN
    RAISE EXCEPTION 'Période %/% verrouillée : aucune transition possible', OLD.month, OLD.year USING ERRCODE = 'OF409';
  END IF;
  IF NEW.status = 'closed' AND OLD.status = 'open' THEN
    SELECT status INTO v_prev FROM fiscal_periods WHERE end_date = OLD.start_date - 1;
    IF v_prev = 'open' THEN
      RAISE EXCEPTION 'Clôturez d''abord la période précédente (%)', to_char(OLD.start_date - 1, 'MM/YYYY') USING ERRCODE = 'OF409';
    END IF;
  END IF;
  IF NEW.status = 'open' AND OLD.status = 'closed' THEN
    -- Réouverture : la période suivante ne doit pas être verrouillée.
    IF EXISTS (SELECT 1 FROM fiscal_periods WHERE start_date = OLD.end_date + 1 AND status = 'locked') THEN
      RAISE EXCEPTION 'La période suivante est verrouillée : réouverture impossible' USING ERRCODE = 'OF409';
    END IF;
  END IF;
  IF NEW.status IN ('closed','locked') THEN
    PERFORM fn_ledger_seal();
    SELECT je.chain_seq, je.chain_hash INTO v_seq, v_hash
      FROM journal_entries je WHERE je.chain_seq IS NOT NULL ORDER BY je.chain_seq DESC LIMIT 1;
  END IF;
  INSERT INTO fiscal_period_events (period_id, from_status, to_status, user_id, note, checklist, chain_seq, chain_hash)
  VALUES (OLD.id, OLD.status, NEW.status, NULLIF(current_setting('app.user_id', true), '')::uuid,
          NULLIF(current_setting('app.period_note', true), ''),
          NULLIF(current_setting('app.period_checklist', true), '')::jsonb,
          v_seq, v_hash);
  RETURN NEW;
END $$;

-- ═══ 6. Journal d'audit des actions comptables ══════════════════════════
CREATE TABLE IF NOT EXISTS ledger_audit_log (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  event        varchar(20) NOT NULL CHECK (event IN (
                 'post', 'reverse', 'draft_delete', 'letter', 'unletter', 'reletter',
                 'seal', 'verify', 'outbox_replay')),
  entry_id     uuid,          -- sans clé étrangère : un brouillon supprimé garde sa trace
  entry_number varchar(50),
  line_id      uuid,
  lettrage_id  uuid,
  actor        uuid REFERENCES users(id) ON DELETE SET NULL,
  client_ip    inet,
  details      jsonb
);
CREATE INDEX IF NOT EXISTS idx_lal_at       ON ledger_audit_log (at DESC);
CREATE INDEX IF NOT EXISTS idx_lal_entry    ON ledger_audit_log (entry_id) WHERE entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lal_lettrage ON ledger_audit_log (lettrage_id) WHERE lettrage_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lal_event    ON ledger_audit_log (event, at DESC);
COMMENT ON TABLE ledger_audit_log IS
  'Journal ajout seul des actions comptables (mig 413) : validation, extourne, lettrage, scellement, vérification, rejeu.';

-- La fonction partagée (mig 304) citait purchasing_master_audit pour toutes les
-- tables qui l'emploient : elle nomme désormais la table visée.
CREATE OR REPLACE FUNCTION trg_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% est en ajout seul (append-only)', TG_TABLE_NAME;
END $$;

DROP TRIGGER IF EXISTS ledger_audit_log_append_only ON ledger_audit_log;
CREATE TRIGGER ledger_audit_log_append_only BEFORE UPDATE OR DELETE ON ledger_audit_log
  FOR EACH ROW EXECUTE FUNCTION trg_audit_append_only();

-- Auteur posé par l'API (setAuditUser), sinon NULL = système.
CREATE OR REPLACE FUNCTION fn_ledger_actor() RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE v text := current_setting('app.user_id', true);
BEGIN
  IF v ~ '^[0-9a-fA-F-]{36}$' THEN RETURN v::uuid; END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION trg_journal_entry_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO ledger_audit_log (event, entry_id, entry_number, actor, details)
    VALUES ('draft_delete', OLD.id, OLD.entry_number, fn_ledger_actor(),
            jsonb_build_object('source_kind', OLD.source_kind, 'source_id', OLD.source_id));
    RETURN OLD;
  END IF;
  IF NEW.status = 'posted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'posted') THEN
    INSERT INTO ledger_audit_log (event, entry_id, entry_number, actor, details)
    VALUES ('post', NEW.id, NEW.entry_number, COALESCE(fn_ledger_actor(), NEW.posted_by),
            jsonb_build_object('source_kind', NEW.source_kind, 'source_id', NEW.source_id,
                               'total', (SELECT COALESCE(sum(debit), 0) FROM journal_entry_lines WHERE journal_entry_id = NEW.id)));
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'posted' AND NEW.status = 'reversed' THEN
    INSERT INTO ledger_audit_log (event, entry_id, entry_number, actor, details)
    VALUES ('reverse', NEW.id, NEW.entry_number, fn_ledger_actor(),
            jsonb_build_object('reversed_by_entry_id', NEW.reversed_by_entry_id,
                               'reversed_by_number', (SELECT entry_number FROM journal_entries WHERE id = NEW.reversed_by_entry_id)));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_journal_entry_audit ON journal_entries;
CREATE TRIGGER trg_journal_entry_audit AFTER INSERT OR UPDATE OF status OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION trg_journal_entry_audit();

CREATE OR REPLACE FUNCTION trg_journal_line_lettrage_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO ledger_audit_log (event, entry_id, entry_number, line_id, lettrage_id, actor, details)
  SELECT CASE WHEN OLD.lettrage_id IS NULL THEN 'letter' WHEN NEW.lettrage_id IS NULL THEN 'unletter' ELSE 'reletter' END,
         NEW.journal_entry_id, je.entry_number, NEW.id, COALESCE(NEW.lettrage_id, OLD.lettrage_id), fn_ledger_actor(),
         jsonb_build_object('from', OLD.lettrage_id, 'to', NEW.lettrage_id, 'debit', NEW.debit, 'credit', NEW.credit)
    FROM journal_entries je WHERE je.id = NEW.journal_entry_id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_journal_line_lettrage_audit ON journal_entry_lines;
CREATE TRIGGER trg_journal_line_lettrage_audit AFTER UPDATE OF lettrage_id ON journal_entry_lines
  FOR EACH ROW WHEN (OLD.lettrage_id IS DISTINCT FROM NEW.lettrage_id)
  EXECUTE FUNCTION trg_journal_line_lettrage_audit();

-- ═══ 7. Tâche planifiée ═════════════════════════════════════════════════
INSERT INTO scheduled_jobs (key, label, description, domain, interval_minutes, display_order) VALUES
  ('ledger_seal', 'Scellement des écritures',
   'Chaîne par empreinte (SHA-256) les écritures comptabilisées qui ne le sont pas encore : toute retouche ultérieure se verra à la vérification.',
   'accounting', 15, 60)
ON CONFLICT (key) DO NOTHING;

-- ═══ 8. Scellement initial de l'historique ══════════════════════════════
SELECT fn_ledger_seal();
INSERT INTO ledger_audit_log (event, details)
SELECT 'seal', jsonb_build_object('initial', true, 'sealed', count(*), 'head_seq', max(chain_seq))
  FROM journal_entries WHERE chain_seq IS NOT NULL;
