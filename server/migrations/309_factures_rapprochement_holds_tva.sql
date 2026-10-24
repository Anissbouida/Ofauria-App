-- Migration 309 : Facture fournisseur — pièce du fournisseur, statuts séparés et immuabilité,
-- rapprochement par ligne avec tolérances, blocages de paiement, TVA par codes datés,
-- contrôle des mentions légales, anti-doublon (refonte Achats, domaine D6, lot 1 :
-- G-D6-01, G-D6-03, G-D6-05, G-D6-07, G-D6-08, G-D6-11, G-D6-12, G-D6-13 ; prérequis G-D6-04/06)
--
-- POURQUOI
--   La facture reçue est une copie du bon de réception : numéro interne FR- (250/317), TVA nulle
--   (263/294 factures automatiques), aucun rapprochement avec la commande et la réception
--   (36 factures diffèrent de leur réception pour 16 663 DH), aucun blocage : une facture en
--   écart, en doublon probable ou sans ICE reste payable. Le statut mêle règlement et annulation,
--   « payée » se pose à la main, une facture payée reste modifiable, la fusion supprime des factures.
--
-- MODÈLE (factures reçues uniquement ; les factures émises ne changent pas)
--   invoices.kind, supplier_invoice_number (vérité fournisseur), received_on, accounting_date,
--   declared_ht/vat/ttc (montants imprimés), source, validation_status (draft/validated/cancelled),
--   payment_status (unpaid/partial/paid, dérivé du payé), legal_issues, colonnes e-facture réservées.
--   invoice_items.purchase_order_item_id : la ligne facturée pointe la ligne commandée.
--   tax_codes : taux datés par pays (pack pays) ; code par défaut sur catégorie / article.
--   match_tolerances : tolérances quantité / prix / montant, globales ou par fournisseur.
--   hold_codes + invoice_holds : blocages posés et levés par fn_validate_invoice ; certains
--   bloquent le paiement, d'autres signalent seulement.
--   fn_validate_invoice : contrôle unique, idempotent, rejoué automatiquement (trigger différé)
--   quand la facture, ses lignes, une réception de la commande ou la fiche fournisseur changent.
--
-- INVERSION
--   DROP TRIGGER invoices_* , invoice_items_*, payments_guard_invoice_holds, po_line_events_revalidate,
--   supplier_identifiers_revalidate ; DROP FUNCTION fn_validate_invoice et associées ;
--   DROP VIEW v_invoice_item_match, v_invoice_payable ; DROP TABLE invoice_holds, hold_codes,
--   match_tolerances, tax_codes ; ALTER TABLE ... DROP COLUMN des colonnes ajoutées.

-- ═══════════════════════════════════════════════════════════════════════
-- 0. Paramètres et motifs
-- ═══════════════════════════════════════════════════════════════════════
INSERT INTO module_parameters (key, value, description) VALUES
  ('purchasing.invoice_holds_enforcement', '{"mode": "block"}'::jsonb,
   'Blocages de facture : block = un blocage bloquant empêche le paiement ; warn = signalé seulement.'),
  ('company.country_code', '{"code": "MA"}'::jsonb,
   'Pays de la société : choisit le pack pays (codes TVA, identifiants légaux exigés).')
ON CONFLICT (key) DO NOTHING;

INSERT INTO ref_entries (table_id, code, label, display_order, metadata) VALUES
  ('purchase_reason_codes', 'hold_justified',        'Écart justifié (pièce vérifiée)',       50, '{"scope":["release_hold"]}'),
  ('purchase_reason_codes', 'distinct_invoice',      'Facture distincte confirmée',           51, '{"scope":["release_hold"]}'),
  ('purchase_reason_codes', 'credit_note_expected',  'Avoir attendu du fournisseur',          52, '{"scope":["release_hold"]}'),
  ('purchase_reason_codes', 'invoice_entry_error',   'Erreur de saisie de la facture',        53, '{"scope":["cancel_invoice","reopen_invoice"]}'),
  ('purchase_reason_codes', 'invoice_duplicate',     'Facture en double',                     54, '{"scope":["cancel_invoice"]}'),
  ('purchase_reason_codes', 'invoice_replaced',      'Remplacée par une facture rectifiée',   55, '{"scope":["cancel_invoice"]}')
ON CONFLICT (table_id, code) DO NOTHING;
UPDATE ref_entries SET metadata = jsonb_set(metadata, '{scope}', (metadata->'scope') || '["release_hold","cancel_invoice","reopen_invoice"]'::jsonb)
 WHERE table_id = 'purchase_reason_codes' AND code = 'other' AND NOT (metadata->'scope' ? 'release_hold');

