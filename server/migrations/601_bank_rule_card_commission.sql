-- G4-02 (plan d'action 2026-11) — règle « commission de carte » du rapprochement bancaire.
--
-- Le prestataire du terminal de paiement (TPE) vire chaque jour le NET des ventes carte :
-- 1 000 DH de ventes carte → 975 DH en banque (commission 2,5 %). Côté comptabilité, les
-- ventes carte sont au débit de la banque pour leur BRUT (taux accounting.card_commission
-- à 0, mig 356) ou déjà pour leur net (taux saisi). Aucune règle ne savait rapprocher ce
-- flux : l'écart est variable, une tolérance fixe en dirhams ne convient pas.
--
-- Nouvelle action action = 'match_fee' (« rapprocher le net, générer la commission ») :
--   - la ligne de relevé (entrée) est rapprochée des encaissements d'un ou plusieurs JOURS
--     consécutifs, pris dans les date_tolerance_days précédant l'opération ;
--   - l'écart (brut − net) doit représenter entre fee_pct_min et fee_pct_max % du brut ;
--     un léger écart NÉGATIF (la banque a versé plus, arrondis) est admis jusqu'à
--     amount_tolerance dirhams ;
--   - l'écriture de commission est générée au journal de banque sur counter_account_id
--     (6147 Services bancaires, celui de la mig 356) : 6147 D / banque C de l'écart, puis la
--     ligne de relevé est rapprochée des encaissements ET de cette ligne de commission
--     (somme = net viré). Aucune écriture existante n'est modifiée ;
--   - une seule combinaison de jours doit convenir, sinon rien n'est proposé.
--
-- candidate_source restreint les écritures candidates : 'card' = encaissements carte
-- (ventes carte ou mixtes, saisie des ventes du jour, écart carte de fermeture de caisse).
-- NULL = toutes les écritures du compte.
--
-- INVERSION :
--   DELETE FROM bank_rules WHERE action = 'match_fee';
--   ALTER TABLE bank_rules DROP CONSTRAINT IF EXISTS chk_bank_rules_fee,
--     DROP CONSTRAINT IF EXISTS chk_bank_rules_source,
--     DROP CONSTRAINT chk_bank_rules_action, DROP CONSTRAINT chk_bank_rules_counter;
--   ALTER TABLE bank_rules ADD CONSTRAINT chk_bank_rules_action CHECK (action IN ('match', 'post_entry')),
--     ADD CONSTRAINT chk_bank_rules_counter CHECK (action <> 'post_entry' OR counter_account_id IS NOT NULL);
--   ALTER TABLE bank_rules DROP COLUMN IF EXISTS fee_pct_min, DROP COLUMN IF EXISTS fee_pct_max,
--     DROP COLUMN IF EXISTS candidate_source;
ALTER TABLE bank_rules ADD COLUMN IF NOT EXISTS fee_pct_min      numeric(5,2);
ALTER TABLE bank_rules ADD COLUMN IF NOT EXISTS fee_pct_max      numeric(5,2);
ALTER TABLE bank_rules ADD COLUMN IF NOT EXISTS candidate_source varchar(10);

ALTER TABLE bank_rules DROP CONSTRAINT IF EXISTS chk_bank_rules_action;
ALTER TABLE bank_rules ADD CONSTRAINT chk_bank_rules_action CHECK (action IN ('match', 'post_entry', 'match_fee'));
ALTER TABLE bank_rules DROP CONSTRAINT IF EXISTS chk_bank_rules_counter;
ALTER TABLE bank_rules ADD CONSTRAINT chk_bank_rules_counter CHECK (action NOT IN ('post_entry', 'match_fee') OR counter_account_id IS NOT NULL);
ALTER TABLE bank_rules DROP CONSTRAINT IF EXISTS chk_bank_rules_fee;
ALTER TABLE bank_rules ADD CONSTRAINT chk_bank_rules_fee CHECK (
  action <> 'match_fee'
  OR (direction = 'in' AND fee_pct_max IS NOT NULL AND fee_pct_max BETWEEN 0 AND 50
      AND COALESCE(fee_pct_min, 0) BETWEEN 0 AND fee_pct_max));
ALTER TABLE bank_rules DROP CONSTRAINT IF EXISTS chk_bank_rules_source;
ALTER TABLE bank_rules ADD CONSTRAINT chk_bank_rules_source CHECK (candidate_source IS NULL OR candidate_source IN ('card'));
