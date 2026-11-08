-- ═══════════════════════════════════════════════════════════════════════
-- 467 — Fermeture de caisse : saisie du montant carte (TPE) et écart carte
-- ═══════════════════════════════════════════════════════════════════════
-- Jusqu'ici la fermeture ne rapprochait QUE les espèces : actual_amount (tiroir
-- compté) vs expected_cash (fond + ventes cash), d'où un écart (difference) qui
-- ne portait jamais sur la carte. Le total carte (card_revenue) était pris pour
-- argent comptant : si le ticket du TPE différait des ventes carte enregistrées
-- sur le POS, personne ne le voyait, et l'écart réel pouvait dépasser le seuil
-- sans jamais être signalé.
--
-- On ajoute un second comptage, symétrique de l'espèce :
--   - actual_card_amount   : total lu sur le terminal bancaire à la fermeture ;
--   - card_difference       : actual_card_amount − card_revenue (manque < 0,
--                             excédent > 0), comme difference pour les espèces ;
--   - card_difference_reason: motif, exigé au-delà du seuil (comme l'espèce).
-- L'écart carte est comptabilisé comme l'écart de caisse mais contre 5141
-- (banque/TPE) au lieu de 5161 (caisse) — cf. journal-generator fromClosureDiff.
--
-- Rollback : ALTER TABLE cash_register_sessions
--   DROP CONSTRAINT IF EXISTS cash_register_sessions_card_difference_reason_check,
--   DROP COLUMN IF EXISTS actual_card_amount,
--   DROP COLUMN IF EXISTS card_difference,
--   DROP COLUMN IF EXISTS card_difference_reason ;
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE cash_register_sessions
  ADD COLUMN IF NOT EXISTS actual_card_amount DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS card_difference DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS card_difference_reason VARCHAR(30);

ALTER TABLE cash_register_sessions
  DROP CONSTRAINT IF EXISTS cash_register_sessions_card_difference_reason_check;
ALTER TABLE cash_register_sessions
  ADD CONSTRAINT cash_register_sessions_card_difference_reason_check
  CHECK (card_difference_reason IS NULL OR card_difference_reason IN (
    'erreur_saisie_tpe', 'transaction_manquante', 'transaction_refusee',
    'erreur_comptage', 'autre'
  ));
