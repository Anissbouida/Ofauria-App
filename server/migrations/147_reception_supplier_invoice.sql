-- Migration 147 : N° et date de facture fournisseur sur la reception
--
-- Probleme corrige :
--   Lors de la confirmation de reception d'un BC, le systeme creait une
--   facture "recue" avec un numero auto-genere (FACT-2026-...) au lieu
--   d'utiliser le numero present sur la facture papier remise par le
--   fournisseur. C'est une facture FOURNISSEUR, son numero doit etre
--   celui imprime par le fournisseur, pas un numero interne Ofauria.
--
-- Solution :
--   Stocker N° et date de facture fournisseur sur la reception_voucher.
--   Au moment de creer la facture auto, ces valeurs sont utilisees
--   prioritairement. Si elles sont absentes (livraison sans facture
--   physique ou ancienne reception), fallback sur generation auto.
--
-- Nullable :
--   Une reception partielle peut arriver sans facture (le fournisseur
--   facturera plus tard, a la livraison complete). Les champs restent
--   donc optionnels.

ALTER TABLE reception_vouchers
  ADD COLUMN IF NOT EXISTS supplier_invoice_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS supplier_invoice_date DATE;

COMMENT ON COLUMN reception_vouchers.supplier_invoice_number IS
  'N° de facture tel qu''imprime sur le document fournisseur. Utilise pour creer la facture recue (Ofauria n''auto-genere le numero qu''en fallback).';

COMMENT ON COLUMN reception_vouchers.supplier_invoice_date IS
  'Date imprimee sur la facture fournisseur. Utilisee comme invoice_date a la creation de la facture recue.';

-- Index pour recherche / detection de doublons (meme fournisseur + meme N° = doublon)
CREATE INDEX IF NOT EXISTS idx_rv_supplier_invoice_number
  ON reception_vouchers(supplier_invoice_number)
  WHERE supplier_invoice_number IS NOT NULL;
