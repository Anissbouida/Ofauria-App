-- ═══════════════════════════════════════════════════════════════════════
-- 420 — Lettrage manuel : cohérence des groupes garantie par la base
-- ═══════════════════════════════════════════════════════════════════════
-- Un groupe de lettrage (lignes partageant un lettrage_id) rapproche des
-- factures et des règlements qui se soldent. Le lettrage automatique
-- (facture ↔ paiements, écriture ↔ extourne) et désormais le lettrage
-- manuel l'alimentent ; cette garde vérifie, en fin de transaction, que
-- tout groupe touché reste :
--   - d'au moins deux lignes,
--   - sur un seul compte et un seul tiers,
--   - soldé au centime (débit = crédit),
--   - fait de lignes d'écritures comptabilisées (jamais un brouillon).
-- Un délettrage partiel qui laisserait un reste déséquilibré est refusé :
-- on délettre le groupe entier.
--
-- Contrôle différé (CONSTRAINT TRIGGER … INITIALLY DEFERRED), comme une
-- contrainte Oracle DEFERRABLE : les lignes d'un groupe sont posées une à
-- une, le groupe n'est jugé qu'au COMMIT.
--
-- Rollback : DROP TRIGGER trg_lettrage_coherence ON journal_entry_lines ;
--            DROP FUNCTION trg_lettrage_coherence(), fn_lettrage_check(uuid).
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_lettrage_check(p_lettrage uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  g record;
BEGIN
  IF p_lettrage IS NULL THEN RETURN; END IF;
  SELECT count(*) AS n,
         count(DISTINCT jel.account_id) AS accounts,
         count(DISTINCT COALESCE(jel.auxiliary_id::text, '-')) AS tiers,
         COALESCE(sum(jel.debit - jel.credit), 0) AS solde,
         count(*) FILTER (WHERE je.status NOT IN ('posted', 'reversed')) AS drafts
    INTO g
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
   WHERE jel.lettrage_id = p_lettrage;
  IF g.n = 0 THEN RETURN; END IF;   -- groupe entièrement délettré
  IF g.n < 2 THEN
    RAISE EXCEPTION 'Lettrage incohérent : un groupe compte au moins deux lignes (délettrez le groupe entier)' USING ERRCODE = 'OF409';
  END IF;
  IF g.accounts > 1 OR g.tiers > 1 THEN
    RAISE EXCEPTION 'Lettrage incohérent : les lignes d''un groupe portent sur un seul compte et un seul tiers' USING ERRCODE = 'OF409';
  END IF;
  IF g.solde <> 0 THEN
    RAISE EXCEPTION 'Lettrage incohérent : groupe non soldé (écart %)', g.solde USING ERRCODE = 'OF409';
  END IF;
  IF g.drafts > 0 THEN
    RAISE EXCEPTION 'Lettrage incohérent : une écriture en brouillon ne se lettre pas' USING ERRCODE = 'OF409';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION trg_lettrage_coherence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.lettrage_id IS DISTINCT FROM NEW.lettrage_id THEN
    PERFORM fn_lettrage_check(OLD.lettrage_id);
  END IF;
  PERFORM fn_lettrage_check(NEW.lettrage_id);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_lettrage_coherence ON journal_entry_lines;
CREATE CONSTRAINT TRIGGER trg_lettrage_coherence
  AFTER INSERT OR UPDATE OF lettrage_id ON journal_entry_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_lettrage_coherence();

COMMENT ON FUNCTION fn_lettrage_check(uuid) IS
  'Mig 420 : un groupe de lettrage = au moins 2 lignes, un compte, un tiers, soldé, écritures comptabilisées.';
