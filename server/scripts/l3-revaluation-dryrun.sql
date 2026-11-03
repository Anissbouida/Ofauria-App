-- =============================================================================
-- L3 — Dry-run de la réévaluation de stock sur écart de prix (incrément 3/5)
-- docs/AUDIT_P2P_GAP_ANALYSIS.md
-- =============================================================================
-- Simulation EN LECTURE SEULE : ce que la réévaluation ferait si on l'activait,
-- par ligne de facture reçue validée reliée à un lot. Rien n'est écrit, aucun
-- lot/CMUP modifié, aucune écriture passée. À jouer sur STAGING (copie de prod)
-- AVANT d'activer l'incrément 3b, pour valider les montants (le doc impose ce
-- dry-run car c'est le seul lot qui déplace des montants).
--
-- Rappel du partage : écart unitaire = prix facture − coût du lot ; la part
-- ENCORE EN STOCK réévalue le lot (amount_to_stock), la part DÉJÀ CONSOMMÉE part
-- en compte d'écart / IPV (amount_to_variance). Le consommé n'est pas réécrit
-- (coût figé à la consommation, incrément 1/5).
-- =============================================================================

-- 1. Détail : les 200 lignes au plus gros impact (|stock| + |écart|).
SELECT i.invoice_number, s.name AS fournisseur,
       p.item_name, p.lot_unit_cost, p.invoice_unit_price, p.unit_delta,
       p.qty_basis, p.qty_remaining, p.amount_to_stock, p.amount_to_variance
FROM invoices i
LEFT JOIN suppliers s ON s.id = i.supplier_id
CROSS JOIN LATERAL fn_stock_revaluation_preview(i.id) p
WHERE i.invoice_type = 'received' AND i.validation_status = 'validated'
ORDER BY abs(p.amount_to_stock) + abs(p.amount_to_variance) DESC
LIMIT 200;

-- 2. Totaux : combien irait au stock vs au compte d'écart, sur combien de lignes.
SELECT count(*)                          AS lignes_concernees,
       round(sum(p.amount_to_stock), 2)  AS total_vers_stock,
       round(sum(p.amount_to_variance), 2) AS total_vers_ecart_ipv
FROM invoices i
CROSS JOIN LATERAL fn_stock_revaluation_preview(i.id) p
WHERE i.invoice_type = 'received' AND i.validation_status = 'validated';

-- 3. Par fournisseur (où se concentrent les écarts).
SELECT s.name AS fournisseur, count(*) AS lignes,
       round(sum(p.amount_to_stock), 2) AS vers_stock,
       round(sum(p.amount_to_variance), 2) AS vers_ecart
FROM invoices i
LEFT JOIN suppliers s ON s.id = i.supplier_id
CROSS JOIN LATERAL fn_stock_revaluation_preview(i.id) p
WHERE i.invoice_type = 'received' AND i.validation_status = 'validated'
GROUP BY s.name
ORDER BY abs(sum(p.amount_to_stock)) + abs(sum(p.amount_to_variance)) DESC;
