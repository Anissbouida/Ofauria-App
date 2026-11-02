-- ═══════════════════════════════════════════════════════════════════════
-- 428 — Comptabilité analytique sur les lignes d'écriture (lot Important 10)
-- ═══════════════════════════════════════════════════════════════════════
-- POURQUOI
--   Les centres de coûts (mig 386) ne se posaient que sur les factures : les
--   charges sans facture (salaires, caisse, dotations, OD) échappaient à
--   l'analytique et le « résultat par activité » ne rejoignait pas le CPC.
--
-- QUOI (vocabulaire Sage : plans analytiques, sections, ventilation)
--   1. analytic_axes : axes (plans) analytiques ; « ACT — Activités » reprend
--      les centres de coûts existants, qui deviennent ses sections.
--   2. analytic_keys / analytic_key_lines : clés de répartition (ex. loyer
--      50 % boulangerie, 30 % pâtisserie, 20 % traiteur).
--   3. journal_line_analytics : ventilation d'une ligne de charge ou de produit
--      (classes 6 et 7) sur une ou plusieurs sections d'un axe. Contrôle différé
--      (au COMMIT) : sections de l'axe, total ventilé = montant de la ligne.
--   4. Ventilation automatique :
--      - écriture de facture : la facture porte un centre → ses lignes 6/7 y
--        sont ventilées (et le sont de nouveau si le centre change) ;
--      - extourne : elle reprend la ventilation de l'écriture extournée.
--   La ventilation n'entre pas dans l'empreinte d'inaltérabilité (mig 413) :
--   elle reste modifiable après validation, comme une réimputation analytique.
--
-- INVERSION
--   DROP TRIGGER trg_invoice_analytic ON invoices ; DROP TRIGGER trg_entry_analytic ON journal_entries ;
--   DROP TABLE journal_line_analytics, analytic_key_lines, analytic_keys ;
--   ALTER TABLE cost_centers DROP COLUMN axis_id ; DROP TABLE analytic_axes ;
--   DROP FUNCTION fn_analytic_sync_invoice(uuid), fn_analytic_check(uuid, uuid),
--     trg_analytic_check(), trg_entry_analytic(), trg_invoice_analytic().
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS analytic_axes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       varchar(20) NOT NULL UNIQUE,
  name       varchar(120) NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO analytic_axes (code, name) VALUES ('ACT', 'Activités') ON CONFLICT (code) DO NOTHING;

ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS axis_id uuid REFERENCES analytic_axes(id);
UPDATE cost_centers SET axis_id = (SELECT id FROM analytic_axes WHERE code = 'ACT') WHERE axis_id IS NULL;
ALTER TABLE cost_centers ALTER COLUMN axis_id SET NOT NULL;
COMMENT ON COLUMN cost_centers.axis_id IS 'Mig 428 : axe analytique dont le centre est une section.';

CREATE TABLE IF NOT EXISTS analytic_keys (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  axis_id    uuid NOT NULL REFERENCES analytic_axes(id),
  name       varchar(120) NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (axis_id, name)
);
CREATE TABLE IF NOT EXISTS analytic_key_lines (
  key_id         uuid NOT NULL REFERENCES analytic_keys(id) ON DELETE CASCADE,
  cost_center_id uuid NOT NULL REFERENCES cost_centers(id),
  percent        numeric(7,4) NOT NULL CHECK (percent > 0 AND percent <= 100),
  PRIMARY KEY (key_id, cost_center_id)
);

CREATE TABLE IF NOT EXISTS journal_line_analytics (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_line_id uuid NOT NULL REFERENCES journal_entry_lines(id) ON DELETE CASCADE,
  axis_id               uuid NOT NULL REFERENCES analytic_axes(id),
  cost_center_id        uuid NOT NULL REFERENCES cost_centers(id),
  amount                numeric(14,2) NOT NULL CHECK (amount > 0),
  source                varchar(10) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'key', 'invoice')),
  created_by            uuid REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (journal_entry_line_id, cost_center_id)
);
CREATE INDEX IF NOT EXISTS idx_jla_line ON journal_line_analytics (journal_entry_line_id, axis_id);
CREATE INDEX IF NOT EXISTS idx_jla_section ON journal_line_analytics (cost_center_id);
COMMENT ON TABLE journal_line_analytics IS
  'Mig 428 : ventilation analytique d''une ligne 6/7 sur les sections d''un axe ; total = montant de la ligne.';

