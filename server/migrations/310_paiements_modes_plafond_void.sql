-- ═══════════════════════════════════════════════════════════════════════
-- 310 — D7 Paiements et trésorerie, lot 1 (P0)
--   G-D7-03 : mode de paiement typé, référence obligatoire, comptes de trésorerie
--   G-D7-04 : compteur espèces par fournisseur (5 000 DH/jour, 50 000 DH/mois),
--             alerte 80 %, avertissement ou blocage avec dérogation tracée
--   G-D7-07 : statut du paiement, immuabilité d'un paiement exécuté
--   G-D7-08 : annulation (void) par contre-pièce motivée, ré-émission liée,
--             suppression physique interdite
--   G-D7-17 : virements internes caisse ↔ banque (type internal_transfer)
--
-- Principe de l'annulation : on n'efface jamais un paiement. On insère une
-- contre-pièce de montant négatif (voids_payment_id) à la même date et sur la
-- même facture : toutes les sommes existantes sur payments (reste dû, solde
-- caisse, échéancier, Z de caisse…) se neutralisent sans être réécrites.
-- ═══════════════════════════════════════════════════════════════════════

-- ═══ 1. Référentiel des modes de paiement (pack pays) ═══════════════════
CREATE TABLE IF NOT EXISTS payment_modes (
  code                        varchar(20) PRIMARY KEY,
  label                       varchar(60) NOT NULL,
  legacy_method               varchar(20) NOT NULL,   -- valeur de payments.payment_method (héritage)
  is_cash                     boolean NOT NULL DEFAULT false,
  treasury_kind               varchar(10) NOT NULL CHECK (treasury_kind IN ('cash','bank')),
  requires_reference          boolean NOT NULL DEFAULT false,
  -- false = règlement soumis au plafond espèces (CGI art. 11-II / 106-II) :
  -- espèces et chèque NON barré.
  deductible_over_cash_limit  boolean NOT NULL DEFAULT true,
  display_order               int NOT NULL DEFAULT 0,
  is_active                   boolean NOT NULL DEFAULT true
);
INSERT INTO payment_modes (code, label, legacy_method, is_cash, treasury_kind, requires_reference, deductible_over_cash_limit, display_order) VALUES
  ('cash',         'Espèces',                   'cash',     true,  'cash', false, false, 10),
  ('cheque_barre', 'Chèque barré',              'check',    false, 'bank', true,  true,  20),
  ('cheque',       'Chèque non barré',          'check',    false, 'bank', true,  false, 25),
  ('effet',        'Effet (traite / LCN)',      'traite',   false, 'bank', true,  true,  30),
  ('virement',     'Virement bancaire',         'transfer', false, 'bank', true,  true,  40),
  ('carte',        'Carte bancaire',            'card',     false, 'bank', false, true,  50),
  ('mobile',       'Paiement mobile',           'mobile',   false, 'bank', false, true,  60)
ON CONFLICT (code) DO NOTHING;

-- ═══ 2. Comptes de trésorerie (caisse, banque) ══════════════════════════
CREATE TABLE IF NOT EXISTS treasury_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          varchar(20) NOT NULL UNIQUE,
  label         varchar(100) NOT NULL,
  kind          varchar(10) NOT NULL CHECK (kind IN ('cash','bank')),
  account_code  varchar(20) NOT NULL,          -- compte général (5161, 5141…)
  bank_name     varchar(100),
  iban          varchar(40),
  store_id      uuid REFERENCES stores(id),
  is_default    boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_treasury_default_kind ON treasury_accounts (kind) WHERE is_default AND is_active;
INSERT INTO treasury_accounts (code, label, kind, account_code, is_default) VALUES
  ('CAISSE', 'Caisse',            'cash', '5161', true),
  ('BANQUE', 'Banque principale', 'bank', '5141', true)
ON CONFLICT (code) DO NOTHING;

