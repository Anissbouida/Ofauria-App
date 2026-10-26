-- ═══════════════════════════════════════════════════════════════════════
-- 350 — Moteur d'approbation (lot 8 Paramètres ; 333 → 347 → 350 au fil des fusions)
--   Jusqu'ici chaque module validait par rôle en dur : un BC s'envoie si on
--   est admin ou gérant, quel que soit son montant. Les circuits
--   d'approbation deviennent du paramétrage :
--     approval_rules       : une règle = type de pièce + condition + mode ;
--     approval_rule_steps  : les approbateurs successifs (rôle ou personne) ;
--     approval_requests    : une demande par pièce soumise (une seule en
--                            attente par pièce : index unique partiel) ;
--     approval_steps       : les étapes de la demande, copiées de la règle au
--                            moment de la soumission (changer la règle ensuite
--                            ne modifie pas une demande en cours) ;
--     approval_delegations : un approbateur absent délègue à un collègue.
--
--   La condition est un JSONB {field, op, value} évalué par le service sur
--   les valeurs que le module fournit (montant du BC, écart d'inventaire…).
--   Une condition vide {} veut dire « toujours ».
--
--   Règles livrées : BC au-dessus de 5 000 DH → administrateur (un BC
--   envoyé par un administrateur vaut approbation) ; annulation d'une
--   facture client émise (avoir) → administrateur ; écart de contrôle
--   d'ouverture au-dessus de 2 % → gérant puis administrateur.
--   Types de pièce : purchase_order, invoice_cancel, inventory_count.
--
-- INVERSION
--   DROP TABLE approval_delegations, approval_steps, approval_requests,
--   approval_rule_steps, approval_rules ;
--   DELETE FROM notification_rules WHERE domain = 'approvals'.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS approval_rules (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  VARCHAR(40) NOT NULL UNIQUE,
  label                 VARCHAR(120) NOT NULL,
  doc_type              VARCHAR(30) NOT NULL,
  enabled               BOOLEAN NOT NULL DEFAULT true,
  condition             JSONB NOT NULL DEFAULT '{}'::jsonb,
  mode                  VARCHAR(10) NOT NULL DEFAULT 'serial' CHECK (mode IN ('serial', 'parallel')),
  escalate_after_hours  INTEGER CHECK (escalate_after_hours IS NULL OR escalate_after_hours BETWEEN 1 AND 720),
  display_order         SMALLINT NOT NULL DEFAULT 0,
  updated_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  CHECK (jsonb_typeof(condition) = 'object')
);
COMMENT ON TABLE approval_rules IS 'Circuits d''approbation paramétrables (mig 350) : type de pièce, condition JSONB {field, op, value}, mode série ou parallèle.';

CREATE TABLE IF NOT EXISTS approval_rule_steps (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id           UUID NOT NULL REFERENCES approval_rules(id) ON DELETE CASCADE,
  step_order        SMALLINT NOT NULL CHECK (step_order BETWEEN 1 AND 10),
  approver_role     VARCHAR(30) REFERENCES roles(code) ON DELETE RESTRICT,
  approver_user_id  UUID REFERENCES users(id) ON DELETE RESTRICT,
  UNIQUE (rule_id, step_order),
  CHECK (approver_role IS NOT NULL OR approver_user_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id          UUID REFERENCES approval_rules(id) ON DELETE SET NULL,
  rule_code        VARCHAR(40) NOT NULL,
  doc_type         VARCHAR(30) NOT NULL,
  doc_id           TEXT NOT NULL,
  doc_label        VARCHAR(160) NOT NULL,
  amount           NUMERIC(14, 2),
  summary          JSONB NOT NULL DEFAULT '{}'::jsonb,   -- valeurs évaluées (montant, écart…) et libellés pour l'écran
  store_id         UUID REFERENCES stores(id) ON DELETE SET NULL,
  status           VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at       TIMESTAMPTZ,
  decision_reason  TEXT,
  applied_at       TIMESTAMPTZ,                           -- effet appliqué à la pièce (BC envoyé…)
  apply_error      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_requests_pending ON approval_requests (doc_type, doc_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_approval_requests_doc ON approval_requests (doc_type, doc_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests (status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_requests_by ON approval_requests (requested_by, requested_at DESC);
COMMENT ON TABLE approval_requests IS 'Demandes d''approbation (mig 350) : une seule en attente par pièce.';

CREATE TABLE IF NOT EXISTS approval_steps (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id        UUID NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  step_order        SMALLINT NOT NULL,
  approver_role     VARCHAR(30),
  approver_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  status            VARCHAR(12) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'pending', 'approved', 'rejected', 'skipped')),
  due_at            TIMESTAMPTZ,
  decided_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at        TIMESTAMPTZ,
  reason            TEXT,
  escalated_at      TIMESTAMPTZ,
  UNIQUE (request_id, step_order)
);
CREATE INDEX IF NOT EXISTS idx_approval_steps_pending_role ON approval_steps (approver_role) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_approval_steps_pending_user ON approval_steps (approver_user_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS approval_delegations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_on     DATE NOT NULL DEFAULT CURRENT_DATE,
  ends_on       DATE NOT NULL,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_user_id <> to_user_id),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS idx_approval_delegations_to ON approval_delegations (to_user_id, starts_on, ends_on);

-- Règles livrées.
INSERT INTO approval_rules (code, label, doc_type, condition, mode, escalate_after_hours, display_order) VALUES
  ('po_over_threshold', 'Bon de commande au-dessus de 5 000 DH', 'purchase_order',
   '{"field": "amount", "op": "gt", "value": 5000}'::jsonb, 'serial', 48, 10),
  ('invoice_cancel', 'Annulation d''une facture client (avoir)', 'invoice_cancel',
   '{"field": "invoice_type", "op": "eq", "value": "emitted"}'::jsonb, 'serial', 48, 20),
  ('inventory_gap', 'Écart de contrôle d''ouverture au-dessus d''un seuil', 'inventory_count',
   '{"field": "gap_pct", "op": "gte", "value": 2}'::jsonb, 'serial', 24, 30)
ON CONFLICT (code) DO NOTHING;

INSERT INTO approval_rule_steps (rule_id, step_order, approver_role)
SELECT r.id, s.step_order, s.role
FROM (VALUES
  ('po_over_threshold', 1, 'admin'),
  ('invoice_cancel',    1, 'admin'),
  ('inventory_gap',     1, 'manager'),
  ('inventory_gap',     2, 'admin')
) AS s(code, step_order, role)
JOIN approval_rules r ON r.code = s.code
WHERE NOT EXISTS (SELECT 1 FROM approval_rule_steps x WHERE x.rule_id = r.id);

-- Décision du 2026-10-25 : un BC STRICTEMENT au-dessus de 5 000 DH exige
-- l'approbation d'un administrateur. Appliquée aussi aux bases où une version
-- antérieure de ce moteur (mig 333/347, « ≥ 5 000 → gérant ») a déjà semé la règle.
UPDATE approval_rules
   SET label = 'Bon de commande au-dessus de 5 000 DH',
       condition = '{"field": "amount", "op": "gt", "value": 5000}'::jsonb
 WHERE code = 'po_over_threshold';
DELETE FROM approval_rule_steps
 WHERE rule_id = (SELECT id FROM approval_rules WHERE code = 'po_over_threshold')
   AND NOT (step_order = 1 AND approver_role = 'admin' AND approver_user_id IS NULL);
INSERT INTO approval_rule_steps (rule_id, step_order, approver_role)
SELECT id, 1, 'admin' FROM approval_rules r
 WHERE code = 'po_over_threshold'
   AND NOT EXISTS (SELECT 1 FROM approval_rule_steps x WHERE x.rule_id = r.id);

-- Types de notification (règles du lot 6).
INSERT INTO notification_rules (type, label, domain) VALUES
  ('approval_requested', 'Pièce à approuver',          'approvals'),
  ('approval_approved',  'Demande approuvée',          'approvals'),
  ('approval_rejected',  'Demande refusée',            'approvals'),
  ('approval_escalated', 'Approbation en retard',      'approvals')
ON CONFLICT (type) DO NOTHING;

-- Journal du paramétrage (mig 328) sur les règles et les délégations ;
-- les demandes ont leur propre historique (étapes).
DO $$
BEGIN
  IF to_regprocedure('log_config_change()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS approval_rules_config_audit ON approval_rules;
    CREATE TRIGGER approval_rules_config_audit AFTER INSERT OR UPDATE OR DELETE ON approval_rules
      FOR EACH ROW EXECUTE FUNCTION log_config_change('code', '');
    DROP TRIGGER IF EXISTS approval_rule_steps_config_audit ON approval_rule_steps;
    CREATE TRIGGER approval_rule_steps_config_audit AFTER INSERT OR UPDATE OR DELETE ON approval_rule_steps
      FOR EACH ROW EXECUTE FUNCTION log_config_change('id', 'rule_id');
    DROP TRIGGER IF EXISTS approval_delegations_config_audit ON approval_delegations;
    CREATE TRIGGER approval_delegations_config_audit AFTER INSERT OR UPDATE OR DELETE ON approval_delegations
      FOR EACH ROW EXECUTE FUNCTION log_config_change('id', 'from_user_id');
  END IF;
END $$;
