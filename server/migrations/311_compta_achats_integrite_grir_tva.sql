-- ═══════════════════════════════════════════════════════════════════════
-- 311 — D8 Comptabilité des achats, lot 1 (P0)
--   G-D8-01 : comptabilisation toujours active ; échec = file d'attente
--             (ledger_outbox, mode « outbox ») ou rollback (mode « strict »)
--   G-D8-02 : écriture comptabilisée jamais supprimée (extourne seulement),
--             lignes figées hors lettrage, 10 orphelines extournées
--   G-D8-03 : CHECK source_kind complète, comptes 6588 / 7588 / 6311
--   G-D8-04 : facture fusionnée = annulée + extournée (merged_into_invoice_id),
--             DELETE de facture refusé tant qu'une écriture active la référence
--   G-D8-05 : réceptions à facturer (GR/IR, compte 4417) lettrées par ligne de BC
--   G-D8-09 : posting_profiles (paramétrage des comptes par événement), plus de
--             repli silencieux en 6181, catégories financières bloquées en dépense
--   G-D8-15 : TVA récupérable à la date du règlement, exclusion espèces hors
--             plafond, relevé des déductions
--   G-D8-16 : périodes créées à la demande (fin du blocage 2027), date comptable
--             = premier jour ouvert, clôture séquentielle, historique, checklist
--
-- Convention : une écriture extournée garde le statut 'reversed' (inactive pour
-- l'idempotence et le lettrage) mais reste COMPTÉE dans les états avec son
-- extourne (statut 'posted') : les deux s'annulent, la trace reste.
-- ═══════════════════════════════════════════════════════════════════════

-- ═══ 1. Écritures : liens d'extourne, source, nature ════════════════════
ALTER TABLE journal_entries ALTER COLUMN source_detail TYPE varchar(60);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS reversal_of_entry_id uuid REFERENCES journal_entries(id);

ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_kind_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_source_kind_check CHECK (source_kind IN (
  'manual','invoice','credit_note','payment','payment_void','sale','reversal','backfill','shift_entry',
  'product_loss','closure_diff','advance_repayment','goods_receipt','goods_receipt_return',
  'price_variance','landed_cost','period_accrual','accrual_reversal','grir_write_off','vat_reclass',
  'depreciation','asset_acquisition','withholding_remittance'));

-- Idempotence garantie par la base, quel que soit le source_kind (backfill ou autogen).
DROP INDEX IF EXISTS uq_je_source_detail;
CREATE UNIQUE INDEX IF NOT EXISTS uq_je_source ON journal_entries (source_id, COALESCE(source_detail, ''))
  WHERE status <> 'reversed' AND source_id IS NOT NULL;

-- Axes de lettrage des lignes (GR/IR par ligne de BC).
ALTER TABLE journal_entry_lines
  ADD COLUMN IF NOT EXISTS po_line_id      uuid REFERENCES purchase_order_items(id),
  ADD COLUMN IF NOT EXISTS receipt_item_id uuid REFERENCES reception_voucher_items(id),
  ADD COLUMN IF NOT EXISTS supplier_id     uuid REFERENCES suppliers(id);
CREATE INDEX IF NOT EXISTS idx_jel_po_line ON journal_entry_lines (po_line_id) WHERE po_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jel_receipt_item ON journal_entry_lines (receipt_item_id) WHERE receipt_item_id IS NOT NULL;

-- ═══ 2. Comptes manquants (G-D8-03) ═══════════════════════════════════
INSERT INTO accounts (code, label, account_class, rubrique, poste, account_type, normal_side, is_collective, is_active) VALUES
  ('6588', 'Autres charges non courantes',          6, '65', '658', 'expense', 'D', false, true),
  ('7588', 'Autres produits non courants',          7, '75', '758', 'revenue', 'C', false, true),
  ('6311', 'Intérêts des emprunts et dettes',       6, '63', '631', 'expense', 'D', false, true)
ON CONFLICT (code) DO NOTHING;

-- ═══ 3. Périodes : création à la demande, date comptable, historique ═══
CREATE OR REPLACE FUNCTION fn_ensure_fiscal_period(p_date date) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_start date := date_trunc('month', p_date)::date;
BEGIN
  SELECT id INTO v_id FROM fiscal_periods WHERE p_date BETWEEN start_date AND end_date;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  IF p_date > CURRENT_DATE + interval '18 months' THEN
    RAISE EXCEPTION 'Date % trop lointaine : aucune période créée au-delà de 18 mois', p_date USING ERRCODE = 'OF409';
  END IF;
  INSERT INTO fiscal_periods (year, month, start_date, end_date, status)
  VALUES (extract(year FROM v_start)::int, extract(month FROM v_start)::int, v_start,
          (v_start + interval '1 month - 1 day')::date, 'open')
  ON CONFLICT (year, month) DO NOTHING;
  SELECT id INTO v_id FROM fiscal_periods WHERE p_date BETWEEN start_date AND end_date;
  RETURN v_id;
END $$;

-- Date comptable : la date de la pièce si sa période est ouverte, sinon le
-- premier jour de la première période ouverte qui suit (jamais en arrière).
CREATE OR REPLACE FUNCTION fn_accounting_date(p_date date) RETURNS date LANGUAGE plpgsql AS $$
DECLARE v_d date := p_date; v_status text; i int := 0;
BEGIN
  LOOP
    PERFORM fn_ensure_fiscal_period(v_d);
    SELECT status INTO v_status FROM fiscal_periods WHERE v_d BETWEEN start_date AND end_date;
    IF v_status = 'open' THEN RETURN v_d; END IF;
    v_d := (date_trunc('month', v_d) + interval '1 month')::date;
    i := i + 1;
    IF i > 24 THEN RAISE EXCEPTION 'Aucune période ouverte après %', p_date USING ERRCODE = 'OF409'; END IF;
  END LOOP;
END $$;

-- Périodes jusqu'à fin 2027 ; au-delà, créées à la demande par fn_ensure_fiscal_period.
DO $$ DECLARE d date := date_trunc('month', CURRENT_DATE)::date; BEGIN
  WHILE d <= DATE '2027-12-01' LOOP PERFORM fn_ensure_fiscal_period(d); d := (d + interval '1 month')::date; END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS fiscal_period_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id   uuid NOT NULL REFERENCES fiscal_periods(id),
  from_status varchar(10) NOT NULL,
  to_status   varchar(10) NOT NULL,
  user_id     uuid REFERENCES users(id),
  note        text,
  checklist   jsonb,
  at          timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS fiscal_period_events_append_only ON fiscal_period_events;
CREATE TRIGGER fiscal_period_events_append_only BEFORE UPDATE OR DELETE ON fiscal_period_events
  FOR EACH ROW EXECUTE FUNCTION trg_audit_append_only();

-- Clôture séquentielle : on ne clôt pas un mois tant que le précédent est ouvert.
CREATE OR REPLACE FUNCTION trg_fiscal_period_status() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_prev text;
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
  INSERT INTO fiscal_period_events (period_id, from_status, to_status, user_id, note, checklist)
  VALUES (OLD.id, OLD.status, NEW.status, NULLIF(current_setting('app.user_id', true), '')::uuid,
          NULLIF(current_setting('app.period_note', true), ''),
          NULLIF(current_setting('app.period_checklist', true), '')::jsonb);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_fiscal_period_status ON fiscal_periods;
CREATE TRIGGER trg_fiscal_period_status BEFORE UPDATE OF status ON fiscal_periods
  FOR EACH ROW EXECUTE FUNCTION trg_fiscal_period_status();

-- ═══ 4. Extourne des 10 écritures orphelines (source supprimée) ════════
DO $$
DECLARE o record; v_date date; v_period uuid; v_num text; v_ext uuid; v_sys uuid; v_lett uuid[];
BEGIN
  SELECT id INTO v_sys FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1;
  FOR o IN
    SELECT je.* FROM journal_entries je
     WHERE je.status = 'posted' AND je.source_id IS NOT NULL AND je.source_kind <> 'reversal'
       AND NOT EXISTS (SELECT 1 FROM invoices WHERE id = je.source_id)
       AND NOT EXISTS (SELECT 1 FROM payments WHERE id = je.source_id)
       AND NOT EXISTS (SELECT 1 FROM sales WHERE id = je.source_id)
       AND NOT EXISTS (SELECT 1 FROM manual_shift_entries WHERE id = je.source_id)
       AND NOT EXISTS (SELECT 1 FROM salary_advance_repayments WHERE id = je.source_id)
       AND NOT EXISTS (SELECT 1 FROM reception_voucher_items WHERE id = je.source_id)
       AND je.source_kind IN ('invoice','payment','sale','backfill','shift_entry')
     ORDER BY je.entry_date, je.entry_number
  LOOP
    v_date := fn_accounting_date(o.entry_date);
    v_period := fn_ensure_fiscal_period(v_date);
    v_num := next_entry_number(o.journal_id, extract(year FROM v_date)::smallint);
    INSERT INTO journal_entries (entry_number, journal_id, entry_date, fiscal_period_id, description, source_kind,
                                 source_id, source_detail, status, store_id, created_by, reversal_of_entry_id)
    VALUES (v_num, o.journal_id, v_date, v_period,
            'Extourne de ' || o.entry_number || ' — écriture orpheline (pièce source supprimée avant la mig 311)',
            'reversal', o.source_id, 'rev:' || o.id, 'draft', o.store_id, v_sys, o.id)
    RETURNING id INTO v_ext;
    INSERT INTO journal_entry_lines (journal_entry_id, line_order, account_id, auxiliary_id, debit, credit, label)
    SELECT v_ext, line_order, account_id, auxiliary_id, credit, debit, 'Extourne: ' || COALESCE(label, '')
      FROM journal_entry_lines WHERE journal_entry_id = o.id;
    UPDATE journal_entries SET status = 'posted', posted_at = now(), posted_by = v_sys WHERE id = v_ext;
    SELECT array_agg(DISTINCT lettrage_id) INTO v_lett FROM journal_entry_lines WHERE journal_entry_id = o.id AND lettrage_id IS NOT NULL;
    IF v_lett IS NOT NULL THEN UPDATE journal_entry_lines SET lettrage_id = NULL WHERE lettrage_id = ANY (v_lett); END IF;
    UPDATE journal_entries SET status = 'reversed', reversed_by_entry_id = v_ext WHERE id = o.id;
  END LOOP;
END $$;

-- ═══ 5. Immuabilité des écritures (G-D8-02) ════════════════════════════
CREATE OR REPLACE FUNCTION trg_journal_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'draft' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Écriture % : suppression interdite, utilisez l''extourne', OLD.entry_number USING ERRCODE = 'OF409';
  END IF;
  IF OLD.status IN ('posted','reversed') THEN
    IF NEW.entry_number IS DISTINCT FROM OLD.entry_number OR NEW.entry_date IS DISTINCT FROM OLD.entry_date
       OR NEW.journal_id IS DISTINCT FROM OLD.journal_id OR NEW.fiscal_period_id IS DISTINCT FROM OLD.fiscal_period_id
       OR NEW.source_id IS DISTINCT FROM OLD.source_id OR NEW.source_kind IS DISTINCT FROM OLD.source_kind THEN
      RAISE EXCEPTION 'Écriture % comptabilisée : en-tête figé, utilisez l''extourne', OLD.entry_number USING ERRCODE = 'OF409';
    END IF;
    IF OLD.status = 'reversed' AND NEW.status <> 'reversed' THEN
      RAISE EXCEPTION 'Écriture % déjà extournée', OLD.entry_number USING ERRCODE = 'OF409';
    END IF;
    IF OLD.status = 'posted' AND NEW.status NOT IN ('posted','reversed') THEN
      RAISE EXCEPTION 'Écriture % comptabilisée : retour en brouillon interdit', OLD.entry_number USING ERRCODE = 'OF409';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_journal_entry_guard ON journal_entries;
CREATE TRIGGER trg_journal_entry_guard BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION trg_journal_entry_guard();

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
     AND NEW.journal_entry_id = OLD.journal_entry_id THEN
    RETURN NEW;   -- lettrage et axes d'analyse : autorisés
  END IF;
  RAISE EXCEPTION 'Écriture % comptabilisée : lignes figées (hors lettrage)', v_num USING ERRCODE = 'OF409';
END $$;
DROP TRIGGER IF EXISTS trg_journal_line_guard ON journal_entry_lines;
CREATE TRIGGER trg_journal_line_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_entry_lines
  FOR EACH ROW EXECUTE FUNCTION trg_journal_line_guard();

-- ═══ 6. Factures : fusion = annulation, suppression gardée (G-D8-04) ═══
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS merged_into_invoice_id uuid REFERENCES invoices(id);

CREATE OR REPLACE FUNCTION trg_invoice_no_delete_with_entries() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM journal_entries WHERE source_id = OLD.id AND status = 'posted' AND source_kind <> 'reversal') THEN
    RAISE EXCEPTION 'Facture % comptabilisée : annulez-la (extourne) au lieu de la supprimer', OLD.invoice_number
      USING ERRCODE = 'OF409';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS invoices_no_delete_with_entries ON invoices;