-- ═══ 3. Seuils fiscaux datés (pack pays) ════════════════════════════════
CREATE TABLE IF NOT EXISTS fiscal_thresholds (
  country_code  varchar(2)  NOT NULL,
  code          varchar(40) NOT NULL,
  value         numeric(14,2) NOT NULL,
  valid_from    date NOT NULL,
  valid_to      date,
  legal_ref     text,
  PRIMARY KEY (country_code, code, valid_from)
);
INSERT INTO fiscal_thresholds VALUES
  ('MA', 'CASH_DAILY_PER_SUPPLIER',   5000,  '2019-01-01', NULL, 'CGI art. 11-II et 106-II'),
  ('MA', 'CASH_MONTHLY_PER_SUPPLIER', 50000, '2019-01-01', NULL, 'CGI art. 11-II et 106-II'),
  ('MA', 'CASH_WARN_PCT',             80,    '2019-01-01', NULL, 'Paramètre interne : alerte avant plafond')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION fn_fiscal_threshold(p_code text, p_date date)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT t.value FROM fiscal_thresholds t
   WHERE t.code = p_code
     AND t.country_code = COALESCE((SELECT value->>'code' FROM module_parameters WHERE key = 'company.country_code'), 'MA')
     AND t.valid_from <= p_date AND (t.valid_to IS NULL OR t.valid_to >= p_date)
   ORDER BY t.valid_from DESC LIMIT 1
$$;

INSERT INTO module_parameters (key, value, description) VALUES
  ('purchasing.cash_limit_enforcement', '{"mode":"warn"}',
   'Plafond espèces par fournisseur : warn = le paiement passe et est marqué non déductible ; block = refusé sauf dérogation admin motivée')
ON CONFLICT (key) DO NOTHING;

-- ═══ 4. Fournisseurs : nature et exception agricole ════════════════════
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS kind varchar(10) NOT NULL DEFAULT 'tiers',
  ADD COLUMN IF NOT EXISTS supplies_unprocessed_agri boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_suppliers_kind') THEN
    ALTER TABLE suppliers ADD CONSTRAINT chk_suppliers_kind CHECK (kind IN ('tiers','divers'));
  END IF;
END $$;
COMMENT ON COLUMN suppliers.kind IS 'divers = tiers générique (achats comptoir regroupés) : hors compteur espèces, qui n''a de sens que par vrai fournisseur';
COMMENT ON COLUMN suppliers.supplies_unprocessed_agri IS 'Produits agricoles non transformés (CGI art. 106-II) : plafond espèces non bloquant';
UPDATE suppliers SET kind = 'divers'
 WHERE name IN ('Épicerie', 'Marché aux puces', 'Personnel – Avances caisse') AND kind = 'tiers';

-- ═══ 5. Paiements : colonnes ═══════════════════════════════════════════
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS payment_mode           varchar(20) REFERENCES payment_modes(code),
  ADD COLUMN IF NOT EXISTS treasury_account_id    uuid REFERENCES treasury_accounts(id),
  ADD COLUMN IF NOT EXISTS to_treasury_account_id uuid REFERENCES treasury_accounts(id),
  ADD COLUMN IF NOT EXISTS reference_norm         varchar(60)
      GENERATED ALWAYS AS (NULLIF(upper(regexp_replace(COALESCE(check_number, reference, ''), '\s+', '', 'g')), '')) STORED,
  ADD COLUMN IF NOT EXISTS status                 varchar(10) NOT NULL DEFAULT 'executed',
  ADD COLUMN IF NOT EXISTS executed_at            timestamptz,
  ADD COLUMN IF NOT EXISTS executed_by            uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS voided_at              timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by              uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS void_reason_code_id    uuid REFERENCES ref_entries(id),
  ADD COLUMN IF NOT EXISTS void_note              text,
  ADD COLUMN IF NOT EXISTS voids_payment_id       uuid REFERENCES payments(id),
  ADD COLUMN IF NOT EXISTS replaces_payment_id    uuid REFERENCES payments(id),
  ADD COLUMN IF NOT EXISTS non_deductible         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS non_deductible_reason  varchar(30),
  ADD COLUMN IF NOT EXISTS cash_limit_check       jsonb,
  ADD COLUMN IF NOT EXISTS updated_at             timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by             uuid REFERENCES users(id);

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_type_check;
ALTER TABLE payments ADD CONSTRAINT payments_type_check
  CHECK (type IN ('invoice','salary','expense','income','advance','internal_transfer'));

