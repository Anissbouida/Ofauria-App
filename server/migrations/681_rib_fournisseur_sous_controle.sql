-- ═══════════════════════════════════════════════════════════════════════
-- 681 — Plan d'action compta, étape 22 (audit C-09) : changement de RIB fournisseur sous contrôle
--
--   Le RIB d'un fournisseur se modifiait avec le seul droit d'édition des fournisseurs, sans second
--   regard, et une campagne de paiement recopiait le RIB courant : un RIB changé juste avant un
--   virement partait tel quel (fraude au changement de coordonnées bancaires).
--
--   1. bank_detail_changes : chaque changement de RIB d'un fournisseur DÉJÀ pourvu d'un RIB est une
--      demande (ancien, nouveau, demandeur, décision) ; le RIB courant ne change qu'à l'approbation
--      par un autre utilisateur (type de pièce « bank_detail_change » du moteur d'approbation).
--      Un administrateur reste approbateur final : son propre changement s'applique tout de suite,
--      et il est tracé. Le premier RIB saisi pour un fournisseur s'applique sans approbation.
--   2. suppliers.rib_changed_at : date du dernier changement de RIB appliqué.
--   3. Paramètres :
--        payment.rib_change_control  {"mode":"approval"} (défaut) | {"mode":"off"}
--        payment.rib_freeze_days     {"days":0} : une campagne de paiement refuse un fournisseur dont
--                                    le RIB a changé depuis moins de N jours (0 = pas de gel).
--   4. Règle d'approbation « rib_change » ACTIVE (condition vide = tout changement), approbateur :
--      administrateur. Désactivable dans Paramètres › Approbations.
--
--   Hors périmètre de cette étape : le RIB des salariés (employees.rib).
--
-- Rollback : DROP TABLE bank_detail_changes ; ALTER TABLE suppliers DROP COLUMN rib_changed_at ;
--   supprimer les deux paramètres et la règle rib_change.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS bank_detail_changes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_kind    VARCHAR(20) NOT NULL CHECK (party_kind IN ('supplier')),
  party_id      UUID NOT NULL,
  old_rib       VARCHAR(40),
  new_rib       VARCHAR(40) NOT NULL,
  old_bank_name VARCHAR(120),
  new_bank_name VARCHAR(120),
  status        VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at    TIMESTAMPTZ,
  decision_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_bank_detail_changes_party ON bank_detail_changes (party_kind, party_id, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_detail_changes_pending ON bank_detail_changes (party_kind, party_id) WHERE status = 'pending';
COMMENT ON TABLE bank_detail_changes IS 'Changements de coordonnées bancaires soumis à approbation (mig 681) : le RIB courant ne change qu''à l''approbation.';

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS rib_changed_at TIMESTAMPTZ;

INSERT INTO module_parameters (key, value, description) VALUES
  ('payment.rib_change_control', '{"mode":"approval"}',
   'Changement du RIB d''un fournisseur déjà pourvu d''un RIB : approval = soumis à approbation (le RIB courant reste en place jusque-là) ; off = appliqué tout de suite'),
  ('payment.rib_freeze_days', '{"days":0}',
   'Une campagne de paiement refuse un fournisseur dont le RIB a changé depuis moins de ce nombre de jours (0 = pas de gel)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO approval_rules (code, label, doc_type, enabled, condition, mode, display_order)
VALUES ('rib_change', 'Changement du RIB d''un fournisseur', 'bank_detail_change', true, '{}'::jsonb, 'serial', 50)
ON CONFLICT (code) DO NOTHING;

INSERT INTO approval_rule_steps (rule_id, step_order, approver_role)
SELECT r.id, 1, 'admin' FROM approval_rules r
 WHERE r.code = 'rib_change'
   AND NOT EXISTS (SELECT 1 FROM approval_rule_steps s WHERE s.rule_id = r.id);
