-- Refonte Utilisateurs, lot 10 : administration déléguée et approbation des changements sensibles.
--
-- Administration déléguée : aucune table. Les droits « Utilisateurs » se donnent toujours par rôle ;
-- le serveur limite une personne qui n'est pas administrateur aux comptes de ses établissements,
-- sans attribuer le rôle Administrateur ni un rôle qui gère les comptes (services/account-scope.ts).
--
-- Changements sensibles : quand la politique le demande (paramètre security.approvals), le
-- changement est mis en attente (pending_access_changes) et passe par le moteur d'approbation
-- (type de pièce access_change). Il s'applique quand un autre administrateur l'approuve.
--   grant_admin       attribuer le rôle Administrateur
--   grant_mfa_role    attribuer un rôle à double authentification exigée
--   role_rights       modifier les droits d'un rôle
--   mfa_role_removed  retirer la double authentification d'un rôle
--
-- INVERSION : DELETE FROM approval_rule_steps WHERE rule_id IN (SELECT id FROM approval_rules
--   WHERE code = 'access_change_sensitive') ; DELETE FROM approval_rules WHERE code =
--   'access_change_sensitive' ; DROP TABLE pending_access_changes ; DELETE FROM module_parameters
--   WHERE key = 'security.approvals'.

CREATE TABLE IF NOT EXISTS pending_access_changes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                varchar(20) NOT NULL CHECK (kind IN ('grant_admin', 'grant_mfa_role', 'role_rights', 'mfa_role_removed')),
  label               varchar(200) NOT NULL,
  payload             jsonb NOT NULL,
  status              varchar(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected', 'failed')),
  requested_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  requested_at        timestamptz NOT NULL DEFAULT now(),
  approval_request_id uuid,
  decided_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at          timestamptz,
  error               text
);
CREATE INDEX IF NOT EXISTS idx_pending_access_changes_status ON pending_access_changes (status, requested_at DESC);
COMMENT ON TABLE pending_access_changes IS 'Changements d''accès sensibles en attente d''approbation (refonte Utilisateurs, lot 10).';

INSERT INTO approval_rules (code, label, doc_type, condition, mode, escalate_after_hours, display_order)
SELECT 'access_change_sensitive', 'Changement d''accès sensible', 'access_change', '{}'::jsonb, 'serial', 48, 75
WHERE NOT EXISTS (SELECT 1 FROM approval_rules WHERE code = 'access_change_sensitive');

INSERT INTO approval_rule_steps (rule_id, step_order, approver_role)
SELECT r.id, 1, 'admin' FROM approval_rules r
WHERE r.code = 'access_change_sensitive'
  AND NOT EXISTS (SELECT 1 FROM approval_rule_steps s WHERE s.rule_id = r.id);

INSERT INTO module_parameters (key, value, description, updated_at)
VALUES ('security.approvals', '{"kinds": []}'::jsonb,
        'Changements d''accès soumis à l''approbation d''un second administrateur (Utilisateurs › Sécurité et connexions).', now())
ON CONFLICT (key) DO NOTHING;
