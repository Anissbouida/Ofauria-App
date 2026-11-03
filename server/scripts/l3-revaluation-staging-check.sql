-- =============================================================================
-- L3 — Dry-run AUTONOME de la réévaluation de stock, pour STAGING (incrément 3/5)
-- docs/AUDIT_P2P_GAP_ANALYSIS.md — procédure : docs/p2p-l3-staging-dryrun-runbook.md
-- =============================================================================
-- À jouer sur une COPIE DE PROD (staging) AVANT d'activer l'incrément 3b, pour
-- valider les montants réels. Ce script est volontairement AUTONOME et NON
-- DESTRUCTIF :
--   • il crée la fonction de simulation DANS une transaction qu'il ANNULE à la
--     fin (ROLLBACK) — staging n'a donc PAS besoin que la migration 446 soit
--     appliquée, et il ne reste RIEN après exécution ;
--   • il ne fait que des SELECT : aucun lot, aucun CMUP, aucune écriture touchés.
--
-- PRÉREQUIS (sinon le script s'arrête avec un message clair) :
--   • L1 déployé sur staging = colonne invoice_items.reception_voucher_item_id
--     ET ingredient_lots.reception_voucher_item_id présentes. Sans le lien
--     réception↔facture↔lot, la simulation ne voit aucune ligne (JOIN vide).
--   • Pour voir des MONTANTS : il faut des factures reçues VALIDÉES dont le prix
--     diffère du prix reçu (confrontation réelle). Les factures générées depuis
--     la réception au même prix donnent 0 (c'est normal, pas un bug).
--
-- Lancer :  PGPASSFILE=... psql -h <host> -p <port> -U <user> -d <staging_db> \
--             -f server/scripts/l3-revaluation-staging-check.sql
-- =============================================================================

\set ON_ERROR_STOP on
\pset pager off

-- 0. Garde prérequis L1 : on refuse de continuer si le lien n'existe pas.
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'invoice_items'
                   AND column_name = 'reception_voucher_item_id') THEN
    RAISE EXCEPTION 'Prérequis manquant : invoice_items.reception_voucher_item_id (déployer L1 / mig 438 sur staging avant ce dry-run).';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'ingredient_lots'
                   AND column_name = 'reception_voucher_item_id') THEN
    RAISE EXCEPTION 'Prérequis manquant : ingredient_lots.reception_voucher_item_id.';
  END IF;
END
$guard$;

BEGIN;

-- 1. Fonction de simulation (identique à la mig 446), créée ici puis ANNULÉE.
CREATE OR REPLACE FUNCTION fn_stock_revaluation_preview(p_invoice_id uuid)
RETURNS TABLE (
  ingredient_lot_id  uuid,
  item_name          text,
  lot_unit_cost      numeric,
  invoice_unit_price numeric,
  unit_delta         numeric,
  qty_basis          numeric,
  qty_remaining      numeric,
  amount_to_stock    numeric,
  amount_to_variance numeric
) AS $fn$
  SELECT
    il.id,
    COALESCE(ing.name, pkg.name)                         AS item_name,
    il.unit_cost                                         AS lot_unit_cost,
    ii.unit_price                                        AS invoice_unit_price,
    round(ii.unit_price - il.unit_cost, 4)               AS unit_delta,
    ii.quantity                                          AS qty_basis,
    LEAST(il.quantity_remaining, ii.quantity)            AS qty_remaining,
    round((ii.unit_price - il.unit_cost) * LEAST(il.quantity_remaining, ii.quantity), 2) AS amount_to_stock,
    round((ii.unit_price - il.unit_cost) * ii.quantity, 2)
      - round((ii.unit_price - il.unit_cost) * LEAST(il.quantity_remaining, ii.quantity), 2) AS amount_to_variance
  FROM invoice_items ii
  JOIN ingredient_lots il
    ON il.reception_voucher_item_id = ii.reception_voucher_item_id
  LEFT JOIN ingredients ing ON ing.id = il.ingredient_id
  LEFT JOIN packaging_items pkg ON pkg.id = ii.packaging_id
  WHERE ii.invoice_id = p_invoice_id
    AND ii.reception_voucher_item_id IS NOT NULL
    AND ii.unit_price IS NOT NULL
    AND abs(ii.unit_price - il.unit_cost) > 0.0001;
$fn$ LANGUAGE sql STABLE;

-- 2. Périmètre : combien de factures reçues validées, combien portent le lien.
SELECT
  count(*)                                                              AS factures_recues_validees,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM invoice_items ii
                                 WHERE ii.invoice_id = i.id
                                   AND ii.reception_voucher_item_id IS NOT NULL)) AS avec_lien_reception
FROM invoices i
WHERE i.invoice_type = 'received' AND i.validation_status = 'validated';

-- 3. Totaux : ce qui irait au stock vs au compte d'écart (IPV), sur combien de lignes.
SELECT count(*)                            AS lignes_a_reevaluer,
       round(sum(p.amount_to_stock), 2)    AS total_vers_stock,
       round(sum(p.amount_to_variance), 2) AS total_vers_ecart_ipv
FROM invoices i
CROSS JOIN LATERAL fn_stock_revaluation_preview(i.id) p
WHERE i.invoice_type = 'received' AND i.validation_status = 'validated';

-- 4. Par fournisseur (où se concentrent les écarts).
SELECT s.name AS fournisseur, count(*) AS lignes,
       round(sum(p.amount_to_stock), 2)    AS vers_stock,
       round(sum(p.amount_to_variance), 2) AS vers_ecart
FROM invoices i
LEFT JOIN suppliers s ON s.id = i.supplier_id
CROSS JOIN LATERAL fn_stock_revaluation_preview(i.id) p
WHERE i.invoice_type = 'received' AND i.validation_status = 'validated'
GROUP BY s.name
ORDER BY abs(sum(p.amount_to_stock)) + abs(sum(p.amount_to_variance)) DESC;

-- 5. Détail : les 200 lignes au plus gros impact (|stock| + |écart|).
SELECT i.invoice_number, s.name AS fournisseur,
       p.item_name, p.lot_unit_cost, p.invoice_unit_price, p.unit_delta,
       p.qty_basis, p.qty_remaining, p.amount_to_stock, p.amount_to_variance
FROM invoices i
LEFT JOIN suppliers s ON s.id = i.supplier_id
CROSS JOIN LATERAL fn_stock_revaluation_preview(i.id) p
WHERE i.invoice_type = 'received' AND i.validation_status = 'validated'
ORDER BY abs(p.amount_to_stock) + abs(p.amount_to_variance) DESC
LIMIT 200;

-- On n'écrit rien : la fonction créée ci-dessus est annulée avec la transaction.
ROLLBACK;

\echo ''
\echo '--- Dry-run terminé (transaction annulée : rien n''a été écrit sur staging). ---'
\echo 'Lecture : total_vers_stock = correction de valeur des lots encore en stock ;'
\echo '          total_vers_ecart_ipv = part déjà consommée → compte d''écart IPV (6xxx à choisir).'
\echo 'Si lignes_a_reevaluer = 0 : soit prix facture = prix reçu, soit pas de confrontation réelle sur staging.'
