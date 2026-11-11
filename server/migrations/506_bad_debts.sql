-- Phase 11 (D5-45) — créances douteuses et irrécouvrables.
--
-- Avant : aucun traitement. Une facture irrécouvrable restait ouverte en gestion
-- (relances comprises), car invoices.paid_amount ne suit que règlements et avoirs.
-- Désormais une facture se classe « douteuse » (signalée, toujours suivie) ou
-- « irrécouvrable » (write-off : le montant sort du reste à recouvrer, donc des
-- relances). L'écriture comptable (reclassement 3421→3424, dotation, passage en
-- perte 6585, récupération de TVA) reste l'OD manuelle, rattachée ici a posteriori.
-- Additif : table neuve, aucun flux existant modifié.

CREATE TABLE IF NOT EXISTS bad_debts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id       uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  status           text NOT NULL CHECK (status IN ('doubtful', 'written_off')),
  amount           numeric(12,2) NOT NULL CHECK (amount >= 0),  -- montant concerné (reste TTC)
  reason           text,
  journal_entry_id uuid,          -- OD comptable passée à la main, rattachée a posteriori
  classified_by    uuid REFERENCES users(id),
  classified_at    timestamptz NOT NULL DEFAULT now(),
  reverted_at      timestamptz
);

-- Une seule classification active par facture.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bad_debt_active
  ON bad_debts (invoice_id) WHERE reverted_at IS NULL;
