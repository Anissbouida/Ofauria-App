-- Plan pilote 2026-11 — fermetures de caisse aux totaux faux (tickets annulés comptés) et lots
-- non recrédités à l'annulation. LECTURE SEULE : aucune écriture, aucune correction.
--
--   psql "$DATABASE_URL" -f server/scripts/diagnose-fermetures-tickets-annules.sql
--
-- Avant ead6757, la fermeture comptait les tickets annulés dans le chiffre d'affaires, les
-- espèces attendues et le tiroir (faux manquant, avec son écriture d'écart). Avant e866295,
-- l'annulation d'un ticket ne rendait pas la quantité au lot (FEFO, rappel, DLC faussés).
-- Un résultat non vide = reprise à décider avec le gérant (chiffrée, sur accord).

\echo '== 1. Synthèse'
SELECT
  (SELECT count(DISTINCT s.session_id) FROM sales s JOIN cash_register_sessions cs ON cs.id = s.session_id
    WHERE s.cancelled_at IS NOT NULL AND cs.status = 'closed') AS fermetures_concernees,
  (SELECT count(*) FROM sales s JOIN cash_register_sessions cs ON cs.id = s.session_id
    WHERE s.cancelled_at IS NOT NULL AND cs.status = 'closed') AS tickets_annules_dans_fermetures,
  (SELECT count(*) FROM sales s WHERE s.cancelled_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM sale_items si JOIN sale_item_lots sil ON sil.sale_item_id = si.id
                   WHERE si.sale_id = s.id AND sil.quantity > COALESCE(sil.returned_qty, 0))) AS tickets_annules_lot_non_rendu;

\echo '== 2. Fermetures concernées : montants annulés comptés à tort'
SELECT cs.closure_number, cs.closed_at::date AS jour, cs.store_id,
       count(s.id) AS tickets_annules,
       round(sum(s.total), 2) AS total_annule,
       round(sum(CASE WHEN s.payment_method = 'cash' THEN s.total WHEN s.payment_method = 'mixed' THEN COALESCE(s.cash_amount, 0) ELSE 0 END), 2) AS especes_annulees,
       round(sum(CASE WHEN s.payment_method = 'card' THEN s.total WHEN s.payment_method = 'mixed' THEN COALESCE(s.card_amount, 0) ELSE 0 END), 2) AS carte_annulee,
       cs.expected_cash, cs.actual_amount, cs.difference AS ecart_enregistre,
       round(cs.difference + sum(CASE WHEN s.payment_method = 'cash' THEN s.total WHEN s.payment_method = 'mixed' THEN COALESCE(s.cash_amount, 0) ELSE 0 END), 2) AS ecart_corrige_estime
  FROM cash_register_sessions cs JOIN sales s ON s.session_id = cs.id
 WHERE cs.status = 'closed' AND s.cancelled_at IS NOT NULL
 GROUP BY cs.id ORDER BY cs.closed_at;

\echo '== 3. Tickets annulés dont le lot n''a pas été recrédité'
SELECT s.sale_number, s.cancelled_at::date AS annule_le, p.name AS produit, pl.id AS lot,
       sil.quantity - COALESCE(sil.returned_qty, 0) AS quantite_non_rendue
  FROM sales s JOIN sale_items si ON si.sale_id = s.id
  JOIN sale_item_lots sil ON sil.sale_item_id = si.id
  JOIN product_lots pl ON pl.id = sil.product_lot_id
  LEFT JOIN products p ON p.id = si.product_id
 WHERE s.cancelled_at IS NOT NULL AND sil.quantity > COALESCE(sil.returned_qty, 0)
 ORDER BY s.cancelled_at, s.sale_number
 LIMIT 500;
