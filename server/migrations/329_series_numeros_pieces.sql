-- ═══════════════════════════════════════════════════════════════════════
-- 329 — Séries de numéros des pièces (audit Paramètres, lot 2)
--   Jusqu'ici chaque pièce avait son générateur codé en dur, avec trois
--   stratégies (MAX+1, COUNT+1, séquence). Les factures FR/FE étaient
--   numérotées par COUNT(*)+1 : une facture supprimée faisait réattribuer
--   un numéro existant (doublon), et un numéro fournisseur saisi comptait
--   dans le total.
--
--   document_sequences          : une série par type de pièce (modèle,
--                                 remplissage, remise à zéro), éditable dans
--                                 Paramètres › Numérotation.
--   document_sequence_counters  : dernier numéro attribué par période.
--   next_document_number()      : allocation atomique. Le compteur est
--                                 verrouillé jusqu'à la fin de la transaction
--                                 appelante : si la pièce n'est pas créée
--                                 (ROLLBACK), le numéro n'est pas consommé.
--                                 Le compteur ne recule jamais et se cale sur
--                                 le plus grand numéro déjà présent dans la
--                                 table cible : pas de doublon après une
--                                 suppression, une saisie manuelle ou un
--                                 changement de modèle.
--
--   Modèle : jetons {YYYY} {YY} {MM} {DD} et {SEQ} (obligatoire). Les
--   formats existants sont repris à l'identique.
--
--   Factures émises (FE) : numérotation continue exigée (CGI art. 145).
--   Une facture émise ne peut plus être supprimée ni renumérotée : elle
--   s'annule (statut) ou se corrige par avoir.
--
-- INVERSION
--   DROP FUNCTION next_document_number(TEXT, DATE), preview_document_number(TEXT, DATE),
--     render_document_pattern(TEXT, DATE), guard_emitted_invoice() ;
--   DROP TRIGGER invoices_emitted_guard ON invoices ;
--   DROP TABLE document_sequence_counters, document_sequences.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS document_sequences (
  doc_type      VARCHAR(40) PRIMARY KEY,
  label         VARCHAR(80) NOT NULL,
  module        VARCHAR(30) NOT NULL,
  pattern       VARCHAR(60) NOT NULL,
  padding       SMALLINT NOT NULL DEFAULT 4 CHECK (padding BETWEEN 1 AND 10),
  reset_period  VARCHAR(10) NOT NULL DEFAULT 'year' CHECK (reset_period IN ('never', 'year', 'month', 'day')),
  target_table  VARCHAR(60) NOT NULL,
  target_column VARCHAR(60) NOT NULL,
  gapless       BOOLEAN NOT NULL DEFAULT false,
  display_order SMALLINT NOT NULL DEFAULT 0,
  updated_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Un seul {SEQ} ; la remise à zéro exige les jetons de date de la période,
  -- sinon deux périodes produiraient les mêmes numéros.
  CONSTRAINT document_sequences_seq_once CHECK (
    pattern LIKE '%{SEQ}%' AND position('{SEQ}' IN substr(pattern, position('{SEQ}' IN pattern) + 5)) = 0),
  CONSTRAINT document_sequences_period_tokens CHECK (
    reset_period = 'never'
    OR (reset_period = 'year'  AND (pattern LIKE '%{YYYY}%' OR pattern LIKE '%{YY}%'))
    OR (reset_period = 'month' AND (pattern LIKE '%{YYYY}%' OR pattern LIKE '%{YY}%') AND pattern LIKE '%{MM}%')
    OR (reset_period = 'day'   AND (pattern LIKE '%{YYYY}%' OR pattern LIKE '%{YY}%') AND pattern LIKE '%{MM}%' AND pattern LIKE '%{DD}%'))
);
COMMENT ON TABLE document_sequences IS
  'Séries de numéros des pièces, paramétrables (mig 329). Jetons : {YYYY} {YY} {MM} {DD} {SEQ}.';

CREATE TABLE IF NOT EXISTS document_sequence_counters (
  doc_type    VARCHAR(40) NOT NULL REFERENCES document_sequences(doc_type) ON DELETE CASCADE,
  period_key  VARCHAR(10) NOT NULL,          -- '*' | 'YYYY' | 'YYYY-MM' | 'YYYY-MM-DD'
  last_value  BIGINT NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (doc_type, period_key)
);

