-- Migration 180 : Journaux comptables + periodes fiscales + sequences
--
-- POURQUOI
--   Toute ecriture comptable est rattachee a un journal (achats AC, ventes VE,
--   banque BQ, caisse CA, operations diverses OD) et a une periode fiscale
--   (typiquement le mois). La numerotation est sequentielle sans trou par
--   journal et par exercice (exigence DGI).
--
-- PORTEE
--   Tables nouvelles uniquement : journals, fiscal_periods, journal_sequences.
--   Une fonction d'allocation atomique next_entry_number().
--   Seed des 5 journaux standards + creation des periodes 2026.
--
-- INVERSION
--   DROP TABLE journal_sequences; DROP TABLE fiscal_periods; DROP TABLE journals;
--   DROP FUNCTION next_entry_number(UUID, SMALLINT);

-- ============================================================================
-- 1. Table journals
-- ============================================================================
CREATE TABLE IF NOT EXISTS journals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          VARCHAR(10) NOT NULL UNIQUE,
  label         VARCHAR(100) NOT NULL,
  kind          VARCHAR(20) NOT NULL
    CHECK (kind IN ('purchase','sales','bank','cash','misc')),
  -- Compte contrepartie par defaut (4411 pour AC, 5141 pour BQ, etc.)
  default_counterpart_account_id UUID REFERENCES accounts(id),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  display_order SMALLINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_journals_kind ON journals(kind);

COMMENT ON TABLE journals IS
  'Journaux comptables. Le kind regroupe par nature : achats, ventes, banque, caisse, divers.';

-- Seed des 5 journaux standards (idempotent)
INSERT INTO journals (code, label, kind, default_counterpart_account_id, display_order) VALUES
  ('AC', 'Journal des achats',         'purchase', (SELECT id FROM accounts WHERE code = '4411'), 1),
  ('VE', 'Journal des ventes',         'sales',    (SELECT id FROM accounts WHERE code = '3421'), 2),
  ('BQ', 'Journal de banque',          'bank',     (SELECT id FROM accounts WHERE code = '5141'), 3),
  ('CA', 'Journal de caisse',          'cash',     (SELECT id FROM accounts WHERE code = '5161'), 4),
  ('OD', 'Operations diverses',        'misc',     NULL,                                          5)
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- 2. Table fiscal_periods
-- ============================================================================
-- Une periode = un mois calendaire. status :
--   - open    : ecritures modifiables, possible d'en ajouter
--   - closed  : verrou souple (les ecritures existantes restent, plus aucune
--               nouvelle ne peut etre creee dans cette periode)
--   - locked  : verrou dur (rien ne bouge, meme pas via OD d'extourne. Reserve
--               apres validation par expert-comptable)
--
-- La cloture est progressive : un mois clos n'empeche pas un mois ulterieur
-- d'etre encore ouvert (cas standard : juin clos, juillet en cours).

CREATE TABLE IF NOT EXISTS fiscal_periods (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year        SMALLINT NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  month       SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','closed','locked')),
  closed_at   TIMESTAMPTZ,
  closed_by   UUID REFERENCES users(id),
  closed_note TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (year, month),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_fiscal_periods_dates  ON fiscal_periods(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_fiscal_periods_status ON fiscal_periods(status);

COMMENT ON TABLE fiscal_periods IS
  'Periodes fiscales mensuelles. Une ecriture ne peut exister que dans une periode existante avec status != locked.';
COMMENT ON COLUMN fiscal_periods.status IS
  'open : ecritures libres. closed : plus d''insertion (correctifs via OD). locked : verrou dur post-validation expert-comptable.';

-- Seed : creation automatique de l'annee en cours et de l'annee precedente
-- (toutes ouvertes par defaut, l'admin clora manuellement les mois passes).
DO $$
DECLARE
  v_year  SMALLINT := EXTRACT(YEAR FROM CURRENT_DATE)::SMALLINT;
  v_month SMALLINT;
  v_start DATE;
  v_end   DATE;
BEGIN
  -- Annee precedente
  FOR v_month IN 1..12 LOOP
    v_start := MAKE_DATE(v_year - 1, v_month, 1);
    v_end   := (v_start + INTERVAL '1 month - 1 day')::DATE;
    INSERT INTO fiscal_periods (year, month, start_date, end_date, status)
    VALUES (v_year - 1, v_month, v_start, v_end, 'open')
    ON CONFLICT (year, month) DO NOTHING;
  END LOOP;

  -- Annee en cours
  FOR v_month IN 1..12 LOOP
    v_start := MAKE_DATE(v_year, v_month, 1);
    v_end   := (v_start + INTERVAL '1 month - 1 day')::DATE;
    INSERT INTO fiscal_periods (year, month, start_date, end_date, status)
    VALUES (v_year, v_month, v_start, v_end, 'open')
    ON CONFLICT (year, month) DO NOTHING;
  END LOOP;
END $$;

-- ============================================================================
-- 3. Table journal_sequences + fonction d'allocation atomique
-- ============================================================================
-- Format des numeros : {journal_code}-{year}-{seq:5d}
--   Ex : AC-2026-00001, VE-2026-00042
--
-- L'allocation passe par INSERT ... ON CONFLICT DO UPDATE RETURNING current_seq,
-- qui est atomique a l'echelle Postgres et evite tout besoin de SELECT FOR UPDATE
-- explicite. Une concurrence elevee ne genere ni trou ni doublon.

CREATE TABLE IF NOT EXISTS journal_sequences (
  journal_id   UUID NOT NULL REFERENCES journals(id),
  year         SMALLINT NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  current_seq  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (journal_id, year)
);

COMMENT ON TABLE journal_sequences IS
  'Compteur sequentiel par journal et par annee. Sans trou (exigence DGI).';

CREATE OR REPLACE FUNCTION next_entry_number(p_journal_id UUID, p_year SMALLINT)
RETURNS VARCHAR AS $$
DECLARE
  v_seq  INT;
  v_code VARCHAR(10);
BEGIN
  INSERT INTO journal_sequences (journal_id, year, current_seq)
    VALUES (p_journal_id, p_year, 1)
    ON CONFLICT (journal_id, year)
    DO UPDATE SET current_seq = journal_sequences.current_seq + 1
    RETURNING current_seq INTO v_seq;

  SELECT code INTO v_code FROM journals WHERE id = p_journal_id;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Journal % introuvable', p_journal_id;
  END IF;

  RETURN v_code || '-' || p_year || '-' || LPAD(v_seq::TEXT, 5, '0');
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION next_entry_number(UUID, SMALLINT) IS
  'Alloue atomiquement le prochain numero pour un journal/annee. Format JR-YYYY-NNNNN.';