CREATE TRIGGER invoices_no_delete_with_entries BEFORE DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION trg_invoice_no_delete_with_entries();

-- ═══ 7. File d'attente de comptabilisation (G-D8-01) ══════════════════
CREATE TABLE IF NOT EXISTS ledger_outbox (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind   varchar(30) NOT NULL,
  source_id     uuid NOT NULL,
  source_detail varchar(60) NOT NULL DEFAULT '',
  status        varchar(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','posted','failed')),
  attempts      int NOT NULL DEFAULT 1,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  posted_at     timestamptz,
  UNIQUE (source_kind, source_id, source_detail)
);
CREATE INDEX IF NOT EXISTS idx_ledger_outbox_pending ON ledger_outbox (created_at) WHERE status <> 'posted';

INSERT INTO module_parameters (key, value, description) VALUES
  ('ledger.posting_mode', '{"mode":"outbox"}',
   'Comptabilisation : outbox = la pièce passe, l''échec est mis en file (à rejouer) ; strict = un échec de comptabilisation annule la pièce')
ON CONFLICT (key) DO NOTHING;

-- ═══ 8. Paramétrage des comptes par événement (G-D8-09) ════════════════
CREATE TABLE IF NOT EXISTS posting_profiles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type    varchar(40) NOT NULL,
  category_id   uuid REFERENCES expense_categories(id),
  account_code  varchar(20) NOT NULL REFERENCES accounts(code),
  description   text,
  is_active     boolean NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_posting_profiles ON posting_profiles (event_type, COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid));