-- Formats repris à l'identique des générateurs existants.
INSERT INTO document_sequences (doc_type, label, module, pattern, padding, reset_period, target_table, target_column, gapless, display_order) VALUES
  ('purchase_order',    'Bon de commande fournisseur', 'purchasing', 'BC-{YYYY}-{SEQ}',          4, 'year', 'purchase_orders',        'order_number',   false, 10),
  ('reception_voucher', 'Bon de réception',            'purchasing', 'BR-{YYYY}-{SEQ}',          4, 'year', 'reception_vouchers',     'voucher_number', false, 20),
  ('invoice_received',  'Facture fournisseur (interne)','accounting','FR-{YYYY}-{SEQ}',          4, 'year', 'invoices',               'invoice_number', false, 30),
  ('invoice_emitted',   'Facture client',              'accounting', 'FE-{YYYY}-{SEQ}',          4, 'year', 'invoices',               'invoice_number', true,  40),
  ('customer_order',    'Commande client',             'orders',     'CMD-{YYYY}{MM}{DD}-{SEQ}', 4, 'day',  'orders',                 'order_number',   false, 50),
  ('sale',              'Ticket de vente',             'pos',        'VNT-{YYYY}{MM}{DD}-{SEQ}', 4, 'day',  'sales',                  'sale_number',    false, 60),
  ('sale_return',       'Retour / échange',            'pos',        'RET-{YYYY}{MM}{DD}-{SEQ}', 4, 'day',  'sale_returns',           'return_number',  false, 70),
  ('cash_closure',      'Clôture de caisse (Z)',       'pos',        'Z-{YYYY}{MM}{DD}-{SEQ}',   4, 'day',  'cash_register_sessions', 'closure_number', false, 80),
  ('bon_sortie',        'Bon de sortie ingrédients',   'stock',      'BSI-{YY}{MM}{DD}-{SEQ}',   3, 'day',  'production_bons_sortie', 'numero',         false, 90)
ON CONFLICT (doc_type) DO NOTHING;

-- Modèle rendu pour une date, {SEQ} laissé en place.
CREATE OR REPLACE FUNCTION render_document_pattern(p_pattern TEXT, p_date DATE)
RETURNS TEXT AS $$
  SELECT replace(replace(replace(replace(p_pattern,
           '{YYYY}', to_char(p_date, 'YYYY')),
           '{YY}',   to_char(p_date, 'YY')),
           '{MM}',   to_char(p_date, 'MM')),
           '{DD}',   to_char(p_date, 'DD'));
$$ LANGUAGE sql IMMUTABLE;

-- Plus grand {SEQ} déjà présent dans la table cible pour le modèle rendu.
CREATE OR REPLACE FUNCTION document_number_max_existing(s document_sequences, p_rendered TEXT)
RETURNS BIGINT AS $$
DECLARE
  v_before TEXT := split_part(p_rendered, '{SEQ}', 1);
  v_after  TEXT := split_part(p_rendered, '{SEQ}', 2);
  v_re     TEXT;
  v_max    BIGINT;
