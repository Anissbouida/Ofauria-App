-- 641 — Qualité : points de contrôle avant transfert et avant livraison (plan d'exécution
-- multi-industries, étape 7).
--
-- POURQUOI
--   Le plan de contrôle ne connaissait que réception, en cours et final : impossible de
--   décrire un contrôle libératoire avant l'envoi en boutique ou avant l'expédition au client,
--   courant en agroalimentaire conditionné et en mécanique.
--
-- CE QUI CHANGE
--   - quality_control_plan_lines.stage et quality_inspections.control_stage acceptent
--     « avant_transfert » et « avant_livraison » (colonnes élargies à 20 caractères).
--   - quality_inspections.delivery_note_id : contrôle avant livraison rattaché au bon de livraison.
--   - Les parcours publiés « standard » gagnent la garde « pre_transfer_checks_done » sur
--     l'étape transfert : elle passe tant qu'aucune ligne « avant transfert » n'existe
--     (aucun changement pour une société qui n'en déclare pas).
--
-- RETOUR ARRIÈRE
--   Remettre les CHECK d'origine (réception, en cours, final) après suppression des lignes et
--   inspections des nouvelles étapes ; DROP COLUMN delivery_note_id ; retirer la garde des étapes.

ALTER TABLE quality_control_plan_lines ALTER COLUMN stage TYPE VARCHAR(20);
ALTER TABLE quality_control_plan_lines DROP CONSTRAINT IF EXISTS quality_control_plan_lines_stage_check;
ALTER TABLE quality_control_plan_lines ADD CONSTRAINT quality_control_plan_lines_stage_check
  CHECK (stage IN ('reception', 'en_cours', 'final', 'avant_transfert', 'avant_livraison'));

ALTER TABLE quality_inspections ALTER COLUMN control_stage TYPE VARCHAR(20);
ALTER TABLE quality_inspections ADD COLUMN IF NOT EXISTS delivery_note_id UUID REFERENCES delivery_notes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_quality_inspections_delivery_note ON quality_inspections (delivery_note_id) WHERE delivery_note_id IS NOT NULL;

UPDATE process_stages s SET guards = s.guards || ARRAY['pre_transfer_checks_done']
  FROM process_models m
 WHERE m.id = s.model_id AND m.label = 'Parcours standard' AND s.code = 'transfert'
   AND NOT ('pre_transfer_checks_done' = ANY (s.guards));

-- Règle de clôture d'un point critique (politique quality.ccp_rule) : le profil agroalimentaire
-- conditionné livre « relevés tous conformes » ; défaut partout ailleurs : au moins un relevé.
UPDATE sector_packs
   SET profile = jsonb_set(COALESCE(profile, '{}'::jsonb), '{policies}',
                           COALESCE(profile->'policies', '[]'::jsonb) || '[{"key": "quality.ccp_rule", "value": {"rule": "tous_conformes", "min_readings": 1}}]'::jsonb)
 WHERE code = 'agro_conditionne'
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(profile->'policies', '[]'::jsonb)) p WHERE p->>'key' = 'quality.ccp_rule');