-- ═══ 6. Reprise de l'existant (triggers utilisateur coupés : pas de bruit d'audit) ═══
ALTER TABLE payments DISABLE TRIGGER USER;
UPDATE payments SET payment_mode = CASE payment_method
    WHEN 'cash'     THEN 'cash'
    WHEN 'check'    THEN 'cheque_barre'   -- hypothèse à confirmer : chèques fournisseurs barrés
    WHEN 'traite'   THEN 'effet'
    WHEN 'transfer' THEN 'virement'
    WHEN 'bank'     THEN 'virement'
    WHEN 'card'     THEN 'carte'
    WHEN 'mobile'   THEN 'mobile'
  END
 WHERE payment_mode IS NULL AND payment_method <> 'avoir';
UPDATE payments p SET treasury_account_id = t.id
  FROM payment_modes m, treasury_accounts t
 WHERE p.treasury_account_id IS NULL AND m.code = p.payment_mode
   AND t.kind = m.treasury_kind AND t.is_default;
UPDATE payments SET executed_at = created_at, executed_by = created_by WHERE executed_at IS NULL;
ALTER TABLE payments ENABLE TRIGGER USER;

DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM payments WHERE payment_mode IS NULL AND payment_method <> 'avoir';
  IF n > 0 THEN RAISE EXCEPTION 'Reprise incomplète : % paiement(s) sans mode typé', n; END IF;
END $$;

ALTER TABLE payments
  ADD CONSTRAINT chk_payments_status CHECK (status IN ('draft','approved','executed','void')),
  ADD CONSTRAINT chk_payments_mode_present CHECK (payment_mode IS NOT NULL OR payment_method = 'avoir'),
  -- Montant positif, sauf la contre-pièce d'une annulation (négative, liée à l'original).
  ADD CONSTRAINT chk_payments_amount_sign CHECK ((voids_payment_id IS NULL AND amount > 0) OR (voids_payment_id IS NOT NULL AND amount < 0)),
  ADD CONSTRAINT chk_payments_void_fields CHECK (status <> 'void' OR voids_payment_id IS NOT NULL OR (voided_at IS NOT NULL AND void_reason_code_id IS NOT NULL)),
  ADD CONSTRAINT chk_payments_internal_transfer CHECK (
    type <> 'internal_transfer' OR (
      treasury_account_id IS NOT NULL AND to_treasury_account_id IS NOT NULL
      AND treasury_account_id <> to_treasury_account_id
      AND supplier_id IS NULL AND invoice_id IS NULL AND employee_id IS NULL)),
  ADD CONSTRAINT chk_payments_to_account_only_transfer CHECK (to_treasury_account_id IS NULL OR type = 'internal_transfer');

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_voids_once ON payments (voids_payment_id) WHERE voids_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_supplier_date ON payments (supplier_id, payment_date) WHERE supplier_id IS NOT NULL;
-- Un même chèque/effet ne règle pas deux fois la même facture (doublon garanti en base).
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_instrument_per_invoice
  ON payments (invoice_id, payment_mode, reference_norm)
  WHERE invoice_id IS NOT NULL AND reference_norm IS NOT NULL AND status <> 'void'
    AND voids_payment_id IS NULL AND payment_mode IN ('cheque','cheque_barre','effet');

