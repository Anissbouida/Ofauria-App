-- Séparation des tâches par document (analyse d'écart P2P, lot L2 —
-- docs/AUDIT_P2P_GAP_ANALYSIS.md).
--
-- Principe : sur une même chaîne d'achat (BC → réception → facture → paiement),
-- la personne qui a fait une étape ne peut pas en faire une autre censée la
-- contrôler. Quatre règles :
--   GR_NOT_BUYER      l'auteur du BC ne le réceptionne pas
--   IV_NOT_RECEIVER   le réceptionnaire ne valide pas la facture
--   PAY_NOT_VALIDATOR le valideur de la facture ne la paie pas
--   HOLD_NOT_PAYER    celui qui a payé ne lève pas le blocage
--
-- Mise en service PROGRESSIVE via purchasing.sod_mode : « warn » (défaut) ne
-- bloque pas, il JOURNALISE les violations dans sod_violations pour qu'on voie
-- ce que « block » rejetterait (cf. script l2-sod-readiness.sql) ; « block »
-- lève une erreur OF403. Une dérogation tracée (sod_overrides) laisse passer un
-- cas précis — utile avec une petite équipe (un seul magasinier absent, etc.).

-- 1. Référentiel des règles (éditable, activables une à une).
CREATE TABLE IF NOT EXISTS sod_document_rules (
  code       VARCHAR(40) PRIMARY KEY,
  action     VARCHAR(30) NOT NULL,   -- receive | validate_invoice | pay | release_hold
  forbidden  VARCHAR(30) NOT NULL,   -- acteur d'une étape antérieure interdit sur cette action
  label      TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO sod_document_rules (code, action, forbidden, label) VALUES
  ('GR_NOT_BUYER',      'receive',          'po_creator',        'L''auteur du bon de commande ne peut pas le réceptionner'),
  ('IV_NOT_RECEIVER',   'validate_invoice', 'receiver',          'Le réceptionnaire ne peut pas valider la facture'),
  ('PAY_NOT_VALIDATOR', 'pay',              'invoice_validator', 'Le valideur de la facture ne peut pas la payer'),
  ('HOLD_NOT_PAYER',    'release_hold',     'payer',             'Celui qui a payé ne peut pas lever le blocage')
ON CONFLICT (code) DO NOTHING;

-- 2. Dérogations tracées (append-only) : un cas précis autorisé, motivé.
CREATE TABLE IF NOT EXISTS sod_overrides (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_code  VARCHAR(40) NOT NULL REFERENCES sod_document_rules(code),
  doc_type   VARCHAR(30) NOT NULL,
  doc_id     UUID NOT NULL,
  actor_id   UUID NOT NULL REFERENCES users(id),
  reason     TEXT NOT NULL CHECK (length(btrim(reason)) >= 10),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_sod_overrides_lookup ON sod_overrides(rule_code, doc_id, actor_id);
REVOKE UPDATE, DELETE ON sod_overrides FROM PUBLIC;   -- append-only (effectif avec le rôle app L0)

-- 3. Journal des violations (mode « warn ») : base de l'aperçu avant bascule.
CREATE TABLE IF NOT EXISTS sod_violations (
  id          BIGSERIAL PRIMARY KEY,
  rule_code   VARCHAR(40) NOT NULL,
  doc_type    VARCHAR(30) NOT NULL,
  doc_id      UUID NOT NULL,
  actor_id    UUID,
  mode        VARCHAR(10) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_sod_violations_rule ON sod_violations(rule_code, occurred_at);
REVOKE UPDATE, DELETE ON sod_violations FROM PUBLIC;

-- 4. Paramètre de mode (warn par défaut : rien n'est bloqué au départ).
INSERT INTO module_parameters (key, value) VALUES ('purchasing.sod_mode', '{"mode": "warn"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 5. Garde commune : décide warn (journalise) vs block (lève), en tenant compte
--    de l'activation de la règle et d'une éventuelle dérogation.
CREATE OR REPLACE FUNCTION fn_sod_enforce(p_rule text, p_doc_type text, p_doc_id uuid, p_actor uuid, p_msg text)
RETURNS void AS $$
DECLARE v_mode text;
BEGIN
  IF p_actor IS NULL THEN RETURN; END IF;
  IF NOT COALESCE((SELECT is_active FROM sod_document_rules WHERE code = p_rule), false) THEN RETURN; END IF;
  -- Dérogation tracée pour ce document et cet acteur : on laisse passer.
  IF EXISTS (SELECT 1 FROM sod_overrides o
              WHERE o.rule_code = p_rule AND o.doc_id = p_doc_id AND o.actor_id = p_actor) THEN
    RETURN;
  END IF;
  v_mode := COALESCE((SELECT value->>'mode' FROM module_parameters WHERE key = 'purchasing.sod_mode'), 'warn');
  IF v_mode = 'block' THEN
    RAISE EXCEPTION 'Séparation des tâches : %', p_msg USING ERRCODE = 'OF403';
  END IF;
  INSERT INTO sod_violations (rule_code, doc_type, doc_id, actor_id, mode)
  VALUES (p_rule, p_doc_type, p_doc_id, p_actor, v_mode);
END $$ LANGUAGE plpgsql;

-- 6. Déclencheurs par action : ne déclenchent la garde que si la règle est enfreinte.

-- Réception : l'auteur du BC ne le réceptionne pas.
CREATE OR REPLACE FUNCTION trg_sod_receive() RETURNS trigger AS $$
BEGIN
  IF NEW.voucher_kind = 'receipt' AND NEW.purchase_order_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM purchase_orders po
                  WHERE po.id = NEW.purchase_order_id AND po.created_by = NEW.received_by) THEN
    PERFORM fn_sod_enforce('GR_NOT_BUYER', 'purchase_order', NEW.purchase_order_id, NEW.received_by,
      'l''auteur du bon de commande ne peut pas le réceptionner');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sod_receive ON reception_vouchers;
CREATE TRIGGER trg_sod_receive BEFORE INSERT ON reception_vouchers
  FOR EACH ROW EXECUTE FUNCTION trg_sod_receive();

-- Validation de facture : le réceptionnaire du BC ne valide pas la facture.
CREATE OR REPLACE FUNCTION trg_sod_validate_invoice() RETURNS trigger AS $$
BEGIN
  IF NEW.validation_status = 'validated' AND OLD.validation_status IS DISTINCT FROM 'validated'
     AND NEW.validated_by IS NOT NULL AND NEW.purchase_order_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM reception_vouchers rv
                  WHERE rv.purchase_order_id = NEW.purchase_order_id
                    AND rv.voucher_kind = 'receipt' AND rv.received_by = NEW.validated_by) THEN
    PERFORM fn_sod_enforce('IV_NOT_RECEIVER', 'invoice', NEW.id, NEW.validated_by,
      'le réceptionnaire ne peut pas valider la facture');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sod_validate_invoice ON invoices;
CREATE TRIGGER trg_sod_validate_invoice BEFORE UPDATE OF validation_status ON invoices
  FOR EACH ROW EXECUTE FUNCTION trg_sod_validate_invoice();

-- Paiement : le valideur de la facture ne la paie pas.
CREATE OR REPLACE FUNCTION trg_sod_pay() RETURNS trigger AS $$
BEGIN
  IF NEW.created_by IS NOT NULL AND NEW.invoice_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM invoices i
                  WHERE i.id = NEW.invoice_id AND i.validated_by = NEW.created_by) THEN
    PERFORM fn_sod_enforce('PAY_NOT_VALIDATOR', 'invoice', NEW.invoice_id, NEW.created_by,
      'le valideur de la facture ne peut pas la payer');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sod_pay ON payments;
CREATE TRIGGER trg_sod_pay BEFORE INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION trg_sod_pay();

-- Levée de blocage : celui qui a payé la facture ne lève pas son blocage.
CREATE OR REPLACE FUNCTION trg_sod_release_hold() RETURNS trigger AS $$
BEGIN
  IF NEW.released_at IS NOT NULL AND OLD.released_at IS NULL AND NEW.released_by IS NOT NULL
     AND EXISTS (SELECT 1 FROM payments p
                  WHERE p.invoice_id = NEW.invoice_id AND p.created_by = NEW.released_by) THEN
    PERFORM fn_sod_enforce('HOLD_NOT_PAYER', 'invoice', NEW.invoice_id, NEW.released_by,
      'celui qui a payé ne peut pas lever le blocage');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sod_release_hold ON invoice_holds;
CREATE TRIGGER trg_sod_release_hold BEFORE UPDATE OF released_at ON invoice_holds
  FOR EACH ROW EXECUTE FUNCTION trg_sod_release_hold();
