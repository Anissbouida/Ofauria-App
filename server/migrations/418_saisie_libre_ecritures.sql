-- ═══════════════════════════════════════════════════════════════════════
-- 418 — Saisie libre d'écritures (lot Essentiel 4)
--
-- POURQUOI
--   On ne pouvait passer une opération diverse qu'à travers un modèle
--   d'écriture (mig 391). La saisie libre (Sage : saisie au kilomètre) a
--   besoin d'une pièce justificative (exigée par le FEC, avis CNC n° 24) et
--   d'un brouillon qui ne consomme pas de numéro : les numéros de journal
--   doivent rester continus, or un brouillon abandonné laissait un trou.
--
-- PORTÉE
--   1. journal_entries.piece_ref / piece_date : référence et date de la pièce
--      justificative saisie (facture papier, relevé, PV d'assemblée…).
--   2. Brouillon numéroté provisoirement « BROUILLON-… » ; le vrai numéro
--      (next_entry_number) n'est attribué qu'à la comptabilisation. Une
--      contrainte interdit de comptabiliser sous un numéro provisoire.
--   3. Garde d'en-tête (mig 413) étendue : la pièce est figée à la validation.
--   4. Empreinte (fn_journal_entry_content, mig 413) : la pièce entre dans le
--      contenu canonique quand elle est renseignée. Les écritures existantes,
--      sans pièce, gardent exactement le même contenu (chaîne intacte).
--
-- INVERSION
--   ALTER TABLE journal_entries DROP CONSTRAINT journal_entries_draft_number_check,
--     DROP COLUMN piece_ref, DROP COLUMN piece_date ;
--   rejouer trg_journal_entry_guard et fn_journal_entry_content de la mig 413.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS piece_ref  varchar(60),
  ADD COLUMN IF NOT EXISTS piece_date date;
COMMENT ON COLUMN journal_entries.piece_ref IS 'Référence de la pièce justificative saisie (mig 418) ; à défaut, le FEC remonte au document source.';

ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_draft_number_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_draft_number_check
  CHECK (status = 'draft' OR entry_number NOT LIKE 'BROUILLON-%');

-- Garde d'en-tête : reprise de la mig 413, la pièce rejoint les champs figés.
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
       OR NEW.reversal_of_entry_id IS DISTINCT FROM OLD.reversal_of_entry_id
       OR NEW.piece_ref IS DISTINCT FROM OLD.piece_ref OR NEW.piece_date IS DISTINCT FROM OLD.piece_date THEN
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

-- Contenu canonique : format v1 de la mig 413 inchangé, suivi de la pièce
-- seulement quand elle est renseignée (les empreintes existantes restent valides).
CREATE OR REPLACE FUNCTION fn_journal_entry_content(p_id uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT (jsonb_build_array(
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
         )
         || CASE WHEN je.piece_ref IS NOT NULL OR je.piece_date IS NOT NULL
                 THEN jsonb_build_array('piece', COALESCE(je.piece_ref, ''), COALESCE(to_char(je.piece_date, 'YYYY-MM-DD'), ''))
                 ELSE '[]'::jsonb END
         )::text
    FROM journal_entries je
    JOIN journals j ON j.id = je.journal_id
   WHERE je.id = p_id
$$;