BEGIN
  v_re := '^' || regexp_replace(v_before, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g')
       || '([0-9]+)'
       || regexp_replace(v_after, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '$';
  EXECUTE format(
    'SELECT COALESCE(MAX(substring(%1$I FROM %2$L)::bigint), 0) FROM %3$I WHERE %1$I LIKE %4$L AND %1$I ~ %2$L',
    s.target_column, v_re, s.target_table,
    replace(replace(replace(v_before, '\', '\\'), '%', '\%'), '_', '\_') || '%')
  INTO v_max;
  RETURN v_max;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION document_period_key(p_reset TEXT, p_date DATE)
RETURNS TEXT AS $$
  SELECT CASE p_reset
           WHEN 'year'  THEN to_char(p_date, 'YYYY')
           WHEN 'month' THEN to_char(p_date, 'YYYY-MM')
           WHEN 'day'   THEN to_char(p_date, 'YYYY-MM-DD')
           ELSE '*' END;
$$ LANGUAGE sql IMMUTABLE;

-- Allocation atomique. p_date = date de la pièce (locale), défaut : aujourd'hui à Casablanca.
CREATE OR REPLACE FUNCTION next_document_number(p_doc_type TEXT, p_date DATE DEFAULT NULL)
RETURNS TEXT AS $$
DECLARE
  s          document_sequences;
  v_date     DATE := COALESCE(p_date, (now() AT TIME ZONE 'Africa/Casablanca')::date);
  v_period   TEXT;
  v_rendered TEXT;
  v_last     BIGINT;
  v_next     BIGINT;
BEGIN
  SELECT * INTO s FROM document_sequences WHERE doc_type = p_doc_type;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Série de numéros inconnue : %', p_doc_type;
  END IF;
  v_period := document_period_key(s.reset_period, v_date);
  v_rendered := render_document_pattern(s.pattern, v_date);

  INSERT INTO document_sequence_counters (doc_type, period_key) VALUES (p_doc_type, v_period)
  ON CONFLICT DO NOTHING;
  -- Verrou jusqu'à la fin de la transaction : les pièces d'une même série
  -- sont numérotées l'une après l'autre, et un ROLLBACK rend le numéro.
  SELECT last_value INTO v_last FROM document_sequence_counters
   WHERE doc_type = p_doc_type AND period_key = v_period FOR UPDATE;

  v_next := GREATEST(v_last, document_number_max_existing(s, v_rendered)) + 1;
  UPDATE document_sequence_counters SET last_value = v_next, updated_at = now()
   WHERE doc_type = p_doc_type AND period_key = v_period;

  RETURN replace(v_rendered, '{SEQ}', lpad(v_next::text, GREATEST(s.padding, length(v_next::text)), '0'));
END;
$$ LANGUAGE plpgsql;

-- Prochain numéro, sans le consommer (aperçu de l'écran Numérotation).
CREATE OR REPLACE FUNCTION preview_document_number(p_doc_type TEXT, p_date DATE DEFAULT NULL)
RETURNS TEXT AS $$
DECLARE
  s          document_sequences;
  v_date     DATE := COALESCE(p_date, (now() AT TIME ZONE 'Africa/Casablanca')::date);
  v_rendered TEXT;
  v_next     BIGINT;
BEGIN
  SELECT * INTO s FROM document_sequences WHERE doc_type = p_doc_type;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_rendered := render_document_pattern(s.pattern, v_date);
  v_next := GREATEST(
    COALESCE((SELECT last_value FROM document_sequence_counters
               WHERE doc_type = p_doc_type AND period_key = document_period_key(s.reset_period, v_date)), 0),
    document_number_max_existing(s, v_rendered)) + 1;
  RETURN replace(v_rendered, '{SEQ}', lpad(v_next::text, GREATEST(s.padding, length(v_next::text)), '0'));
END;
$$ LANGUAGE plpgsql STABLE;

-- Factures émises : ni suppression ni renumérotation une fois numérotées.
CREATE OR REPLACE FUNCTION guard_emitted_invoice()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.invoice_type = 'emitted' THEN
    RAISE EXCEPTION 'La facture client % ne peut pas être supprimée (numérotation continue) : annulez-la ou établissez un avoir.', OLD.invoice_number
      USING ERRCODE = 'OF409';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.invoice_type = 'emitted'
     AND (NEW.invoice_number IS DISTINCT FROM OLD.invoice_number OR NEW.invoice_type IS DISTINCT FROM OLD.invoice_type) THEN
    RAISE EXCEPTION 'Le numéro de la facture client % est définitif.', OLD.invoice_number USING ERRCODE = 'OF409';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS invoices_emitted_guard ON invoices;
CREATE TRIGGER invoices_emitted_guard
  BEFORE UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION guard_emitted_invoice();

-- Reprise des compteurs : dernier numéro de la période en cours pour chaque série.
INSERT INTO document_sequence_counters (doc_type, period_key, last_value)
SELECT s.doc_type,
       document_period_key(s.reset_period, (now() AT TIME ZONE 'Africa/Casablanca')::date),
       document_number_max_existing(s, render_document_pattern(s.pattern, (now() AT TIME ZONE 'Africa/Casablanca')::date))
  FROM document_sequences s
 WHERE to_regclass('public.' || s.target_table) IS NOT NULL
ON CONFLICT (doc_type, period_key) DO UPDATE SET last_value = GREATEST(document_sequence_counters.last_value, EXCLUDED.last_value);

-- Traçabilité des changements de modèle (journal du paramétrage, mig 328).
DO $$
BEGIN
  IF to_regprocedure('log_config_change()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS document_sequences_config_audit ON document_sequences;
    CREATE TRIGGER document_sequences_config_audit AFTER INSERT OR UPDATE OR DELETE ON document_sequences
      FOR EACH ROW EXECUTE FUNCTION log_config_change('doc_type', '');
  END IF;
END $$;
