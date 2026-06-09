-- Migration 146 : ajouter le numero de cheque sur la facture
--
-- Use case : l'admin/gerant cree une facture en sachant deja par quel cheque
-- elle sera payee (cheque deja recu/emis). Le n° de cheque est saisi sur la
-- facture meme. Au moment du paiement, le champ check_number du payment est
-- pre-rempli depuis check_number de la facture (cf accountant.controller).
--
-- Champ existant `expected_payment_mode` (cash/check/transfer) reste — il
-- declenche l'affichage conditionnel du champ check_number cote frontend.
--
-- Nullable : seules les factures avec expected_payment_mode='check' auront
-- une valeur. Les autres modes laissent NULL.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS check_number VARCHAR(50);

COMMENT ON COLUMN invoices.check_number IS
  'Numero du cheque prevu pour reglement (saisi des la creation facture). Pre-remplit payments.check_number au moment du paiement.';
