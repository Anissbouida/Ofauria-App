-- Tracabilite de l'encaissement effectif d'un cheque
--
-- Pourquoi :
--   Un cheque a une date de signature (payment_date) mais le cash quitte la
--   banque a la date d'ENCAISSEMENT par le beneficiaire — qui peut etre
--   plusieurs jours/semaines plus tard. Sans champ dedie, on ne peut pas
--   distinguer "cheque emis" de "cheque effectivement debite".
--
--   Ce champ permet :
--   - Onglet "Gestion des cheques" : suivre quels cheques sont en attente
--     d'encaissement vs deja debites
--   - Vue Charges en tresorerie : un cheque non encaisse ne genere PAS de
--     charge (cash pas encore sorti)
--   - Audit : tracer qui a confirme l'encaissement et quand
--
-- Sur un paiement non-cheque (cash/transfer), ces champs restent NULL
-- (le cash sort le jour de payment_date).

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS cashed_at DATE,
  ADD COLUMN IF NOT EXISTS cashed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cashed_note TEXT;

COMMENT ON COLUMN payments.cashed_at IS
  'Date d''encaissement effectif (debit bancaire). Pour un cheque : confirme manuellement par l''utilisateur via l''onglet Cheques. NULL = pas encore encaisse (cas typique entre la remise du cheque et son debit).';
COMMENT ON COLUMN payments.cashed_by IS
  'Utilisateur qui a confirme l''encaissement.';
COMMENT ON COLUMN payments.cashed_note IS
  'Note optionnelle saisie au moment de la confirmation (ex : "vu sur releve bancaire du 12/07").';

-- Index pour les requetes "cheques en attente" et "charges effectives"
CREATE INDEX IF NOT EXISTS idx_payments_cashed_at
  ON payments(cashed_at)
  WHERE payment_method = 'check';

-- Optionnel : remontee des donnees historiques
-- Pour les cheques deja saisis AVANT cette migration, on considere qu'ils
-- ont ete encaisses a leur payment_date (on n'a pas d'info plus precise).
-- Ca evite que les anciens cheques disparaissent brutalement des charges.
UPDATE payments
SET cashed_at = payment_date
WHERE payment_method = 'check'
  AND cashed_at IS NULL
  AND payment_date < CURRENT_DATE - INTERVAL '30 days';