INSERT INTO posting_profiles (event_type, category_id, account_code, description) VALUES
  ('grir',            NULL, '4417', 'Réceptions à facturer (compte d''attente GR/IR)'),
  ('supplier',        NULL, '4411', 'Fournisseurs (collectif)'),
  ('cash',            NULL, '5161', 'Caisse'),
  ('bank',            NULL, '5141', 'Banque'),
  ('cheque_out',      NULL, '5111', 'Chèques émis à encaisser'),
  ('bill_out',        NULL, '4415', 'Effets à payer'),
  ('loss_non_current',NULL, '6588', 'Écarts de caisse négatifs'),
  ('gain_non_current',NULL, '7588', 'Écarts de caisse positifs')
ON CONFLICT DO NOTHING;

-- Catégories financières : ni charge, ni repli 6181.
ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS posting_block_reason text;
COMMENT ON COLUMN expense_categories.posting_block_reason IS 'Si renseigné : la catégorie (et ses enfants) est refusée comme dépense ; le texte dit quoi faire à la place';
UPDATE expense_categories SET posting_block_reason = 'Un virement entre caisse et banque n''est pas une dépense : utilisez « Mouvement interne ».'
 WHERE name = 'Virement bancaire' AND posting_block_reason IS NULL;
UPDATE expense_categories SET account_id = (SELECT id FROM accounts WHERE code = '1481')
 WHERE name = 'Remboursement emprunt' AND account_id IS NULL;
