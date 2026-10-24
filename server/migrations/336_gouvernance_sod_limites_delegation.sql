-- ═══════════════════════════════════════════════════════════════════════
-- 336 — Gouvernance des droits (alignement ERP, Phase 2)
--   Trois dispositifs de contrôle que les grands ERP (SAP GRC, NetSuite,
--   Dynamics) ajoutent au RBAC :
--
--   sod_rules          : séparation des tâches (Segregation of Duties). Chaque
--                        règle décrit une PAIRE de capacités incompatibles
--                        (module A + droit A) × (module B + droit B) qu'un même
--                        utilisateur ne devrait pas cumuler (ex. créer un
--                        fournisseur ET approuver ses achats). « droit » = une
--                        action CRUD (view/create/edit/delete) ou un verbe
--                        métier (approve/validate/post/…). L'administrateur,
--                        qui a tout, est exempté.
--   approval_limits    : plafond d'approbation par rôle et type de document
--                        (ex. le Gérant peut approuver un BC jusqu'à 50 000).
--                        La limite effective d'un utilisateur = la plus élevée
--                        de ses rôles. Dormant tant qu'aucune limite n'est
--                        définie pour un type de document.
--   role_delegations   : délégation temporaire d'un rôle d'un utilisateur à un
--                        autre sur une fenêtre de dates (remplacement pendant
--                        un congé). Le délégataire cumule le rôle délégué dans
--                        ses droits effectifs tant que la délégation est active.
--
--   company_settings.sod_enforcement : même logique que security_module_enforcement
--       'off' (pas de contrôle), 'log' (défaut, on journalise les cumuls
--       interdits à l'affectation sans bloquer), 'enforce' (on refuse).
--
-- INVERSION
--   ALTER TABLE company_settings DROP COLUMN sod_enforcement ;
--   DROP TABLE role_delegations, approval_limits, sod_rules ;
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Séparation des tâches ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sod_rules (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(40) UNIQUE NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  label       VARCHAR(120) NOT NULL,
  description TEXT,
  a_module    VARCHAR(50) NOT NULL,
  a_right     VARCHAR(20) NOT NULL,
  b_module    VARCHAR(50) NOT NULL,
  b_right     VARCHAR(20) NOT NULL,
  severity    VARCHAR(10) NOT NULL DEFAULT 'critical' CHECK (severity IN ('warning', 'critical')),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL
);
COMMENT ON TABLE sod_rules IS 'Separation des taches (mig 336) : paires de capacites incompatibles pour un meme utilisateur.';

-- Deux règles classiques, actives mais en mode « log » par défaut (observation).
INSERT INTO sod_rules (code, label, description, a_module, a_right, b_module, b_right, severity) VALUES
  ('achat_creation_vs_approbation',
   'Créer des achats et les approuver',
   'Un même utilisateur ne devrait pas pouvoir créer un bon de commande et l''approuver.',
   'purchasing', 'create', 'purchasing', 'approve', 'critical'),
  ('facture_saisie_vs_comptabilisation',
   'Saisir une facture et la comptabiliser',
   'Séparer la saisie des factures de leur comptabilisation (contrôle comptable).',
   'accounting', 'create', 'accounting', 'post', 'critical')
ON CONFLICT (code) DO NOTHING;

-- ─── Limites d'approbation ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS approval_limits (
  id            SERIAL PRIMARY KEY,
  role_code     VARCHAR(30) NOT NULL REFERENCES roles(code) ON UPDATE CASCADE ON DELETE CASCADE,
  document_type VARCHAR(30) NOT NULL,
  max_amount    NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (max_amount >= 0),
  currency      VARCHAR(3) NOT NULL DEFAULT 'MAD',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (role_code, document_type)
);
COMMENT ON TABLE approval_limits IS 'Plafond d''approbation par role et type de document (mig 336). Dormant si aucun plafond defini pour un type.';

-- ─── Délégation temporaire de rôle ────────────────────────────────────
CREATE TABLE IF NOT EXISTS role_delegations (
  id           SERIAL PRIMARY KEY,
  from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_code    VARCHAR(30) NOT NULL REFERENCES roles(code) ON UPDATE CASCADE ON DELETE CASCADE,
  reason       TEXT,
  starts_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at      TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT role_delegations_window CHECK (ends_at > starts_at),
  CONSTRAINT role_delegations_distinct CHECK (from_user_id <> to_user_id)
);
COMMENT ON TABLE role_delegations IS 'Delegation temporaire d''un role (mig 336) : le delegataire cumule le role delegue sur la fenetre.';
CREATE INDEX IF NOT EXISTS idx_role_delegations_to ON role_delegations(to_user_id, starts_at, ends_at);

-- ─── Mode de contrôle SoD ─────────────────────────────────────────────
ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS sod_enforcement VARCHAR(10) NOT NULL DEFAULT 'log';
ALTER TABLE company_settings DROP CONSTRAINT IF EXISTS company_settings_sod_enforcement_check;
ALTER TABLE company_settings ADD CONSTRAINT company_settings_sod_enforcement_check
  CHECK (sod_enforcement IN ('off', 'log', 'enforce'));

-- ─── Journal du paramétrage (mig 328) ─────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('log_config_change()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS sod_rules_config_audit ON sod_rules;
    CREATE TRIGGER sod_rules_config_audit AFTER INSERT OR UPDATE OR DELETE ON sod_rules
      FOR EACH ROW EXECUTE FUNCTION log_config_change('code', '');
    DROP TRIGGER IF EXISTS approval_limits_config_audit ON approval_limits;
    CREATE TRIGGER approval_limits_config_audit AFTER INSERT OR UPDATE OR DELETE ON approval_limits
      FOR EACH ROW EXECUTE FUNCTION log_config_change('document_type', 'role_code');
    DROP TRIGGER IF EXISTS role_delegations_config_audit ON role_delegations;
    CREATE TRIGGER role_delegations_config_audit AFTER INSERT OR UPDATE OR DELETE ON role_delegations
      FOR EACH ROW EXECUTE FUNCTION log_config_change('role_code', 'to_user_id');
  END IF;
END $$;