-- ═══ 7. Normalisation, immuabilité, suppression interdite ═══════════════
-- Nom préfixé « payments_a_ » : s'exécute avant les autres BEFORE (ordre alphabétique).
CREATE OR REPLACE FUNCTION trg_payments_normalize() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_mode payment_modes%ROWTYPE; v_ref text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Un paiement exécuté ou annulé est figé sur ce qui a fait sortir l'argent.
    IF OLD.status IN ('executed','void') AND COALESCE(current_setting('app.payment_edit', true), '') <> 'on' AND (
         NEW.amount IS DISTINCT FROM OLD.amount OR NEW.payment_mode IS DISTINCT FROM OLD.payment_mode
      OR NEW.payment_method IS DISTINCT FROM OLD.payment_method OR NEW.payment_date IS DISTINCT FROM OLD.payment_date
      OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
      OR NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.type IS DISTINCT FROM OLD.type
      OR NEW.treasury_account_id IS DISTINCT FROM OLD.treasury_account_id
      OR NEW.to_treasury_account_id IS DISTINCT FROM OLD.to_treasury_account_id
      OR NEW.withholding_amount IS DISTINCT FROM OLD.withholding_amount
      OR NEW.voids_payment_id IS DISTINCT FROM OLD.voids_payment_id) THEN
      RAISE EXCEPTION 'Paiement exécuté : montant, mode, date et tiers ne se modifient plus. Annulez-le avec un motif puis ressaisissez-le.'
        USING ERRCODE = 'OF409';
    END IF;
    IF OLD.status = 'void' AND NEW.cashed_at IS DISTINCT FROM OLD.cashed_at THEN
      RAISE EXCEPTION 'Paiement annulé : il ne peut plus être encaissé.' USING ERRCODE = 'OF409';
    END IF;
    IF OLD.status = 'void' AND NEW.status <> 'void' THEN
      RAISE EXCEPTION 'Un paiement annulé ne se rétablit pas : ressaisissez-le.' USING ERRCODE = 'OF409';
    END IF;
    NEW.updated_at := now();
    IF NEW.updated_by IS NOT DISTINCT FROM OLD.updated_by THEN
      NEW.updated_by := NULLIF(current_setting('app.user_id', true), '')::uuid;
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT ------------------------------------------------------------
  IF NEW.payment_method = 'avoir' THEN RETURN NEW; END IF;   -- pseudo-paiement d'avoir (G-D7-02)

  IF NEW.payment_mode IS NULL THEN
    NEW.payment_mode := CASE NEW.payment_method
      WHEN 'cash' THEN 'cash' WHEN 'check' THEN 'cheque_barre' WHEN 'traite' THEN 'effet'
      WHEN 'transfer' THEN 'virement' WHEN 'bank' THEN 'virement'
      WHEN 'card' THEN 'carte' WHEN 'mobile' THEN 'mobile' END;
    IF NEW.payment_mode IS NULL THEN
      RAISE EXCEPTION 'Mode de paiement « % » inconnu', NEW.payment_method USING ERRCODE = 'OF409';
    END IF;
  END IF;
  SELECT * INTO v_mode FROM payment_modes WHERE code = NEW.payment_mode;
  IF NOT FOUND OR (NOT v_mode.is_active AND NEW.voids_payment_id IS NULL) THEN
    RAISE EXCEPTION 'Mode de paiement « % » inconnu ou inactif', NEW.payment_mode USING ERRCODE = 'OF409';
  END IF;
  NEW.payment_method := v_mode.legacy_method;   -- l'héritage suit toujours le mode typé

  IF NEW.treasury_account_id IS NULL THEN
    SELECT id INTO NEW.treasury_account_id FROM treasury_accounts
     WHERE kind = v_mode.treasury_kind AND is_default AND is_active;
  END IF;

  v_ref := NULLIF(btrim(COALESCE(NEW.check_number, NEW.reference, '')), '');
  IF v_mode.requires_reference AND v_ref IS NULL AND NEW.voids_payment_id IS NULL
     AND COALESCE(current_setting('app.backfill', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Référence obligatoire pour un règlement « % » (n° de chèque, d''effet ou de virement)', v_mode.label
      USING ERRCODE = 'OF409';
  END IF;

  IF NEW.status = 'executed' THEN
    NEW.executed_at := COALESCE(NEW.executed_at, now());
    NEW.executed_by := COALESCE(NEW.executed_by, NEW.created_by);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS payments_a_normalize ON payments;
CREATE TRIGGER payments_a_normalize BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION trg_payments_normalize();

CREATE OR REPLACE FUNCTION trg_payments_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'draft' OR COALESCE(current_setting('app.payment_purge', true), '') = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Un paiement exécuté ne se supprime pas : annulez-le avec un motif (contre-pièce).'
    USING ERRCODE = 'OF409';
END $$;
DROP TRIGGER IF EXISTS payments_no_delete ON payments;
CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION trg_payments_no_delete();

-- La garde « facture bloquée » (mig 309) ne s'applique pas à une contre-pièce.
CREATE OR REPLACE FUNCTION trg_payments_guard_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_inv invoices%ROWTYPE; v_codes TEXT; v_mode TEXT;
BEGIN
  IF NEW.invoice_id IS NULL OR NEW.amount <= 0 THEN RETURN NEW; END IF;
  SELECT * INTO v_inv FROM invoices WHERE id = NEW.invoice_id;
  IF NOT FOUND OR v_inv.invoice_type <> 'received' THEN RETURN NEW; END IF;
  IF v_inv.validation_status <> 'validated' THEN
    RAISE EXCEPTION 'La facture % n''est pas validée (%) : paiement impossible',
      COALESCE(v_inv.supplier_invoice_number, v_inv.invoice_number), v_inv.validation_status USING ERRCODE = 'OF409';
  END IF;
  SELECT value ->> 'mode' INTO v_mode FROM module_parameters WHERE key = 'purchasing.invoice_holds_enforcement';
  IF COALESCE(v_mode, 'block') = 'block' THEN
    SELECT string_agg(DISTINCT hc.label, ', ') INTO v_codes
      FROM invoice_holds h JOIN hold_codes hc ON hc.code = h.hold_code
     WHERE h.invoice_id = NEW.invoice_id AND h.released_at IS NULL AND h.blocks_payment;
    IF v_codes IS NOT NULL THEN
      RAISE EXCEPTION 'La facture % est bloquée (%) : levez le blocage avec un motif avant de payer',
        COALESCE(v_inv.supplier_invoice_number, v_inv.invoice_number), v_codes USING ERRCODE = 'OF409';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ═══ 8. Compteur espèces (G-D7-04) ═════════════════════════════════════
-- Cumul des règlements soumis au plafond (espèces, chèque non barré) chez un
-- fournisseur, hors paiements annulés (l'original et sa contre-pièce sont 'void').
CREATE OR REPLACE FUNCTION fn_cash_cumul(p_supplier uuid, p_date date, p_exclude uuid DEFAULT NULL)
RETURNS TABLE (day_total numeric, month_total numeric, day_count int) LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(p.amount) FILTER (WHERE p.payment_date = p_date), 0),
         COALESCE(SUM(p.amount), 0),
         (count(*) FILTER (WHERE p.payment_date = p_date))::int
    FROM payments p JOIN payment_modes m ON m.code = p.payment_mode
   WHERE p.supplier_id = p_supplier
     AND NOT m.deductible_over_cash_limit
     AND p.status <> 'void'
     AND p.type <> 'internal_transfer'
     AND date_trunc('month', p.payment_date) = date_trunc('month', p_date)
     AND p.id IS DISTINCT FROM p_exclude
$$;

CREATE TABLE IF NOT EXISTS cash_limit_overrides (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id       uuid NOT NULL REFERENCES payments(id),
  supplier_id      uuid NOT NULL REFERENCES suppliers(id),
  threshold_code   varchar(40) NOT NULL,
  cumul_before     numeric(14,2) NOT NULL,
  amount           numeric(14,2) NOT NULL,
  threshold_value  numeric(14,2) NOT NULL,
  reason_code_id   uuid NOT NULL REFERENCES ref_entries(id),
  note             text,
  override_by      uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS cash_limit_overrides_append_only ON cash_limit_overrides;
CREATE TRIGGER cash_limit_overrides_append_only BEFORE UPDATE OR DELETE ON cash_limit_overrides
  FOR EACH ROW EXECUTE FUNCTION trg_audit_append_only();

CREATE OR REPLACE FUNCTION trg_payments_cash_limit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_mode payment_modes%ROWTYPE; v_sup suppliers%ROWTYPE;
  v_day numeric; v_month numeric; v_cnt int;
  v_lim_d numeric; v_lim_m numeric; v_warn numeric;
  v_after_d numeric; v_after_m numeric; v_exceeded boolean; v_enf text; v_override text;
BEGIN
  IF NEW.amount <= 0 OR NEW.supplier_id IS NULL OR NEW.type = 'internal_transfer'
     OR NEW.payment_mode IS NULL OR NEW.status = 'void' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_mode FROM payment_modes WHERE code = NEW.payment_mode;
  IF v_mode.deductible_over_cash_limit THEN RETURN NEW; END IF;
  SELECT * INTO v_sup FROM suppliers WHERE id = NEW.supplier_id;
  IF v_sup.kind = 'divers' THEN RETURN NEW; END IF;

  v_lim_d := fn_fiscal_threshold('CASH_DAILY_PER_SUPPLIER', NEW.payment_date);
  v_lim_m := fn_fiscal_threshold('CASH_MONTHLY_PER_SUPPLIER', NEW.payment_date);
  v_warn  := COALESCE(fn_fiscal_threshold('CASH_WARN_PCT', NEW.payment_date), 80);
  IF v_lim_d IS NULL AND v_lim_m IS NULL THEN RETURN NEW; END IF;

  SELECT day_total, month_total, day_count INTO v_day, v_month, v_cnt
    FROM fn_cash_cumul(NEW.supplier_id, NEW.payment_date, NEW.id);
  v_after_d := v_day + NEW.amount;
  v_after_m := v_month + NEW.amount;
  v_exceeded := (v_lim_d IS NOT NULL AND v_after_d > v_lim_d) OR (v_lim_m IS NOT NULL AND v_after_m > v_lim_m);
  v_override := NULLIF(current_setting('app.cash_override_reason', true), '');

  NEW.cash_limit_check := jsonb_build_object(
    'day_before', v_day, 'month_before', v_month, 'day_count_before', v_cnt,
    'day_limit', v_lim_d, 'month_limit', v_lim_m, 'warn_pct', v_warn,
    'day_after', v_after_d, 'month_after', v_after_m,
    'warning', (v_lim_d IS NOT NULL AND v_after_d >= v_lim_d * v_warn / 100)
            OR (v_lim_m IS NOT NULL AND v_after_m >= v_lim_m * v_warn / 100),
    'exceeded', v_exceeded, 'agri_exception', v_sup.supplies_unprocessed_agri,
    'override_reason_code_id', v_override,
    'override_note', NULLIF(current_setting('app.cash_override_note', true), ''));

  IF NOT v_exceeded OR v_sup.supplies_unprocessed_agri THEN RETURN NEW; END IF;

  SELECT value ->> 'mode' INTO v_enf FROM module_parameters WHERE key = 'purchasing.cash_limit_enforcement';
  IF COALESCE(v_enf, 'warn') = 'block' AND v_override IS NULL THEN
    RAISE EXCEPTION 'Plafond espèces dépassé chez % : % DH ce jour (plafond % DH), % DH ce mois (plafond % DH). Réglez par chèque barré, effet ou virement, ou demandez une dérogation admin motivée.',
      v_sup.name, round(v_after_d, 2), v_lim_d, round(v_after_m, 2), v_lim_m USING ERRCODE = 'OF409';
  END IF;
  -- Au-delà du plafond, la charge (et sa TVA) n'est pas déductible : on le marque.
  NEW.non_deductible := true;
  NEW.non_deductible_reason := 'cash_over_limit';
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS payments_b_cash_limit ON payments;
CREATE TRIGGER payments_b_cash_limit BEFORE INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION trg_payments_cash_limit();

CREATE OR REPLACE FUNCTION trg_payments_cash_override_log() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c jsonb := NEW.cash_limit_check; v_code text; v_before numeric; v_lim numeric;
BEGIN
  IF c IS NULL OR NOT COALESCE((c->>'exceeded')::boolean, false) OR c->>'override_reason_code_id' IS NULL THEN
    RETURN NULL;
  END IF;
  IF (c->>'day_limit') IS NOT NULL AND (c->>'day_after')::numeric > (c->>'day_limit')::numeric THEN
    v_code := 'CASH_DAILY_PER_SUPPLIER'; v_before := (c->>'day_before')::numeric; v_lim := (c->>'day_limit')::numeric;
  ELSE
    v_code := 'CASH_MONTHLY_PER_SUPPLIER'; v_before := (c->>'month_before')::numeric; v_lim := (c->>'month_limit')::numeric;
  END IF;
  INSERT INTO cash_limit_overrides (payment_id, supplier_id, threshold_code, cumul_before, amount, threshold_value,
                                    reason_code_id, note, override_by)
  VALUES (NEW.id, NEW.supplier_id, v_code, v_before, NEW.amount, v_lim,
          (c->>'override_reason_code_id')::uuid, c->>'override_note',
          COALESCE(NULLIF(current_setting('app.user_id', true), '')::uuid, NEW.created_by));
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS payments_cash_override_log ON payments;
CREATE TRIGGER payments_cash_override_log AFTER INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION trg_payments_cash_override_log();

-- Fractionnement suspect et dépassements (historique compris) — onglet Exceptions (D9).
CREATE OR REPLACE VIEW v_cash_limit_breaches AS
SELECT s.id AS supplier_id, s.name AS supplier_name, p.payment_date,
       count(*) AS payment_count, sum(p.amount) AS day_total,
       fn_fiscal_threshold('CASH_DAILY_PER_SUPPLIER', p.payment_date) AS day_limit,
       sum(p.amount) > fn_fiscal_threshold('CASH_DAILY_PER_SUPPLIER', p.payment_date) AS exceeded,
       count(*) >= 3 AS split_suspect,
       bool_or(p.non_deductible) AS flagged_non_deductible
  FROM payments p
  JOIN payment_modes m ON m.code = p.payment_mode AND NOT m.deductible_over_cash_limit
  JOIN suppliers s ON s.id = p.supplier_id AND s.kind = 'tiers' AND NOT s.supplies_unprocessed_agri
 WHERE p.status <> 'void' AND p.type <> 'internal_transfer'
 GROUP BY s.id, s.name, p.payment_date
HAVING sum(p.amount) > fn_fiscal_threshold('CASH_DAILY_PER_SUPPLIER', p.payment_date)
    OR (count(*) >= 3 AND sum(p.amount) >= fn_fiscal_threshold('CASH_DAILY_PER_SUPPLIER', p.payment_date)
                          * COALESCE(fn_fiscal_threshold('CASH_WARN_PCT', p.payment_date), 80) / 100);

-- ═══ 9. Motifs d'annulation de paiement et journal des actions ═════════
INSERT INTO ref_entries (table_id, code, label, display_order, metadata) VALUES
  ('purchase_reason_codes', 'void_entry_error', 'Erreur de saisie du règlement', 60, '{"scope":["void_payment"]}'),
  ('purchase_reason_codes', 'void_duplicate',   'Règlement saisi en double',     61, '{"scope":["void_payment"]}'),
  ('purchase_reason_codes', 'void_cheque_lost', 'Chèque ou effet perdu',         62, '{"scope":["void_payment"]}'),
  ('purchase_reason_codes', 'void_bank_reject', 'Rejet bancaire',                63, '{"scope":["void_payment"]}'),
  ('purchase_reason_codes', 'void_not_sent',    'Règlement jamais remis au fournisseur', 64, '{"scope":["void_payment"]}')
ON CONFLICT (table_id, code) DO NOTHING;
UPDATE ref_entries SET metadata = jsonb_set(metadata, '{scope}', (metadata->'scope') || '["void_payment"]'::jsonb)
 WHERE table_id = 'purchase_reason_codes' AND code = 'other' AND NOT (metadata->'scope' ? 'void_payment');

ALTER TABLE document_actions DROP CONSTRAINT IF EXISTS document_actions_document_type_check;
ALTER TABLE document_actions ADD CONSTRAINT document_actions_document_type_check CHECK (document_type IN
  ('purchase_request','purchase_order','reception_voucher','supplier_invoice','expense_payment','supplier','payment'));

-- ═══ 10. Rapprochement bancaire : une ligne pointée ne se perd plus en silence ═══
ALTER TABLE bank_statement_lines DROP CONSTRAINT IF EXISTS bank_statement_lines_matched_entry_line_id_fkey;
ALTER TABLE bank_statement_lines ADD CONSTRAINT bank_statement_lines_matched_entry_line_id_fkey
  FOREIGN KEY (matched_entry_line_id) REFERENCES journal_entry_lines(id) ON DELETE RESTRICT;
