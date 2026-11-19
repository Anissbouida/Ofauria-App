-- G6-03 (plan d'action 2026-11) — multi-société, phase 1 : numérotation par entité.
--
-- Les séries de numéros (document_sequences, mig 329) restent GLOBALES. Une entité peut
-- recevoir sa propre variante d'une série (document_sequence_entity_series) : modèle,
-- nombre de chiffres et remise à zéro propres, compteur propre
-- (document_sequence_entity_counters). Pas de ligne = la série globale s'applique,
-- exactement comme aujourd'hui.
--
-- next_document_number_v2(type, date, entité) / preview_document_number_v2(…) :
--   - entité NULL, ou aucune variante pour cette entité → délègue à next_document_number
--     (mig 329) : mêmes numéros, même compteur, même verrou ;
--   - sinon → numéro de la variante (verrou sur le compteur de l'entité, ROLLBACK rend le
--     numéro, reprise sur le plus grand numéro existant comme la série globale).
-- Pour que deux sociétés ne produisent jamais le même numéro dans la même table cible
-- (contraintes d'unicité sur invoice_number, order_number…), le modèle d'une variante doit
-- différer du modèle global et de celui des autres entités (contrôle dans la fonction et
-- index unique (doc_type, pattern)).
--
-- Fonctions NOUVELLES suffixées _v2 : next_document_number / preview_document_number
-- existent en prod avec un autre propriétaire, on ne les remplace pas.
--
-- INVERSION :
--   DROP FUNCTION IF EXISTS preview_document_number_v2(text, date, uuid);
--   DROP FUNCTION IF EXISTS next_document_number_v2(text, date, uuid);
--   DROP TABLE IF EXISTS document_sequence_entity_counters;
--   DROP TABLE IF EXISTS document_sequence_entity_series;

CREATE TABLE IF NOT EXISTS document_sequence_entity_series (
  doc_type        varchar(40) NOT NULL REFERENCES document_sequences(doc_type) ON DELETE CASCADE,
  legal_entity_id uuid        NOT NULL REFERENCES legal_entities(id) ON DELETE CASCADE,
  pattern         varchar(60) NOT NULL,
  padding         smallint    NOT NULL DEFAULT 4,
  reset_period    varchar(10) NOT NULL DEFAULT 'year',
  updated_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (doc_type, legal_entity_id),
  CONSTRAINT dses_padding_check CHECK (padding BETWEEN 1 AND 10),
  CONSTRAINT dses_reset_period_check CHECK (reset_period IN ('never', 'year', 'month', 'day')),
  CONSTRAINT dses_seq_once CHECK (pattern LIKE '%{SEQ}%'
    AND position('{SEQ}' IN substr(pattern, position('{SEQ}' IN pattern) + 5)) = 0),
  CONSTRAINT dses_period_tokens CHECK (
       reset_period = 'never'
    OR (reset_period = 'year'  AND (pattern LIKE '%{YYYY}%' OR pattern LIKE '%{YY}%'))
    OR (reset_period = 'month' AND (pattern LIKE '%{YYYY}%' OR pattern LIKE '%{YY}%') AND pattern LIKE '%{MM}%')
    OR (reset_period = 'day'   AND (pattern LIKE '%{YYYY}%' OR pattern LIKE '%{YY}%') AND pattern LIKE '%{MM}%' AND pattern LIKE '%{DD}%'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dses_pattern ON document_sequence_entity_series (doc_type, pattern);
COMMENT ON TABLE document_sequence_entity_series IS
  'G6-03 (mig 609) : variante d''une série de numéros pour une entité juridique ; pas de ligne = série globale.';

CREATE TABLE IF NOT EXISTS document_sequence_entity_counters (
  doc_type        varchar(40) NOT NULL,
  legal_entity_id uuid        NOT NULL,
  period_key      varchar(10) NOT NULL,
  last_value      bigint      NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (doc_type, legal_entity_id, period_key),
  FOREIGN KEY (doc_type, legal_entity_id)
    REFERENCES document_sequence_entity_series (doc_type, legal_entity_id) ON DELETE CASCADE
);

CREATE FUNCTION next_document_number_v2(p_doc_type text, p_date date, p_legal_entity_id uuid)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  s          document_sequences;
  e          document_sequence_entity_series;
  v_date     date := COALESCE(p_date, (now() AT TIME ZONE 'Africa/Casablanca')::date);
  v_period   text;
  v_rendered text;
  v_last     bigint;
  v_next     bigint;
BEGIN
  IF p_legal_entity_id IS NOT NULL THEN
    SELECT * INTO e FROM document_sequence_entity_series
     WHERE doc_type = p_doc_type AND legal_entity_id = p_legal_entity_id;
  END IF;
  IF p_legal_entity_id IS NULL OR e.doc_type IS NULL THEN
    RETURN next_document_number(p_doc_type, v_date);   -- série globale, comportement de la mig 329
  END IF;

  SELECT * INTO s FROM document_sequences WHERE doc_type = p_doc_type;
  IF s.pattern = e.pattern THEN
    RAISE EXCEPTION 'La série % de l''entité doit avoir un modèle différent de la série globale (%)', p_doc_type, s.pattern;
  END IF;
  s.pattern := e.pattern; s.padding := e.padding; s.reset_period := e.reset_period;
  v_period := document_period_key(s.reset_period, v_date);
  v_rendered := render_document_pattern(s.pattern, v_date);

  INSERT INTO document_sequence_entity_counters (doc_type, legal_entity_id, period_key)
  VALUES (p_doc_type, p_legal_entity_id, v_period) ON CONFLICT DO NOTHING;
  SELECT last_value INTO v_last FROM document_sequence_entity_counters
   WHERE doc_type = p_doc_type AND legal_entity_id = p_legal_entity_id AND period_key = v_period FOR UPDATE;

  v_next := GREATEST(v_last, document_number_max_existing(s, v_rendered)) + 1;
  UPDATE document_sequence_entity_counters SET last_value = v_next, updated_at = now()
   WHERE doc_type = p_doc_type AND legal_entity_id = p_legal_entity_id AND period_key = v_period;

  RETURN replace(v_rendered, '{SEQ}', lpad(v_next::text, GREATEST(s.padding, length(v_next::text)), '0'));
END $$;
COMMENT ON FUNCTION next_document_number_v2(text, date, uuid) IS
  'G6-03 : prochain numéro d''une série pour une entité (variante de l''entité, sinon série globale via next_document_number).';

CREATE FUNCTION preview_document_number_v2(p_doc_type text, p_date date, p_legal_entity_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE
  s          document_sequences;
  e          document_sequence_entity_series;
  v_date     date := COALESCE(p_date, (now() AT TIME ZONE 'Africa/Casablanca')::date);
  v_rendered text;
  v_next     bigint;
BEGIN
  IF p_legal_entity_id IS NOT NULL THEN
    SELECT * INTO e FROM document_sequence_entity_series
     WHERE doc_type = p_doc_type AND legal_entity_id = p_legal_entity_id;
  END IF;
  IF p_legal_entity_id IS NULL OR e.doc_type IS NULL THEN
    RETURN preview_document_number(p_doc_type, v_date);
  END IF;
  SELECT * INTO s FROM document_sequences WHERE doc_type = p_doc_type;
  IF NOT FOUND THEN RETURN NULL; END IF;
  s.pattern := e.pattern; s.padding := e.padding; s.reset_period := e.reset_period;
  v_rendered := render_document_pattern(s.pattern, v_date);
  v_next := GREATEST(
    COALESCE((SELECT last_value FROM document_sequence_entity_counters
               WHERE doc_type = p_doc_type AND legal_entity_id = p_legal_entity_id
                 AND period_key = document_period_key(s.reset_period, v_date)), 0),
    document_number_max_existing(s, v_rendered)) + 1;
  RETURN replace(v_rendered, '{SEQ}', lpad(v_next::text, GREATEST(s.padding, length(v_next::text)), '0'));
END $$;

DO $$
BEGIN
  IF to_regprocedure('log_config_change()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS dses_config_audit ON document_sequence_entity_series;
    CREATE TRIGGER dses_config_audit AFTER INSERT OR UPDATE OR DELETE ON document_sequence_entity_series
      FOR EACH ROW EXECUTE FUNCTION log_config_change('doc_type', '');
  END IF;
END $$;