-- ═══════════════════════════════════════════════════════════════════════
-- 1. CODES DE TVA DATÉS (pack pays) — G-D6-12
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tax_codes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code CHAR(2) NOT NULL,
  code         VARCHAR(20) NOT NULL,
  label        VARCHAR(120) NOT NULL,
  rate         NUMERIC(5,2) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  kind         VARCHAR(25) NOT NULL CHECK (kind IN ('standard', 'reduced', 'zero', 'exempt_without_credit', 'exempt_with_credit', 'out_of_scope')),
  recoverable  BOOLEAN NOT NULL DEFAULT true,
  valid_from   DATE NOT NULL,
  valid_to     DATE,
  legal_ref    TEXT,
  UNIQUE (country_code, code, valid_from)
);
COMMENT ON TABLE tax_codes IS 'Codes de TVA datés par pays (pack pays, mig 309). Un taux qui change = une nouvelle ligne datée, jamais une mise à jour.';

INSERT INTO tax_codes (country_code, code, label, rate, kind, recoverable, valid_from, valid_to, legal_ref) VALUES
  ('MA', 'N20',     'TVA 20 %',                                 20, 'standard', true,  '2000-01-01', NULL,         'CGI art. 98'),
  ('MA', 'R14',     'TVA 14 %',                                 14, 'reduced',  true,  '2000-01-01', '2025-12-31', 'CGI art. 99 (résorbé par les LF 2024-2026)'),
  ('MA', 'R10',     'TVA 10 %',                                 10, 'reduced',  true,  '2000-01-01', NULL,         'CGI art. 99'),
  ('MA', 'R7',      'TVA 7 %',                                   7, 'reduced',  true,  '2000-01-01', '2025-12-31', 'CGI art. 99 (résorbé par les LF 2024-2026)'),
  ('MA', 'EXO_SDD', 'Exonéré sans droit à déduction (art. 91)', 0, 'exempt_without_credit', false, '2000-01-01', NULL, 'CGI art. 91 (farine, lait, beurre, sucre brut, levure fraîche…)'),
  ('MA', 'HC',      'Hors champ / non assujetti',                0, 'out_of_scope', false, '2000-01-01', NULL,       'Fournisseur non assujetti, achat au marché')
ON CONFLICT (country_code, code, valid_from) DO NOTHING;

CREATE OR REPLACE FUNCTION fn_tax_rate(p_code TEXT, p_at DATE)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT rate FROM tax_codes
   WHERE code = p_code
     AND country_code = COALESCE((SELECT value ->> 'code' FROM module_parameters WHERE key = 'company.country_code'), 'MA')
     AND valid_from <= COALESCE(p_at, CURRENT_DATE) AND (valid_to IS NULL OR valid_to >= COALESCE(p_at, CURRENT_DATE))
   ORDER BY valid_from DESC LIMIT 1
