-- ═══════════════════════════════════════════════════════════════════════
-- 466 — Lettrage partiel (audit O2C, G-CA-04)
-- ═══════════════════════════════════════════════════════════════════════
-- Un règlement partiel laissait la facture et son acompte « à lettrer » côte
-- à côte, sans lien entre eux : la balance âgée devait retrouver la pièce par
-- le lien des documents, et l'écran Lettrage ne montrait pas qu'un
-- rapprochement était en cours. Comme la lettre minuscule de Sage ou le
-- « partial reconcile » d'Odoo, un PRÉ-LETTRAGE rapproche la pièce et ses
-- acomptes sans attendre le solde :
--   - lettrage_partiel_id : groupe de lignes d'un même compte et d'un même
--     tiers qui se rapprochent sans se solder ; leur solde est le reste dû ;
--   - une ligne est lettrée (lettrage_id) ou pré-lettrée, jamais les deux ;
--   - un groupe pré-lettré qui se solde DEVIENT un lettrage : l'application le
--     promeut, et la base refuse un pré-lettrage soldé ;
--   - garde différée comme la mig 420 (contrainte Oracle DEFERRABLE) : au moins
--     deux lignes, un compte, un tiers, écritures comptabilisées, non soldé.
-- Journal d'audit : événements letter_partial / unletter_partial (le groupe
-- partiel est porté par la colonne lettrage_id du journal, details.partial).
-- Hors FEC (EcritureLet = lettrage définitif) et hors empreinte de chaînage
-- (mig 413 : le lettrage ne fait pas partie du contenu figé d'une écriture).
--
-- Rollback : DROP TRIGGER trg_lettrage_partiel_coherence, trg_journal_line_lettrage_partiel_audit
--   ON journal_entry_lines ; DROP FUNCTION trg_lettrage_partiel_coherence(),
--   fn_lettrage_partiel_check(uuid), fn_lettrage_partiel_tidy(uuid),
--   trg_journal_line_lettrage_partiel_audit() ; ALTER TABLE journal_entry_lines
--   DROP COLUMN lettrage_partiel_id ; remettre la contrainte
--   ledger_audit_log_event_check de la mig 417 (sans les deux événements).
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS lettrage_partiel_id uuid;
CREATE INDEX IF NOT EXISTS idx_jel_lettrage_partiel ON journal_entry_lines (lettrage_partiel_id)
  WHERE lettrage_partiel_id IS NOT NULL;
ALTER TABLE journal_entry_lines DROP CONSTRAINT IF EXISTS chk_jel_lettrage_exclusif;
ALTER TABLE journal_entry_lines ADD CONSTRAINT chk_jel_lettrage_exclusif
  CHECK (lettrage_id IS NULL OR lettrage_partiel_id IS NULL);
COMMENT ON COLUMN journal_entry_lines.lettrage_partiel_id IS
  'Mig 466 : pré-lettrage (lettre minuscule) — pièce et acomptes rapprochés sans être soldés ; promu en lettrage_id au solde.';

-- ═══ 1. Garde différée : cohérence d'un groupe pré-lettré ══════════════
CREATE OR REPLACE FUNCTION fn_lettrage_partiel_check(p_group uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  g record;
BEGIN
  IF p_group IS NULL THEN RETURN; END IF;
  SELECT count(*) AS n,
         count(DISTINCT jel.account_id) AS accounts,
         count(DISTINCT COALESCE(jel.auxiliary_id::text, '-')) AS tiers,
         COALESCE(sum(jel.debit - jel.credit), 0) AS solde,
         count(*) FILTER (WHERE je.status NOT IN ('posted', 'reversed')) AS drafts
    INTO g
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
   WHERE jel.lettrage_partiel_id = p_group;
  IF g.n = 0 THEN RETURN; END IF;   -- groupe entièrement défait
  IF g.n < 2 THEN
    RAISE EXCEPTION 'Pré-lettrage incohérent : un groupe compte au moins deux lignes' USING ERRCODE = 'OF409';
  END IF;
  IF g.accounts > 1 OR g.tiers > 1 THEN
    RAISE EXCEPTION 'Pré-lettrage incohérent : les lignes d''un groupe portent sur un seul compte et un seul tiers' USING ERRCODE = 'OF409';
  END IF;
  IF g.solde = 0 THEN
    RAISE EXCEPTION 'Pré-lettrage incohérent : groupe soldé — il se lettre définitivement' USING ERRCODE = 'OF409';
  END IF;
  IF g.drafts > 0 THEN
    RAISE EXCEPTION 'Pré-lettrage incohérent : une écriture en brouillon ne se lettre pas' USING ERRCODE = 'OF409';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION trg_lettrage_partiel_coherence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.lettrage_partiel_id IS DISTINCT FROM NEW.lettrage_partiel_id THEN
    PERFORM fn_lettrage_partiel_check(OLD.lettrage_partiel_id);
  END IF;
  PERFORM fn_lettrage_partiel_check(NEW.lettrage_partiel_id);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_lettrage_partiel_coherence ON journal_entry_lines;
CREATE CONSTRAINT TRIGGER trg_lettrage_partiel_coherence
  AFTER INSERT OR UPDATE OF lettrage_partiel_id ON journal_entry_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_lettrage_partiel_coherence();

COMMENT ON FUNCTION fn_lettrage_partiel_check(uuid) IS
  'Mig 466 : un groupe pré-lettré = au moins 2 lignes, un compte, un tiers, NON soldé, écritures comptabilisées.';

-- ═══ 2. Remise d'aplomb d'un groupe dont des lignes sont parties ═════════
-- Quand une ligne quitte son groupe (promotion en lettrage, extourne d'un
-- acompte), le reste peut n'avoir plus qu'une ligne — on le dissout — ou se
-- trouver soldé — on le promeut en lettrage définitif. Appelée par
-- l'application avant le COMMIT ; retourne le nombre de lignes touchées.
CREATE OR REPLACE FUNCTION fn_lettrage_partiel_tidy(p_group uuid) RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  v_n int;
  v_solde numeric;
BEGIN
  IF p_group IS NULL THEN RETURN 0; END IF;
  SELECT count(*), COALESCE(sum(debit - credit), 0) INTO v_n, v_solde
    FROM journal_entry_lines WHERE lettrage_partiel_id = p_group;
  IF v_n = 1 THEN
    UPDATE journal_entry_lines SET lettrage_partiel_id = NULL WHERE lettrage_partiel_id = p_group;
    RETURN 1;
  END IF;
  IF v_n >= 2 AND v_solde = 0 THEN
    UPDATE journal_entry_lines SET lettrage_id = gen_random_uuid(), lettrage_partiel_id = NULL
     WHERE lettrage_partiel_id = p_group;
    RETURN v_n;
  END IF;
  RETURN 0;
END $$;

COMMENT ON FUNCTION fn_lettrage_partiel_tidy(uuid) IS
  'Mig 466 : dissout un groupe pré-lettré réduit à une ligne, promeut en lettrage un groupe devenu soldé.';

-- ═══ 3. Journal d'audit ═════════════════════════════════════════════════
-- La contrainte sur event a changé de nom au fil des migrations (413, 416,
-- 417) : on retire celle qui existe, quel que soit son nom, puis on la repose.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'ledger_audit_log'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%event%'
  LOOP
    EXECUTE format('ALTER TABLE ledger_audit_log DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE ledger_audit_log ADD CONSTRAINT ledger_audit_log_event_check CHECK (event IN (
  'post', 'reverse', 'draft_delete', 'letter', 'unletter', 'reletter',
  'seal', 'verify', 'outbox_replay', 'year_close', 'fec_export',
  'letter_partial', 'unletter_partial'));

CREATE OR REPLACE FUNCTION trg_journal_line_lettrage_partiel_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO ledger_audit_log (event, entry_id, entry_number, line_id, lettrage_id, actor, details)
  SELECT CASE WHEN NEW.lettrage_partiel_id IS NULL THEN 'unletter_partial' ELSE 'letter_partial' END,
         NEW.journal_entry_id, je.entry_number, NEW.id,
         COALESCE(NEW.lettrage_partiel_id, OLD.lettrage_partiel_id), fn_ledger_actor(),
         jsonb_build_object('partial', true, 'from', OLD.lettrage_partiel_id, 'to', NEW.lettrage_partiel_id,
                            'debit', NEW.debit, 'credit', NEW.credit)
    FROM journal_entries je WHERE je.id = NEW.journal_entry_id;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_journal_line_lettrage_partiel_audit ON journal_entry_lines;
CREATE TRIGGER trg_journal_line_lettrage_partiel_audit
  AFTER UPDATE OF lettrage_partiel_id ON journal_entry_lines
  FOR EACH ROW WHEN (OLD.lettrage_partiel_id IS DISTINCT FROM NEW.lettrage_partiel_id)
  EXECUTE FUNCTION trg_journal_line_lettrage_partiel_audit();
