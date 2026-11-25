-- ═══════════════════════════════════════════════════════════════════════
-- 680 — Plan d'action compta, étape 21 (audit C-09) : approbation des écritures manuelles
--
--   Une OD était créée et comptabilisée par la même personne, sans aucun contrôle. Le type de pièce
--   « journal_entry » rejoint le moteur d'approbation (mig 350) : quand une règle active s'applique
--   (montant, journal), « Comptabiliser » envoie l'écriture à un approbateur au lieu de la passer ;
--   le demandeur ne peut jamais approuver sa propre demande, et l'écriture est comptabilisée au
--   nom de l'approbateur. Un administrateur reste approbateur final de tous les circuits.
--
--   Règle semée DÉSACTIVÉE (écriture manuelle de 50 000 DH et plus, approbateur : administrateur) :
--   rien ne change tant qu'elle n'est pas activée dans Paramètres › Approbations.
--
-- Rollback : supprimer la règle od_montant_eleve de approval_rules (les étapes suivent en cascade).
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO approval_rules (code, label, doc_type, enabled, condition, mode, display_order)
VALUES ('od_montant_eleve', 'Écriture manuelle de 50 000 DH et plus', 'journal_entry', false,
        '{"field":"amount","op":"gte","value":50000}'::jsonb, 'serial', 40)
ON CONFLICT (code) DO NOTHING;

INSERT INTO approval_rule_steps (rule_id, step_order, approver_role)
SELECT r.id, 1, 'admin' FROM approval_rules r
 WHERE r.code = 'od_montant_eleve'
   AND NOT EXISTS (SELECT 1 FROM approval_rule_steps s WHERE s.rule_id = r.id);