$$;

ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS default_tax_code VARCHAR(20);
ALTER TABLE ingredients        ADD COLUMN IF NOT EXISTS default_tax_code VARCHAR(20);
ALTER TABLE packaging_items    ADD COLUMN IF NOT EXISTS default_tax_code VARCHAR(20);
COMMENT ON COLUMN ingredients.default_tax_code IS 'Code TVA attendu à l''achat (tax_codes.code) ; NULL = hériter de la catégorie (mig 309).';

ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS tax_code              VARCHAR(20),
  ADD COLUMN IF NOT EXISTS purchase_order_item_id UUID REFERENCES purchase_order_items(id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_po_line ON invoice_items (purchase_order_item_id) WHERE purchase_order_item_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. LA FACTURE EST LA PIÈCE DU FOURNISSEUR — G-D6-01 / G-D6-08
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS kind                    VARCHAR(20) NOT NULL DEFAULT 'invoice',
  ADD COLUMN IF NOT EXISTS supplier_invoice_number VARCHAR(60),
  ADD COLUMN IF NOT EXISTS received_on             DATE,
  ADD COLUMN IF NOT EXISTS accounting_date         DATE,
  ADD COLUMN IF NOT EXISTS declared_ht             NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS declared_vat            NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS declared_ttc            NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS source                  VARCHAR(15) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS payment_mode_declared   VARCHAR(20),
  ADD COLUMN IF NOT EXISTS validation_status       VARCHAR(10) NOT NULL DEFAULT 'validated',
  ADD COLUMN IF NOT EXISTS payment_status          VARCHAR(10) NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS validated_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS validated_by            UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by            UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason_code_id   UUID REFERENCES ref_entries(id),
  ADD COLUMN IF NOT EXISTS cancel_note             TEXT,
  ADD COLUMN IF NOT EXISTS legal_issues            JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS checked_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_by              UUID REFERENCES users(id),
  -- Facturation électronique (CGI art. 145-IX) : colonnes réservées, aucune intégration (G-D6-15).
  ADD COLUMN IF NOT EXISTS einvoice_uid            VARCHAR(100),
  ADD COLUMN IF NOT EXISTS einvoice_format         VARCHAR(20),
  ADD COLUMN IF NOT EXISTS einvoice_status         VARCHAR(20);
ALTER TABLE invoices
  ADD CONSTRAINT chk_invoices_kind CHECK (kind IN ('invoice', 'credit_note', 'subsequent_debit', 'subsequent_credit', 'prepayment', 'internal_voucher')),
  ADD CONSTRAINT chk_invoices_source CHECK (source IN ('manual', 'from_receipt', 'import', 'voucher', 'recurring', 'legacy_auto', 'merge')),
  ADD CONSTRAINT chk_invoices_validation CHECK (validation_status IN ('draft', 'validated', 'cancelled')),
  ADD CONSTRAINT chk_invoices_payment_status CHECK (payment_status IN ('unpaid', 'partial', 'paid'));

-- Reprise.
UPDATE invoices SET supplier_invoice_number = trim(invoice_number)
 WHERE invoice_type = 'received' AND supplier_invoice_number IS NULL AND invoice_number !~ '^(FR|FA|INV)-';
-- Factures automatiques : le numéro fournisseur saisi à la réception, quand il existe.
UPDATE invoices i SET supplier_invoice_number = trim(rv.supplier_invoice_number)
  FROM reception_vouchers rv
 WHERE rv.id = i.reception_voucher_id AND i.supplier_invoice_number IS NULL AND COALESCE(trim(rv.supplier_invoice_number), '') <> '';
UPDATE invoices SET source = 'legacy_auto' WHERE invoice_type = 'received' AND invoice_number ~ '^FR-' AND purchase_order_id IS NOT NULL;
UPDATE invoices SET
  received_on       = COALESCE(received_on, reception_date, created_at::date),
  accounting_date   = COALESCE(accounting_date, invoice_date),
  validation_status = CASE WHEN status = 'cancelled' THEN 'cancelled' ELSE 'validated' END,
  validated_at      = COALESCE(validated_at, created_at),
  payment_status    = CASE WHEN COALESCE(paid_amount, 0) >= total_amount - 0.005 AND total_amount > 0 THEN 'paid'
                           WHEN COALESCE(paid_amount, 0) > 0 THEN 'partial' ELSE 'unpaid' END;

-- Anti-doublon strict : un numéro fournisseur une seule fois par fournisseur (G-D6-11).
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_supplier_number
  ON invoices (supplier_id, lower(regexp_replace(supplier_invoice_number, '\s', '', 'g')))
  WHERE invoice_type = 'received' AND supplier_invoice_number IS NOT NULL
    AND validation_status <> 'cancelled' AND kind IN ('invoice', 'credit_note');

-- Lien ligne facturée → ligne commandée (même BC, même article).
UPDATE invoice_items ii SET purchase_order_item_id = poi.id
  FROM invoices i, purchase_order_items poi
 WHERE ii.invoice_id = i.id AND ii.purchase_order_item_id IS NULL
   AND i.purchase_order_id IS NOT NULL AND poi.purchase_order_id = i.purchase_order_id
   AND ((ii.ingredient_id IS NOT NULL AND poi.ingredient_id = ii.ingredient_id)
     OR (ii.packaging_id  IS NOT NULL AND poi.packaging_id  = ii.packaging_id));

-- ═══════════════════════════════════════════════════════════════════════
-- 3. TOLÉRANCES ET BLOCAGES — G-D6-06 / G-D6-07
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS match_tolerances (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type  VARCHAR(10) NOT NULL CHECK (scope_type IN ('global', 'supplier')),
  scope_id    UUID,
  qty_pct     NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (qty_pct >= 0),     -- facturé au-delà du reçu
  price_pct   NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (price_pct >= 0),   -- prix facturé vs commandé
  price_abs   NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (price_abs >= 0),
  amount_abs  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount_abs >= 0), -- arrondis (déclaré vs lignes, TVA)
  currency    CHAR(3) NOT NULL DEFAULT 'MAD',
  CHECK ((scope_type = 'global') = (scope_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_match_tolerances_scope ON match_tolerances (scope_type, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid));
INSERT INTO match_tolerances (scope_type, qty_pct, price_pct, price_abs, amount_abs)
SELECT 'global', 2, 2, 0.50, 1.00 WHERE NOT EXISTS (SELECT 1 FROM match_tolerances WHERE scope_type = 'global');

CREATE TABLE IF NOT EXISTS hold_codes (
  code           VARCHAR(30) PRIMARY KEY,
  label          VARCHAR(120) NOT NULL,
  blocks_payment BOOLEAN NOT NULL,
  description    TEXT,
  country_code   CHAR(2)              -- NULL = noyau ; sinon fourni par le pack pays
);
INSERT INTO hold_codes (code, label, blocks_payment, description, country_code) VALUES
  ('QTY_REC',           'Quantité facturée supérieure à la quantité reçue', true,  'Rapprochement 3 voies : facturé > reçu + tolérance.', NULL),
  ('PRICE',             'Prix facturé différent du prix commandé',          true,  'Rapprochement : écart de prix au-delà de la tolérance.', NULL),
  ('AMOUNT_MISMATCH',   'Montants incohérents',                             true,  'Total déclaré ≠ total calculé, ou lignes ≠ en-tête.', NULL),
  ('DUPLICATE_SUSPECT', 'Doublon probable',                                 true,  'Même fournisseur, même montant, dates proches.', NULL),
  ('TAX_VARIANCE',      'TVA à vérifier',                                   false, 'Taux manquant, TVA lignes ≠ TVA d''en-tête, TVA d''un non-assujetti.', NULL),
  ('LEGAL_MENTIONS',    'Mentions légales incomplètes',                     false, 'Identifiants fiscaux du fournisseur ou numéro de facture manquants : TVA et charge non déductibles en contrôle.', 'MA'),
  ('MANUAL',            'Blocage manuel',                                   true,  'Posé par un utilisateur (litige, qualité…).', NULL)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS invoice_holds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  invoice_item_id UUID REFERENCES invoice_items(id) ON DELETE CASCADE,
  hold_code       VARCHAR(30) NOT NULL REFERENCES hold_codes(code),
  blocks_payment  BOOLEAN NOT NULL,          -- figé à la pose (une reprise peut être informative)
  is_system       BOOLEAN NOT NULL DEFAULT true,
  details         JSONB,
  held_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  held_by         UUID REFERENCES users(id),
  released_at     TIMESTAMPTZ,
  released_by     UUID REFERENCES users(id),
  release_mode    VARCHAR(10) CHECK (release_mode IN ('auto', 'manual')),
  release_reason_code_id UUID REFERENCES ref_entries(id),
  release_note    TEXT,
  CHECK (released_at IS NULL OR release_mode IS NOT NULL),
  CHECK (release_mode IS DISTINCT FROM 'manual' OR release_reason_code_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_invoice_holds_open ON invoice_holds (invoice_id) WHERE released_at IS NULL;
-- Un seul blocage système ouvert par (facture, ligne, code).
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_holds_open_system
  ON invoice_holds (invoice_id, COALESCE(invoice_item_id, '00000000-0000-0000-0000-000000000000'::uuid), hold_code)
  WHERE released_at IS NULL AND is_system;
COMMENT ON TABLE invoice_holds IS 'Blocages de facture (mig 309) : posés et levés automatiquement par fn_validate_invoice ; levée manuelle motivée.';

-- Rapprochement par ligne : commandé / reçu / facturé (toutes factures actives) / prix.
CREATE OR REPLACE VIEW v_invoice_item_match AS
SELECT ii.id AS invoice_item_id, ii.invoice_id, ii.purchase_order_item_id,
       COALESCE(ii.description, ing.name, pkg.name) AS item_name,
       poi.quantity_ordered, poi.qty_received_base AS quantity_received,
       (SELECT COALESCE(SUM(x.quantity), 0) FROM invoice_items x JOIN invoices xi ON xi.id = x.invoice_id
         WHERE x.purchase_order_item_id = ii.purchase_order_item_id AND xi.validation_status <> 'cancelled') AS quantity_invoiced_total,
       ii.quantity AS quantity_invoiced_here,
       poi.unit_price AS po_unit_price, ii.unit_price AS invoiced_unit_price,
       CASE WHEN poi.unit_price IS NULL THEN NULL ELSE ii.unit_price - poi.unit_price END AS price_variance
  FROM invoice_items ii
  LEFT JOIN purchase_order_items poi ON poi.id = ii.purchase_order_item_id
  LEFT JOIN ingredients ing ON ing.id = ii.ingredient_id
  LEFT JOIN packaging_items pkg ON pkg.id = ii.packaging_id;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. LE CONTRÔLE UNIQUE — fn_validate_invoice
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION fn_open_hold(p_inv UUID, p_item UUID, p_code TEXT, p_details JSONB, p_legacy BOOLEAN)
RETURNS VOID AS $$
BEGIN
  INSERT INTO invoice_holds (invoice_id, invoice_item_id, hold_code, blocks_payment, details)
  SELECT p_inv, p_item, p_code, hc.blocks_payment AND NOT p_legacy,
         COALESCE(p_details, '{}'::jsonb) || CASE WHEN p_legacy THEN '{"legacy": true}'::jsonb ELSE '{}'::jsonb END
    FROM hold_codes hc WHERE hc.code = p_code
  ON CONFLICT (invoice_id, COALESCE(invoice_item_id, '00000000-0000-0000-0000-000000000000'::uuid), hold_code)
    WHERE released_at IS NULL AND is_system
  DO UPDATE SET details = EXCLUDED.details;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_validate_invoice(p_invoice UUID, p_legacy BOOLEAN DEFAULT false)
RETURNS JSONB AS $$
DECLARE
  v_inv     invoices%ROWTYPE;
  v_sup     suppliers%ROWTYPE;
  v_tol     match_tolerances%ROWTYPE;
  v_country TEXT := COALESCE((SELECT value ->> 'code' FROM module_parameters WHERE key = 'company.country_code'), 'MA');
  v_lines   NUMERIC; v_lines_tva NUMERIC; v_nolines INT; v_norate INT;
  v_issues  JSONB := '[]'::jsonb;
  v_keep    TEXT[] := ARRAY[]::TEXT[];   -- clés (code:item) des blocages encore justifiés
  r         RECORD;
  v_dup     RECORD;
BEGIN
  SELECT * INTO v_inv FROM invoices WHERE id = p_invoice;
  IF NOT FOUND OR v_inv.invoice_type <> 'received' THEN RETURN NULL; END IF;

  -- Une facture annulée ou en brouillon n'a pas de blocage actif.
  IF v_inv.validation_status <> 'validated' THEN
    UPDATE invoice_holds SET released_at = now(), release_mode = 'auto'
     WHERE invoice_id = p_invoice AND released_at IS NULL AND is_system;
    RETURN jsonb_build_object('status', v_inv.validation_status);
  END IF;

  SELECT * INTO v_sup FROM suppliers WHERE id = v_inv.supplier_id;
  SELECT * INTO v_tol FROM match_tolerances
   WHERE (scope_type = 'supplier' AND scope_id = v_inv.supplier_id) OR scope_type = 'global'
   ORDER BY (scope_type = 'supplier') DESC LIMIT 1;

  SELECT COALESCE(SUM(subtotal), 0), COALESCE(SUM(COALESCE(tva_amount, 0)), 0), count(*), count(*) FILTER (WHERE tva_rate IS NULL)
    INTO v_lines, v_lines_tva, v_nolines, v_norate
    FROM invoice_items WHERE invoice_id = p_invoice;

  -- (a) Montants : déclaré vs calculé, lignes vs en-tête.
  IF v_inv.declared_ttc IS NOT NULL AND abs(v_inv.declared_ttc - v_inv.total_amount) > v_tol.amount_abs THEN
    PERFORM fn_open_hold(p_invoice, NULL, 'AMOUNT_MISMATCH', jsonb_build_object('declared_ttc', v_inv.declared_ttc, 'computed_ttc', v_inv.total_amount), p_legacy);
    v_keep := array_append(v_keep, 'AMOUNT_MISMATCH:');
  ELSIF v_nolines > 0 AND abs(v_lines - v_inv.amount) > v_tol.amount_abs THEN
    PERFORM fn_open_hold(p_invoice, NULL, 'AMOUNT_MISMATCH', jsonb_build_object('lines_ht', v_lines, 'header_ht', v_inv.amount), p_legacy);
    v_keep := array_append(v_keep, 'AMOUNT_MISMATCH:');
  END IF;

  -- (b) Rapprochement 3 voies par ligne liée à une ligne de BC.
  FOR r IN SELECT * FROM v_invoice_item_match WHERE invoice_id = p_invoice AND purchase_order_item_id IS NOT NULL LOOP
    IF r.quantity_invoiced_total > r.quantity_received * (1 + v_tol.qty_pct / 100) + 0.0001 THEN
      PERFORM fn_open_hold(p_invoice, r.invoice_item_id, 'QTY_REC',
        jsonb_build_object('item', r.item_name, 'invoiced', r.quantity_invoiced_total, 'received', r.quantity_received, 'tolerance_pct', v_tol.qty_pct), p_legacy);
      v_keep := array_append(v_keep, ('QTY_REC:' || r.invoice_item_id));
    END IF;
    IF r.po_unit_price IS NOT NULL
       AND abs(r.price_variance) > GREATEST(v_tol.price_abs, r.po_unit_price * v_tol.price_pct / 100) + 0.00001 THEN
      PERFORM fn_open_hold(p_invoice, r.invoice_item_id, 'PRICE',
        jsonb_build_object('item', r.item_name, 'po_price', r.po_unit_price, 'invoiced_price', r.invoiced_unit_price, 'tolerance_pct', v_tol.price_pct), p_legacy);
      v_keep := array_append(v_keep, ('PRICE:' || r.invoice_item_id));
    END IF;
  END LOOP;

  -- (c) Doublon probable : même fournisseur, même TTC, dates à ±5 jours, autre facture active.
  IF v_inv.kind = 'invoice' THEN
    SELECT i.id, i.invoice_number, i.supplier_invoice_number, i.invoice_date INTO v_dup
      FROM invoices i
     WHERE i.id <> p_invoice AND i.invoice_type = 'received' AND i.kind = 'invoice'
       AND i.validation_status <> 'cancelled' AND i.supplier_id = v_inv.supplier_id
       AND abs(i.total_amount - v_inv.total_amount) <= v_tol.amount_abs
       AND abs(i.invoice_date - v_inv.invoice_date) <= 5
       AND NOT EXISTS (SELECT 1 FROM invoice_holds h WHERE h.invoice_id = p_invoice AND h.hold_code = 'DUPLICATE_SUSPECT'
                        AND h.release_mode = 'manual' AND (h.details ->> 'candidate_invoice_id')::uuid = i.id)
     ORDER BY abs(i.invoice_date - v_inv.invoice_date) LIMIT 1;
    IF FOUND THEN
      PERFORM fn_open_hold(p_invoice, NULL, 'DUPLICATE_SUSPECT',
        jsonb_build_object('candidate_invoice_id', v_dup.id, 'candidate_number', COALESCE(v_dup.supplier_invoice_number, v_dup.invoice_number), 'candidate_date', v_dup.invoice_date), p_legacy);
      v_keep := array_append(v_keep, 'DUPLICATE_SUSPECT:');
    END IF;
  END IF;

  -- (d) TVA : taux manquants, TVA lignes ≠ en-tête, TVA facturée par un non-assujetti.
  IF v_inv.kind <> 'internal_voucher' AND (
       (v_sup.vat_regime = 'assujetti' AND v_norate > 0)
    OR (v_nolines > 0 AND v_norate = 0 AND abs(v_lines_tva - v_inv.tax_amount) > v_tol.amount_abs)
    OR (v_sup.vat_regime = 'non_assujetti' AND v_inv.tax_amount > 0)) THEN
    PERFORM fn_open_hold(p_invoice, NULL, 'TAX_VARIANCE', jsonb_build_object(
      'lines_without_rate', v_norate, 'lines_vat', v_lines_tva, 'header_vat', v_inv.tax_amount, 'supplier_vat_regime', v_sup.vat_regime), p_legacy);
    v_keep := array_append(v_keep, 'TAX_VARIANCE:');
  END IF;

  -- (e) Mentions légales (pack pays) : identifiants exigés pour la déduction, numéro de facture.
  IF v_inv.kind IN ('invoice', 'credit_note') THEN
    IF COALESCE(trim(v_inv.supplier_invoice_number), '') = '' THEN
      v_issues := v_issues || jsonb_build_object('code', 'SUPPLIER_INVOICE_NUMBER_MISSING', 'label', 'Numéro de facture du fournisseur absent');
    END IF;
    IF v_sup.vat_regime = 'assujetti' THEN
      FOR r IN SELECT t.code, t.label FROM identifier_types t
                WHERE t.country_code = v_country AND t.required_for_vat_deduction AND t.is_active
                  AND NOT EXISTS (SELECT 1 FROM supplier_identifiers si
                                   WHERE si.type_code = t.code
                                     AND si.supplier_id IN (v_sup.id, COALESCE(v_sup.parent_supplier_id, v_sup.id))) LOOP
        v_issues := v_issues || jsonb_build_object('code', 'SUPPLIER_' || r.code || '_MISSING', 'label', r.label || ' du fournisseur absent');
      END LOOP;
    END IF;
    IF v_inv.tax_amount > 0 AND v_nolines > 0 AND v_norate = v_nolines THEN
      v_issues := v_issues || jsonb_build_object('code', 'VAT_NOT_SPLIT', 'label', 'TVA non ventilée par taux');
    END IF;
  END IF;
  IF jsonb_array_length(v_issues) > 0 THEN
    PERFORM fn_open_hold(p_invoice, NULL, 'LEGAL_MENTIONS', jsonb_build_object('issues', v_issues), p_legacy);
    v_keep := array_append(v_keep, 'LEGAL_MENTIONS:');
  END IF;

  -- Levée automatique des blocages système dont la cause a disparu.
  UPDATE invoice_holds h SET released_at = now(), release_mode = 'auto'
   WHERE h.invoice_id = p_invoice AND h.released_at IS NULL AND h.is_system
     AND NOT ((h.hold_code || ':' || COALESCE(h.invoice_item_id::text, '')) = ANY (v_keep));

  -- Mis à jour seulement s'il change (pas de bruit dans le journal d'audit).
  UPDATE invoices SET legal_issues = v_issues, checked_at = now()
   WHERE id = p_invoice AND legal_issues IS DISTINCT FROM v_issues;

  RETURN jsonb_build_object('holds', (SELECT COALESCE(jsonb_agg(hold_code), '[]'::jsonb) FROM invoice_holds WHERE invoice_id = p_invoice AND released_at IS NULL),
                            'legal_issues', v_issues);
END;
$$ LANGUAGE plpgsql;

-- Facture payable : validée, non soldée, sans blocage bloquant ouvert.
CREATE OR REPLACE VIEW v_invoice_payable AS
SELECT i.id AS invoice_id,
       i.validation_status = 'validated'
       AND NOT EXISTS (SELECT 1 FROM invoice_holds h WHERE h.invoice_id = i.id AND h.released_at IS NULL AND h.blocks_payment) AS payable,
       (SELECT COALESCE(jsonb_agg(jsonb_build_object('code', h.hold_code, 'blocks', h.blocks_payment)), '[]'::jsonb)
          FROM invoice_holds h WHERE h.invoice_id = i.id AND h.released_at IS NULL) AS open_holds
  FROM invoices i WHERE i.invoice_type = 'received';

-- ═══════════════════════════════════════════════════════════════════════
-- 5. RÉACTIVITÉ, IMMUABILITÉ, PAIEMENT
-- ═══════════════════════════════════════════════════════════════════════
-- Contrôle rejoué au COMMIT (différé) : une seule exécution avec les lignes en place.
CREATE OR REPLACE FUNCTION trg_invoice_revalidate()
RETURNS TRIGGER AS $$
DECLARE v_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'invoices' THEN
    v_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    v_id := OLD.invoice_id;
  ELSE
    v_id := NEW.invoice_id;
  END IF;
  IF EXISTS (SELECT 1 FROM invoices WHERE id = v_id) THEN PERFORM fn_validate_invoice(v_id); END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invoices_revalidate ON invoices;
CREATE CONSTRAINT TRIGGER invoices_revalidate
  AFTER INSERT OR UPDATE OF supplier_id, supplier_invoice_number, invoice_date, amount, tax_amount, total_amount,
                            declared_ht, declared_vat, declared_ttc, purchase_order_id, validation_status, kind
  ON invoices DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.invoice_type = 'received') EXECUTE FUNCTION trg_invoice_revalidate();

DROP TRIGGER IF EXISTS invoice_items_revalidate ON invoice_items;
CREATE CONSTRAINT TRIGGER invoice_items_revalidate
  AFTER INSERT OR UPDATE OR DELETE ON invoice_items DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_invoice_revalidate();

-- Une réception ou une correction change le « reçu » : les factures liées sont recontrôlées.
CREATE OR REPLACE FUNCTION trg_po_events_revalidate_invoices()
RETURNS TRIGGER AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT ii.invoice_id FROM invoice_items ii WHERE ii.purchase_order_item_id = NEW.po_line_id LOOP
    PERFORM fn_validate_invoice(r.invoice_id);
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS po_line_events_revalidate ON po_line_events;
CREATE CONSTRAINT TRIGGER po_line_events_revalidate AFTER INSERT ON po_line_events DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_po_events_revalidate_invoices();

-- Un identifiant fiscal ajouté lève le blocage « mentions » des factures ouvertes du fournisseur.
CREATE OR REPLACE FUNCTION trg_supplier_revalidate_invoices()
RETURNS TRIGGER AS $$
DECLARE r RECORD; v_sup UUID := COALESCE(NEW.supplier_id, OLD.supplier_id);
BEGIN
  FOR r IN SELECT id FROM invoices
            WHERE invoice_type = 'received' AND validation_status = 'validated' AND payment_status <> 'paid'
              AND supplier_id IN (SELECT id FROM suppliers WHERE id = v_sup OR parent_supplier_id = v_sup) LOOP
    PERFORM fn_validate_invoice(r.id);
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS supplier_identifiers_revalidate ON supplier_identifiers;
CREATE CONSTRAINT TRIGGER supplier_identifiers_revalidate AFTER INSERT OR UPDATE OR DELETE ON supplier_identifiers
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_supplier_revalidate_invoices();

-- Statut de paiement dérivé du payé ; « annulée » du statut historique = annulation.
CREATE OR REPLACE FUNCTION trg_invoices_derive()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.invoice_type <> 'received' THEN RETURN NEW; END IF;
  -- Numéro fournisseur repris du numéro saisi quand ce n'est pas un numéro interne.
  IF NEW.supplier_invoice_number IS NULL AND NEW.invoice_number !~ '^(FR|FA|INV)-' THEN
    NEW.supplier_invoice_number := trim(NEW.invoice_number);
  END IF;
  NEW.payment_status := CASE WHEN COALESCE(NEW.paid_amount, 0) >= NEW.total_amount - 0.005 AND NEW.total_amount > 0 THEN 'paid'
                             WHEN COALESCE(NEW.paid_amount, 0) > 0 THEN 'partial' ELSE 'unpaid' END;
  IF NEW.status = 'cancelled' AND NEW.validation_status <> 'cancelled' THEN
    NEW.validation_status := 'cancelled';
    NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
  END IF;
  IF TG_OP = 'UPDATE' THEN NEW.updated_at := now(); END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS invoices_derive ON invoices;
CREATE TRIGGER invoices_derive BEFORE INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION trg_invoices_derive();

-- Immuabilité d'une facture validée (G-D6-08) : les montants et l'identité de la pièce ne changent
-- plus ; il faut la repasser en brouillon (si non payée) ou faire un avoir. Catégorie, échéance,
-- mode de paiement prévu, notes et pièce jointe restent modifiables.
CREATE OR REPLACE FUNCTION trg_invoices_guard_validated()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.invoice_type <> 'received' OR COALESCE(current_setting('app.invoice_edit', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.validation_status <> 'draft' THEN
      RAISE EXCEPTION 'La facture % %', COALESCE(OLD.supplier_invoice_number, OLD.invoice_number),
        CASE OLD.validation_status WHEN 'validated' THEN 'est validée : elle s''annule avec un motif, elle ne se supprime pas'
             ELSE 'est annulée : elle reste conservée comme pièce, elle ne se supprime pas' END
        USING ERRCODE = 'OF409';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.validation_status = 'validated' AND NEW.validation_status = 'validated'
     AND (NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
       OR NEW.supplier_invoice_number IS DISTINCT FROM OLD.supplier_invoice_number
       OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
       OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date
       OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
       OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
       OR NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.purchase_order_id IS DISTINCT FROM OLD.purchase_order_id) THEN
    RAISE EXCEPTION 'La facture % est validée : repassez-la en brouillon (si elle n''est pas payée) pour la modifier',
      COALESCE(OLD.supplier_invoice_number, OLD.invoice_number) USING ERRCODE = 'OF409';
  END IF;
  IF OLD.validation_status = 'cancelled' AND NEW.validation_status = 'cancelled'
     AND (NEW.total_amount IS DISTINCT FROM OLD.total_amount OR NEW.paid_amount IS DISTINCT FROM OLD.paid_amount) THEN
    RAISE EXCEPTION 'La facture % est annulée', COALESCE(OLD.supplier_invoice_number, OLD.invoice_number) USING ERRCODE = 'OF409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS invoices_guard_validated ON invoices;
CREATE TRIGGER invoices_guard_validated BEFORE UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION trg_invoices_guard_validated();

CREATE OR REPLACE FUNCTION trg_invoice_items_guard_validated()
RETURNS TRIGGER AS $$
DECLARE v_inv invoices%ROWTYPE;
BEGIN
  IF COALESCE(current_setting('app.invoice_edit', true), '') = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT * INTO v_inv FROM invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF NOT FOUND OR v_inv.invoice_type <> 'received' OR v_inv.validation_status = 'draft' THEN RETURN COALESCE(NEW, OLD); END IF;
  -- Facture créée dans cette même transaction : ses lignes s'écrivent (création en-tête puis lignes).
  IF v_inv.created_at = now() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.quantity IS NOT DISTINCT FROM OLD.quantity AND NEW.unit_price IS NOT DISTINCT FROM OLD.unit_price
     AND NEW.subtotal IS NOT DISTINCT FROM OLD.subtotal AND NEW.tva_rate IS NOT DISTINCT FROM OLD.tva_rate
     AND NEW.tva_amount IS NOT DISTINCT FROM OLD.tva_amount AND NEW.ingredient_id IS NOT DISTINCT FROM OLD.ingredient_id
     AND NEW.packaging_id IS NOT DISTINCT FROM OLD.packaging_id THEN
    RETURN NEW;   -- catégorie, description, lien BC, code TVA attendu : modifiables
  END IF;
  RAISE EXCEPTION 'La facture % est %: ses lignes ne se modifient plus (repassez-la en brouillon si elle n''est pas payée)',
    COALESCE(v_inv.supplier_invoice_number, v_inv.invoice_number), CASE v_inv.validation_status WHEN 'validated' THEN 'validée' ELSE 'annulée' END
    USING ERRCODE = 'OF409';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS invoice_items_guard_validated ON invoice_items;
CREATE TRIGGER invoice_items_guard_validated BEFORE INSERT OR UPDATE OR DELETE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION trg_invoice_items_guard_validated();

-- Paiement : refusé sur une facture non validée ou bloquée (mode block).
CREATE OR REPLACE FUNCTION trg_payments_guard_invoice()
RETURNS TRIGGER AS $$
DECLARE v_inv invoices%ROWTYPE; v_codes TEXT; v_mode TEXT;
BEGIN
  IF NEW.invoice_id IS NULL THEN RETURN NEW; END IF;
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
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS payments_guard_invoice_holds ON payments;
CREATE TRIGGER payments_guard_invoice_holds BEFORE INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION trg_payments_guard_invoice();

-- Audit (mig 305) sur les blocages.
DROP TRIGGER IF EXISTS invoice_holds_document_audit ON invoice_holds;
CREATE TRIGGER invoice_holds_document_audit AFTER INSERT OR UPDATE ON invoice_holds
  FOR EACH ROW EXECUTE FUNCTION log_purchasing_document_change();

-- ═══════════════════════════════════════════════════════════════════════
-- 6. REPRISE : contrôle des factures ouvertes, blocages informatifs (non bloquants)
-- ═══════════════════════════════════════════════════════════════════════
-- Les factures déjà soldées ne sont pas recontrôlées. Les factures ouvertes le sont, mais leurs
-- blocages de reprise ne bloquent pas le paiement : ils signalent ce qui est à régulariser.
SELECT fn_validate_invoice(id, true) FROM invoices
 WHERE invoice_type = 'received' AND validation_status = 'validated' AND payment_status <> 'paid';
