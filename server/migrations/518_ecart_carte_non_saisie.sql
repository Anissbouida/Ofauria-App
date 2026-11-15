-- ═══════════════════════════════════════════════════════════════════════
-- 518 — Écart carte « non saisie » sur les fermetures antérieures à la 467
-- ═══════════════════════════════════════════════════════════════════════
-- Avant la mig 467, la fermeture ne demandait pas le total lu sur le TPE :
-- actual_card_amount est NULL alors que des ventes carte ont été encaissées.
-- Règle de gestion (2026-11-15) : rien n'a été justifié, l'écart carte vaut
-- −card_revenue (comme un tiroir non compté). Le rattrapage
-- (cashRegisterRepository.postMissingClosureGaps) pose card_difference avec ce
-- motif dédié, distinct des motifs saisis par le caissier, puis comptabilise
-- l'écart (6588 / 5141) comme fromClosureDiff le fait pour l'écart carte.
-- actual_card_amount reste NULL : on garde la trace qu'aucun montant n'a été saisi.
--
-- Rollback : remettre la contrainte de la 467 (après avoir remis à NULL les
-- card_difference_reason = 'carte_non_saisie').
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE cash_register_sessions
  DROP CONSTRAINT IF EXISTS cash_register_sessions_card_difference_reason_check;
ALTER TABLE cash_register_sessions
  ADD CONSTRAINT cash_register_sessions_card_difference_reason_check
  CHECK (card_difference_reason IS NULL OR card_difference_reason IN (
    'erreur_saisie_tpe', 'transaction_manquante', 'transaction_refusee',
    'erreur_comptage', 'autre', 'carte_non_saisie'
  ));