UPDATE expense_categories SET account_id = (SELECT id FROM accounts WHERE code = '6311')
 WHERE name = 'Intérêts bancaires' AND account_id IS NULL;

-- ═══ 9. GR/IR : réceptions à facturer par ligne de BC (G-D8-05) ════════
CREATE OR REPLACE VIEW v_grir_open_items AS
SELECT l.po_line_id, poi.purchase_order_id, po.order_number, po.supplier_id, s.name AS supplier_name,
       COALESCE(ing.name, pkg.name) AS item_name,
       round(SUM(l.credit) - SUM(l.debit), 2)  AS open_amount,          -- > 0 reçu non facturé ; < 0 facturé non reçu
       MIN(je.entry_date)                      AS first_event,
       CURRENT_DATE - MIN(je.entry_date)       AS age_days
  FROM journal_entry_lines l
  JOIN accounts a ON a.id = l.account_id AND a.code = '4417'
  JOIN journal_entries je ON je.id = l.journal_entry_id AND je.status IN ('posted','reversed')
  JOIN purchase_order_items poi ON poi.id = l.po_line_id
  JOIN purchase_orders po ON po.id = poi.purchase_order_id
  LEFT JOIN suppliers s ON s.id = po.supplier_id
  LEFT JOIN ingredients ing ON ing.id = poi.ingredient_id
  LEFT JOIN packaging_items pkg ON pkg.id = poi.packaging_id
 GROUP BY l.po_line_id, poi.purchase_order_id, po.order_number, po.supplier_id, s.name, ing.name, pkg.name
HAVING abs(SUM(l.credit) - SUM(l.debit)) > 0.005;

