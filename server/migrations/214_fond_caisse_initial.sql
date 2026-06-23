-- 214_fond_caisse_initial.sql
-- Enregistre le FOND DE CAISSE INITIAL (apport jamais saisi) pour le magasin
-- "Point de vente principal". Sans lui, le Solde Cash calcule en "cash-seul"
-- (ventes cash - depenses cash, quasi nul) ne reflete pas la caisse physique :
-- l'argent reellement present dans le tiroir vient de cet apport de depart.
--
-- Montant = caisse physique comptee (9826.50 au 23/06/2026)
--           - solde cash-seul calcule par l'appli (-2709.24)
--         = 12535.74 DH
--
-- Enregistre comme une ENTREE cash datee juste avant la 1ere activite, donc
-- portee dans le "solde reporte" (previousBalance) de tous les mois affiches.
-- Idempotent : la reference 'FOND-CAISSE-INIT' empeche tout doublon a la reexecution.

INSERT INTO payments (reference, type, payment_method, amount, payment_date, description, store_id, created_by)
SELECT
  'FOND-CAISSE-INIT',
  'income',
  'cash',
  12535.74,
  COALESCE(
    LEAST(
      (SELECT MIN(payment_date) FROM payments
        WHERE store_id = '00000000-0000-0000-0000-000000000001'),
      (SELECT MIN(entry_date)   FROM manual_shift_entries
        WHERE store_id = '00000000-0000-0000-0000-000000000001')
    ) - INTERVAL '1 day',
    DATE '2026-05-31'
  )::date,
  'Fond de caisse initial (apport non saisi) - correction Solde Cash',
  '00000000-0000-0000-0000-000000000001',
  NULL
WHERE NOT EXISTS (
  SELECT 1 FROM payments
  WHERE reference = 'FOND-CAISSE-INIT'
    AND store_id = '00000000-0000-0000-0000-000000000001'
);
