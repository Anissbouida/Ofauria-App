-- ═══════════════════════════════════════════════════════════════════════
-- 455 — Barème d'approbation par rôle acheteur / catégorie (lot L4 P2P, 5/5)
--
--   Le moteur d'approbation (mig 350) n'avait qu'une règle : HT > 5 000 → admin
--   (po_over_threshold). On l'étend à un vrai barème grâce aux conditions
--   COMPOSÉES (approvalConditionMatches gère désormais {all:[...]} / {any:[...]})
--   et à deux nouvelles valeurs soumises par le BC :
--     - buyer_role : rôle du créateur du BC ;
--     - category   : liste des catégories d'achat des lignes (eq = « au moins une »).
--
--   Exemple de barème par rôle (seed ci-dessous, DÉSACTIVÉ par défaut : aucune
--   incidence tant que l'administrateur ne l'active pas depuis
--   Paramètres › Circuits d'approbation) :
--     - un BC saisi par un MAGASINIER au-dessus de 1 000 DH → accord du gérant ;
--     - un BC saisi par un GÉRANT au-dessus de 20 000 DH → accord de l'admin ;
--     - (la règle générale po_over_threshold reste le filet à 5 000 DH).
--
--   Barème par catégorie (même mécanisme, à créer selon le plan comptable du
--   client car l'identifiant de catégorie est propre à chaque base) :
--     condition = {"all":[{"field":"category","op":"eq","value":"<uuid catégorie>"},
--                         {"field":"amount","op":"gt","value":<seuil>}]}
--   Les règles plus spécifiques portent un display_order plus FAIBLE que la règle
--   générale (10) pour être évaluées d'abord (première règle qui matche gagne).
--
-- INVERSION
--   DELETE FROM approval_rules WHERE code IN ('po_magasinier_1000','po_manager_20000');
--   (les étapes partent en cascade via approval_rule_steps.rule_id ON DELETE CASCADE)
-- ═══════════════════════════════════════════════════════════════════════
BEGIN;

-- Règle 1 : magasinier + engagement > 1 000 DH → gérant (désactivée par défaut).
INSERT INTO approval_rules (code, label, doc_type, enabled, condition, mode, display_order)
VALUES ('po_magasinier_1000', 'BC d''un magasinier au-dessus de 1 000 DH', 'purchase_order', false,
        '{"all":[{"field":"buyer_role","op":"eq","value":"magasinier"},{"field":"amount","op":"gt","value":1000}]}'::jsonb,
        'serial', 5)
ON CONFLICT (code) DO NOTHING;

INSERT INTO approval_rule_steps (rule_id, step_order, approver_role)
SELECT r.id, 1, 'manager' FROM approval_rules r WHERE r.code = 'po_magasinier_1000'
  AND NOT EXISTS (SELECT 1 FROM approval_rule_steps s WHERE s.rule_id = r.id);

-- Règle 2 : gérant + engagement > 20 000 DH → administrateur (désactivée par défaut).
INSERT INTO approval_rules (code, label, doc_type, enabled, condition, mode, display_order)
VALUES ('po_manager_20000', 'BC d''un gérant au-dessus de 20 000 DH', 'purchase_order', false,
        '{"all":[{"field":"buyer_role","op":"eq","value":"manager"},{"field":"amount","op":"gt","value":20000}]}'::jsonb,
        'serial', 6)
ON CONFLICT (code) DO NOTHING;

INSERT INTO approval_rule_steps (rule_id, step_order, approver_role)
SELECT r.id, 1, 'admin' FROM approval_rules r WHERE r.code = 'po_manager_20000'
  AND NOT EXISTS (SELECT 1 FROM approval_rule_steps s WHERE s.rule_id = r.id);

COMMIT;