-- ═══ 10. TVA récupérable au règlement (G-D8-15) ════════════════════════
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS vat_recoverable_from       date,
  ADD COLUMN IF NOT EXISTS is_vat_recoverable         boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS vat_non_recoverable_reason varchar(30);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_invoices_vat_reason') THEN
    ALTER TABLE invoices ADD CONSTRAINT chk_invoices_vat_reason CHECK (vat_non_recoverable_reason IS NULL OR vat_non_recoverable_reason IN
      ('cash_over_limit','missing_mentions','inactive_supplier','no_invoice','personal','exempt_supplier','manual'));
  END IF;
END $$;
COMMENT ON COLUMN invoices.vat_recoverable_from IS 'Naissance du droit à déduction (CGI art. 101) : date du règlement qui solde la facture';

CREATE OR REPLACE FUNCTION fn_refresh_invoice_vat(p_invoice uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_inv invoices%ROWTYPE; v_paid numeric; v_last date; v_cash boolean;
BEGIN
  SELECT * INTO v_inv FROM invoices WHERE id = p_invoice;
  IF NOT FOUND OR v_inv.invoice_type <> 'received' THEN RETURN; END IF;
  SELECT COALESCE(SUM(amount), 0),
         MAX(payment_date) FILTER (WHERE status <> 'void' AND amount > 0),
         bool_or(non_deductible AND status <> 'void')
    INTO v_paid, v_last, v_cash
    FROM payments WHERE invoice_id = p_invoice;
  UPDATE invoices SET
    vat_recoverable_from = CASE WHEN v_paid >= total_amount - 0.01 AND total_amount > 0 THEN v_last END,
    is_vat_recoverable = CASE
      WHEN COALESCE(v_cash, false) THEN false
      WHEN vat_non_recoverable_reason = 'cash_over_limit' THEN true
      ELSE is_vat_recoverable END,
    vat_non_recoverable_reason = CASE
      WHEN COALESCE(v_cash, false) THEN 'cash_over_limit'
      WHEN vat_non_recoverable_reason = 'cash_over_limit' THEN NULL
      ELSE vat_non_recoverable_reason END
  WHERE id = p_invoice
    AND (vat_recoverable_from IS DISTINCT FROM CASE WHEN v_paid >= total_amount - 0.01 AND total_amount > 0 THEN v_last END
         OR COALESCE(v_cash, false) <> (vat_non_recoverable_reason IS NOT DISTINCT FROM 'cash_over_limit'));
END $$;

CREATE OR REPLACE FUNCTION trg_payments_refresh_invoice_vat() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.invoice_id IS NOT NULL THEN PERFORM fn_refresh_invoice_vat(NEW.invoice_id); END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS payments_refresh_invoice_vat ON payments;
CREATE TRIGGER payments_refresh_invoice_vat AFTER INSERT OR UPDATE OF status, amount ON payments
  FOR EACH ROW EXECUTE FUNCTION trg_payments_refresh_invoice_vat();

-- Reprise : droit à déduction des factures déjà réglées.
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT id FROM invoices WHERE invoice_type = 'received' LOOP PERFORM fn_refresh_invoice_vat(r.id); END LOOP;
END $$;

CREATE OR REPLACE VIEW v_vat_deduction_statement AS
SELECT i.id AS invoice_id, i.invoice_number, i.supplier_invoice_number, i.invoice_date,
       s.id AS supplier_id, s.name AS supplier_name,
       NULLIF(btrim(s.ice), '') AS supplier_ice,
       (SELECT si.value FROM supplier_identifiers si WHERE si.supplier_id = s.id AND si.type_code = 'MA_IF' LIMIT 1) AS supplier_if,
       i.amount AS amount_ht, i.tax_amount AS amount_tva, i.total_amount AS amount_ttc,
       i.vat_recoverable_from, i.is_vat_recoverable, i.vat_non_recoverable_reason,
       i.legal_issues,
       (SELECT string_agg(COALESCE(pm.label, p.payment_method) || COALESCE(' ' || p.reference_norm, '') || ' du ' || to_char(p.payment_date, 'DD/MM/YYYY'), ' ; ' ORDER BY p.payment_date)
          FROM payments p LEFT JOIN payment_modes pm ON pm.code = p.payment_mode
         WHERE p.invoice_id = i.id AND p.status <> 'void' AND p.amount > 0) AS payments
  FROM invoices i
  JOIN suppliers s ON s.id = i.supplier_id
 WHERE i.invoice_type = 'received' AND i.status <> 'cancelled' AND i.tax_amount > 0;

-- ═══ 11. Contrôles de clôture (G-D8-16) ═════════════════════════════════
CREATE OR REPLACE FUNCTION fn_close_checklist(p_period uuid)
RETURNS TABLE (code text, label text, item_count bigint, amount numeric, blocking boolean) LANGUAGE sql STABLE AS $$
  WITH p AS (SELECT * FROM fiscal_periods WHERE id = p_period)
  SELECT 'previous_open', 'Période précédente encore ouverte',
         count(*), NULL::numeric, true
    FROM fiscal_periods f, p WHERE f.end_date = p.start_date - 1 AND f.status = 'open'
  UNION ALL
  SELECT 'invoices_unposted', 'Factures fournisseurs sans écriture',
         count(*), COALESCE(sum(i.total_amount), 0), true
    FROM invoices i, p
   WHERE i.invoice_type = 'received' AND i.status <> 'cancelled' AND i.total_amount > 0
     AND i.invoice_date BETWEEN p.start_date AND p.end_date
     AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_id = i.id AND je.status = 'posted')
  UNION ALL
  SELECT 'payments_unposted', 'Paiements sans écriture',
         count(*), COALESCE(sum(pa.amount), 0), true
    FROM payments pa, p
   WHERE pa.status <> 'void' AND pa.amount > 0 AND pa.payment_method <> 'avoir'
     AND pa.payment_date BETWEEN p.start_date AND p.end_date
     AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_id = pa.id AND je.status = 'posted')
  UNION ALL
  SELECT 'outbox_pending', 'Comptabilisations en attente (file)',
         count(*), NULL::numeric, true
    FROM ledger_outbox o WHERE o.status <> 'posted'
  UNION ALL
  SELECT 'draft_entries', 'Écritures en brouillon dans la période',
         count(*), NULL::numeric, true
    FROM journal_entries je, p WHERE je.status = 'draft' AND je.fiscal_period_id = p.id
  UNION ALL
  SELECT 'grir_aged', 'Réceptions non facturées depuis plus de 30 jours',
         count(*), COALESCE(sum(g.open_amount), 0), false
    FROM v_grir_open_items g, p WHERE g.first_event <= p.end_date AND g.open_amount > 0 AND (p.end_date - g.first_event) > 30
  UNION ALL
  SELECT 'invoice_holds', 'Factures du mois avec blocage ouvert',
         count(DISTINCT h.invoice_id), NULL::numeric, false
    FROM invoice_holds h JOIN invoices i ON i.id = h.invoice_id, p
   WHERE h.released_at IS NULL AND i.invoice_date BETWEEN p.start_date AND p.end_date
