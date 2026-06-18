-- Migration 181 : Ecritures comptables en partie double
--
-- POURQUOI
--   Le coeur du systeme : chaque evenement metier (facture, paiement, vente)
--   genere une ecriture composee de plusieurs lignes debit/credit qui
--   s'equilibrent (somme debits = somme credits). C'est la base de toute
--   sortie reglementaire : grand livre, balance, CPC, bilan, FEC.
--
-- PORTEE
--   Deux tables nouvelles : journal_entries (en-tete) + journal_entry_lines.
--   Trigger d'equilibre verifiant SUM(D) = SUM(C) au moment du passage en
--   status='posted'.
--   Trigger anti-modification sur les periodes locked.
--
-- INVERSION
--   DROP TABLE journal_entry_lines; DROP TABLE journal_entries;
--   DROP FUNCTION check_journal_entry_balance(); DROP FUNCTION check_period_lock();

-- ============================================================================
-- 1. Table journal_entries (en-tete ecriture)
-- ============================================================================
CREATE TABLE IF NOT EXISTS journal_entries (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number         VARCHAR(50) NOT NULL UNIQUE,
  journal_id           UUID NOT NULL REFERENCES journals(id),
  entry_date           DATE NOT NULL,
  fiscal_period_id     UUID NOT NULL REFERENCES fiscal_periods(id),
  description          TEXT,

  -- Tracabilite vers l'evenement metier source
  -- 'manual'   : OD saisie manuellement
  -- 'invoice'  : facture (emitted/received)
  -- 'payment'  : paiement (espece, virement, cheque)
  -- 'sale'     : vente POS
  -- 'reversal' : ecriture d'extourne
  -- 'backfill' : genere par script de backfill historique
  source_kind          VARCHAR(30) NOT NULL DEFAULT 'manual'
    CHECK (source_kind IN ('manual','invoice','payment','sale','reversal','backfill')),
  source_id            UUID,

  -- Workflow : draft -> posted -> reversed
  -- draft    : modifiable, non comptabilisee, n'apparait pas en balance
  -- posted   : comptabilisee, immuable hors extourne
  -- reversed : ecriture annulee par une ecriture d'extourne
  status               VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','posted','reversed')),
  posted_at            TIMESTAMPTZ,
  posted_by            UUID REFERENCES users(id),
  reversed_by_entry_id UUID REFERENCES journal_entries(id),

  -- Isolation multi-magasin (suit la convention de invoices.store_id)
  store_id             UUID REFERENCES stores(id),

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by           UUID REFERENCES users(id),

  -- Coherence : si status = posted, posted_at et posted_by doivent etre remplis
  CHECK (status <> 'posted' OR (posted_at IS NOT NULL AND posted_by IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_je_date         ON journal_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_je_journal      ON journal_entries(journal_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_je_period       ON journal_entries(fiscal_period_id);
CREATE INDEX IF NOT EXISTS idx_je_source       ON journal_entries(source_kind, source_id);
CREATE INDEX IF NOT EXISTS idx_je_status       ON journal_entries(status);
CREATE INDEX IF NOT EXISTS idx_je_store        ON journal_entries(store_id);

COMMENT ON TABLE journal_entries IS
  'En-tete d''une ecriture comptable. Les lignes sont dans journal_entry_lines.';
COMMENT ON COLUMN journal_entries.source_kind IS
  'Origine de l''ecriture : manual (OD), invoice, payment, sale, reversal (extourne), backfill (script historique).';
COMMENT ON COLUMN journal_entries.status IS
  'draft : non comptabilise, modifiable. posted : comptabilise, immuable. reversed : annule par extourne.';

-- ============================================================================
-- 2. Table journal_entry_lines (lignes debit/credit)
-- ============================================================================
CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id  UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  line_order        SMALLINT NOT NULL,
  account_id        UUID NOT NULL REFERENCES accounts(id),
  -- Tiers (obligatoire si le compte est is_collective)
  auxiliary_id      UUID REFERENCES account_auxiliaries(id),
  debit             DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK (debit  >= 0),
  credit            DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  label             VARCHAR(200),
  -- Lettrage : un meme UUID partage par toutes les lignes lettrees ensemble.
  -- Utilise principalement pour les comptes de tiers (3421, 4411) afin de
  -- savoir quelles factures sont reglees et lesquelles restent ouvertes.
  lettrage_id       UUID,
  -- Une ligne est soit debit soit credit, jamais les deux a la fois.
  CHECK (NOT (debit > 0 AND credit > 0)),
  -- Une ligne ne peut pas etre nulle des deux cotes a la fois.
  CHECK (debit > 0 OR credit > 0),
  UNIQUE (journal_entry_id, line_order)
);

CREATE INDEX IF NOT EXISTS idx_jel_entry    ON journal_entry_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_jel_account  ON journal_entry_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_jel_aux      ON journal_entry_lines(auxiliary_id);
-- Index partiel sur le lettrage : optimisation des requetes "solde non lettre"
CREATE INDEX IF NOT EXISTS idx_jel_lettrage_null
  ON journal_entry_lines(auxiliary_id) WHERE lettrage_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_jel_lettrage
  ON journal_entry_lines(lettrage_id) WHERE lettrage_id IS NOT NULL;

COMMENT ON TABLE journal_entry_lines IS
  'Lignes d''une ecriture. Chaque ligne porte un compte et un montant en debit OU en credit (jamais les deux).';
COMMENT ON COLUMN journal_entry_lines.lettrage_id IS
  'Lettrage : meme UUID sur N lignes de tiers qui s''equilibrent (facture <-> reglement).';

-- ============================================================================
-- 3. Trigger d'equilibre debit/credit au passage en posted
-- ============================================================================
-- Garantit qu'aucune ecriture ne peut etre comptabilisee si elle n'est pas
-- equilibree. En mode draft, le desequilibre est tolere (saisie en cours).

CREATE OR REPLACE FUNCTION check_journal_entry_balance() RETURNS TRIGGER AS $$
DECLARE
  v_debit  DECIMAL(14,2);
  v_credit DECIMAL(14,2);
  v_collective BOOLEAN;
  v_aux_id UUID;
BEGIN
  -- Verification declenchee uniquement au passage en posted
  IF NEW.status = 'posted' AND (OLD IS NULL OR OLD.status <> 'posted') THEN
    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO v_debit, v_credit
    FROM journal_entry_lines
    WHERE journal_entry_id = NEW.id;

    IF v_debit <> v_credit THEN
      RAISE EXCEPTION 'Ecriture % non equilibree : debit=% credit=%',
        NEW.entry_number, v_debit, v_credit;
    END IF;

    IF v_debit = 0 THEN
      RAISE EXCEPTION 'Ecriture % vide : impossible de comptabiliser sans lignes', NEW.entry_number;
    END IF;

    -- Verification : tout compte collectif doit avoir un auxiliary_id
    FOR v_collective, v_aux_id IN
      SELECT a.is_collective, jel.auxiliary_id
      FROM journal_entry_lines jel
      JOIN accounts a ON a.id = jel.account_id
      WHERE jel.journal_entry_id = NEW.id
    LOOP
      IF v_collective AND v_aux_id IS NULL THEN
        RAISE EXCEPTION 'Ecriture % : ligne sur compte collectif sans auxiliary_id', NEW.entry_number;
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_journal_entry_balance ON journal_entries;
CREATE TRIGGER trg_check_journal_entry_balance
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION check_journal_entry_balance();

-- ============================================================================
-- 4. Trigger anti-modification sur periodes locked
-- ============================================================================
-- Une periode 'locked' refuse toute insertion/update d'ecriture.
-- Une periode 'closed' refuse l'insertion d'une nouvelle ecriture mais permet
-- aux ecritures existantes en draft d'etre passees en posted (cas correctif).

CREATE OR REPLACE FUNCTION check_period_lock() RETURNS TRIGGER AS $$
DECLARE
  v_status VARCHAR(20);
BEGIN
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

DROP TRIGGER IF EXISTS trg_check_period_lock ON journal_entries;
CREATE TRIGGER trg_check_period_lock
  BEFORE INSERT OR UPDATE ON journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION check_period_lock();