-- Cohérence d'une ventilation (ligne, axe), jugée au COMMIT.
CREATE OR REPLACE FUNCTION fn_analytic_check(p_line uuid, p_axis uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_amount numeric; v_class int; v_total numeric; v_foreign int; v_n int;
BEGIN
  SELECT count(*), COALESCE(sum(x.amount), 0), count(*) FILTER (WHERE c.axis_id <> x.axis_id)
    INTO v_n, v_total, v_foreign
    FROM journal_line_analytics x JOIN cost_centers c ON c.id = x.cost_center_id
   WHERE x.journal_entry_line_id = p_line AND x.axis_id = p_axis;
  IF v_n = 0 THEN RETURN; END IF;
  IF v_foreign > 0 THEN
    RAISE EXCEPTION 'Ventilation analytique : une section n''appartient pas à l''axe choisi' USING ERRCODE = 'OF409';
  END IF;
  SELECT jel.debit + jel.credit, a.account_class INTO v_amount, v_class
    FROM journal_entry_lines jel JOIN accounts a ON a.id = jel.account_id WHERE jel.id = p_line;
  IF v_class IS NULL THEN RETURN; END IF;   -- ligne supprimée (cascade en cours)
  IF v_class NOT IN (6, 7) THEN
    RAISE EXCEPTION 'Ventilation analytique : seules les charges (6) et les produits (7) se ventilent' USING ERRCODE = 'OF409';
  END IF;
  IF v_total <> v_amount THEN
    RAISE EXCEPTION 'Ventilation analytique incomplète : % ventilé sur une ligne de %', v_total, v_amount USING ERRCODE = 'OF409';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION trg_analytic_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM fn_analytic_check(OLD.journal_entry_line_id, OLD.axis_id); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN PERFORM fn_analytic_check(NEW.journal_entry_line_id, NEW.axis_id); END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_analytic_check ON journal_line_analytics;
CREATE CONSTRAINT TRIGGER trg_analytic_check AFTER INSERT OR UPDATE OR DELETE ON journal_line_analytics
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_analytic_check();

-- Ventilation d'après la facture : lignes 6/7 de ses écritures (et de leurs
-- extournes, qui portent la même pièce source) sur le centre de la facture.
-- Une ventilation saisie à la main sur le même axe n'est jamais écrasée.
CREATE OR REPLACE FUNCTION fn_analytic_sync_invoice(p_invoice uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_center uuid; v_axis uuid;
BEGIN
  DELETE FROM journal_line_analytics x
   USING journal_entry_lines jel, journal_entries je
   WHERE x.journal_entry_line_id = jel.id AND jel.journal_entry_id = je.id
     AND je.source_id = p_invoice AND x.source = 'invoice';
  SELECT i.cost_center_id, c.axis_id INTO v_center, v_axis
    FROM invoices i LEFT JOIN cost_centers c ON c.id = i.cost_center_id WHERE i.id = p_invoice;
  IF v_center IS NULL THEN RETURN; END IF;
  INSERT INTO journal_line_analytics (journal_entry_line_id, axis_id, cost_center_id, amount, source)
  SELECT jel.id, v_axis, v_center, jel.debit + jel.credit, 'invoice'
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    JOIN accounts a ON a.id = jel.account_id
   WHERE je.source_id = p_invoice AND je.status IN ('posted', 'reversed') AND a.account_class IN (6, 7)
     AND NOT EXISTS (SELECT 1 FROM journal_line_analytics y WHERE y.journal_entry_line_id = jel.id AND y.axis_id = v_axis);
END $$;

-- Écriture validée : extourne → reprise de la ventilation de l'original (même
-- ordre de ligne) ; écriture d'une facture affectée → ventilation de la facture.
CREATE OR REPLACE FUNCTION trg_entry_analytic() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source_kind = 'reversal' AND NEW.reversal_of_entry_id IS NOT NULL THEN
    INSERT INTO journal_line_analytics (journal_entry_line_id, axis_id, cost_center_id, amount, source, created_by)
    SELECT nl.id, x.axis_id, x.cost_center_id, x.amount, x.source, x.created_by
      FROM journal_entry_lines ol
      JOIN journal_line_analytics x ON x.journal_entry_line_id = ol.id
      JOIN journal_entry_lines nl ON nl.journal_entry_id = NEW.id AND nl.line_order = ol.line_order AND nl.account_id = ol.account_id
     WHERE ol.journal_entry_id = NEW.reversal_of_entry_id
    ON CONFLICT (journal_entry_line_id, cost_center_id) DO NOTHING;
  ELSIF NEW.source_id IS NOT NULL AND EXISTS (SELECT 1 FROM invoices WHERE id = NEW.source_id AND cost_center_id IS NOT NULL) THEN
    PERFORM fn_analytic_sync_invoice(NEW.source_id);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_entry_analytic ON journal_entries;
CREATE TRIGGER trg_entry_analytic AFTER UPDATE OF status ON journal_entries
  FOR EACH ROW WHEN (OLD.status = 'draft' AND NEW.status = 'posted')
  EXECUTE FUNCTION trg_entry_analytic();

-- Centre de la facture modifié → ventilation de ses écritures mise à jour.
CREATE OR REPLACE FUNCTION trg_invoice_analytic() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_analytic_sync_invoice(NEW.id);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_invoice_analytic ON invoices;
CREATE TRIGGER trg_invoice_analytic AFTER UPDATE OF cost_center_id ON invoices
  FOR EACH ROW WHEN (OLD.cost_center_id IS DISTINCT FROM NEW.cost_center_id)
  EXECUTE FUNCTION trg_invoice_analytic();

-- Reprise : factures déjà affectées à un centre.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM invoices WHERE cost_center_id IS NOT NULL LOOP
    PERFORM fn_analytic_sync_invoice(r.id);
  END LOOP;
END $$;