$$;

-- ═══ 12. Réconciliation legacy ↔ ledger : écritures ACTIVES seulement ═══
-- (une écriture extournée et son extourne s'annulent : les deux sont exclues ici).
CREATE OR REPLACE VIEW v_reconciliation_check AS
 SELECT id AS invoice_id,
    invoice_number,
    invoice_type,
    invoice_date,
    total_amount,
    status,
    round(total_amount - COALESCE(paid_amount, 0::numeric), 2) AS legacy_remaining,
    round(COALESCE(( SELECT
                CASE
                    WHEN inv.invoice_type::text = 'emitted'::text THEN sum(jel.debit) - sum(jel.credit)
                    ELSE sum(jel.credit) - sum(jel.debit)
                END AS "case"
           FROM journal_entry_lines jel
             JOIN journal_entries je ON je.id = jel.journal_entry_id
             JOIN accounts a ON a.id = jel.account_id
          WHERE jel.lettrage_id IS NULL AND je.status::text = 'posted'::text AND je.source_kind::text <> 'reversal'::text AND (a.code::text = ANY (ARRAY['3421'::character varying::text, '4411'::character varying::text])) AND (je.source_id = inv.id OR (je.source_id IN ( SELECT payments.id
                   FROM payments
                  WHERE payments.invoice_id = inv.id)))), 0::numeric), 2) AS ledger_remaining,
    (EXISTS ( SELECT 1
           FROM journal_entries je2
          WHERE je2.status::text = 'posted'::text AND je2.source_kind::text <> 'reversal'::text AND (je2.source_id = inv.id OR (je2.source_id IN ( SELECT payments.id
                   FROM payments
                  WHERE payments.invoice_id = inv.id))))) AS has_ledger_entries
   FROM invoices inv
  WHERE status::text <> 'cancelled'::text;
