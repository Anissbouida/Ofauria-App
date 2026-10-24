-- ═══════════════════════════════════════════════════════════════════════
-- 312 — D9 Pilotage et analytique, lot 1 (P0)
--   G-D9-03 : reçu non facturé / facturé non reçu / engagements ouverts,
--             mesurés PAR LIGNE de BC (plus par en-tête), au prix du BC
--   G-D9-09 : journal des achats (état fiscal) et signalements de l'état des
--             déductions (sans ICE, numéro interne, règlement)
--   G-D9-10 : registre des entrées (traçabilité ONSSA, loi 28-07), entrées hors
--             BC comprises pour montrer les trous
-- Uniquement des vues : rien n'est saisi dans ce domaine.
-- ═══════════════════════════════════════════════════════════════════════

-- ═══ 1. Rapprochement commandé / reçu / facturé par ligne de BC ═════════
-- Reçu = qty_received_base (journal po_line_events, mig 307). Facturé = lignes de
-- facture rattachées à la ligne de BC (mig 309) ; à défaut (historique), appariement
-- par (BC, article). Quantités en unité de base de la ligne (base_unit).
CREATE OR REPLACE VIEW v_po_line_match AS
WITH inv_lines AS (
  SELECT ii.id, ii.purchase_order_item_id, ii.quantity, ii.subtotal, i.id AS invoice_id, i.invoice_date,
         COALESCE(ii.ingredient_id, ii.packaging_id) AS item_id,
         COALESCE(i.purchase_order_id, (SELECT ipo.purchase_order_id FROM invoice_purchase_orders ipo
                                         WHERE ipo.invoice_id = i.id
                                           AND EXISTS (SELECT 1 FROM purchase_order_items x WHERE x.purchase_order_id = ipo.purchase_order_id
                                                         AND COALESCE(x.ingredient_id, x.packaging_id) = COALESCE(ii.ingredient_id, ii.packaging_id))
                                         LIMIT 1)) AS po_id
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id AND i.invoice_type = 'received' AND i.status <> 'cancelled'
),
inv AS (
  SELECT poi.id AS po_item_id, SUM(il.quantity) AS qty_invoiced, SUM(il.subtotal) AS amt_invoiced,
         MAX(il.invoice_date) AS last_invoiced_at, count(DISTINCT il.invoice_id) AS invoice_count
    FROM purchase_order_items poi
    JOIN inv_lines il ON il.purchase_order_item_id = poi.id
       OR (il.purchase_order_item_id IS NULL AND il.po_id = poi.purchase_order_id
           AND il.item_id = COALESCE(poi.ingredient_id, poi.packaging_id))
   GROUP BY poi.id
),
rcv AS (
  SELECT rvi.purchase_order_item_id AS po_item_id, MAX(rv.reception_date) AS last_received_at,
         MIN(rv.reception_date) AS first_received_at,
         bool_or(rvi.unit_price IS NOT NULL AND rvi.po_unit_price IS NOT NULL AND rvi.unit_price <> rvi.po_unit_price) AS price_differs
    FROM reception_voucher_items rvi JOIN reception_vouchers rv ON rv.id = rvi.reception_voucher_id
   GROUP BY 1
)
SELECT poi.id AS po_item_id, po.id AS po_id, po.order_number, po.status AS po_status, po.order_date,
       po.supplier_id, s.name AS supplier_name,
       COALESCE(poi.ingredient_id, poi.packaging_id) AS item_id, COALESCE(ing.name, pkg.name, poi.description) AS item_name,
       fn_purchasable_kind(COALESCE(poi.category_id, ing.category_id, pkg.category_id)) AS kind,
       COALESCE(poi.category_id, ing.category_id, pkg.category_id) AS category_id,
       COALESCE(poi.base_unit, ing.unit, pkg.unit) AS unit,
       poi.quantity_ordered, COALESCE(poi.qty_received_base, 0) AS qty_received, COALESCE(poi.qty_cancelled_base, 0) AS qty_cancelled,
       COALESCE(inv.qty_invoiced, 0) AS qty_invoiced, COALESCE(inv.amt_invoiced, 0) AS amt_invoiced, COALESCE(inv.invoice_count, 0) AS invoice_count,
       poi.unit_price AS price_po,
       rcv.first_received_at, rcv.last_received_at, inv.last_invoiced_at,
       COALESCE(rcv.price_differs, false) AS price_overwritten,
       GREATEST(COALESCE(poi.qty_received_base, 0) - COALESCE(inv.qty_invoiced, 0), 0) AS qty_received_not_invoiced,
       GREATEST(COALESCE(inv.qty_invoiced, 0) - COALESCE(poi.qty_received_base, 0), 0) AS qty_invoiced_not_received,
       CASE WHEN po.status IN ('en_attente','envoye','livre_partiel') AND NOT COALESCE(po.on_hold, false)
            THEN GREATEST(poi.quantity_ordered - COALESCE(poi.qty_received_base, 0) - COALESCE(poi.qty_cancelled_base, 0), 0)
            ELSE 0 END AS qty_open_commitment
  FROM purchase_order_items poi
  JOIN purchase_orders po ON po.id = poi.purchase_order_id
  LEFT JOIN suppliers s ON s.id = po.supplier_id
  LEFT JOIN ingredients ing ON ing.id = poi.ingredient_id
  LEFT JOIN packaging_items pkg ON pkg.id = poi.packaging_id
  LEFT JOIN inv ON inv.po_item_id = poi.id
  LEFT JOIN rcv ON rcv.po_item_id = poi.id
 WHERE po.status <> 'annule';
COMMENT ON VIEW v_po_line_match IS 'Commandé / reçu / facturé par ligne de BC. Limite : facture historique sans lien ligne → appariée par (BC, article) ; factures sans ligne ignorées (voir kpi_invoices_without_lines).';

CREATE OR REPLACE VIEW kpi_received_not_invoiced AS
SELECT supplier_id, supplier_name, po_id, order_number, po_item_id, item_name, kind, unit,
       qty_received_not_invoiced AS qty, price_po,
       round(qty_received_not_invoiced * COALESCE(price_po, 0), 2) AS amount_at_po_price,
       price_po IS NULL AS price_missing, price_overwritten,
       last_received_at, CURRENT_DATE - last_received_at AS age_days
  FROM v_po_line_match WHERE qty_received_not_invoiced > 0.0001;

CREATE OR REPLACE VIEW kpi_invoiced_not_received AS
SELECT supplier_id, supplier_name, po_id, order_number, po_item_id, item_name, kind, unit,
       qty_invoiced_not_received AS qty, price_po,
       round(qty_invoiced_not_received * COALESCE(NULLIF(amt_invoiced, 0) / NULLIF(qty_invoiced, 0), price_po, 0), 2) AS amount_invoiced,
       qty_received, qty_invoiced, last_invoiced_at, CURRENT_DATE - last_invoiced_at AS age_days
  FROM v_po_line_match WHERE qty_invoiced_not_received > 0.0001;

CREATE OR REPLACE VIEW kpi_open_commitments AS
SELECT supplier_id, supplier_name, po_id, order_number, po_status, order_date,
       count(*) FILTER (WHERE qty_open_commitment > 0) AS open_lines,
       round(SUM(qty_open_commitment * COALESCE(price_po, 0)), 2) AS amount,
       bool_or(qty_open_commitment > 0 AND price_po IS NULL) AS price_missing
  FROM v_po_line_match
 GROUP BY supplier_id, supplier_name, po_id, order_number, po_status, order_date
HAVING SUM(qty_open_commitment) > 0;

-- Factures liées à un BC mais sans aucune ligne : invisibles du rapprochement par ligne.
CREATE OR REPLACE VIEW kpi_invoices_without_lines AS
SELECT i.id AS invoice_id, i.invoice_number, i.invoice_date, i.supplier_id, s.name AS supplier_name, i.amount, i.total_amount
  FROM invoices i LEFT JOIN suppliers s ON s.id = i.supplier_id
 WHERE i.invoice_type = 'received' AND i.status <> 'cancelled'
   AND NOT EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.invoice_id = i.id);

-- ═══ 2. État des déductions : signalements (G-D9-09) ═══════════════════
CREATE OR REPLACE VIEW v_vat_deduction_statement AS
SELECT i.id AS invoice_id, i.invoice_number, i.supplier_invoice_number, i.invoice_date,
       s.id AS supplier_id, s.name AS supplier_name,
       NULLIF(btrim(s.ice), '') AS supplier_ice,
       (SELECT si.value FROM supplier_identifiers si WHERE si.supplier_id = s.id AND si.type_code = 'MA_IF' LIMIT 1) AS supplier_if,
       i.amount AS amount_ht, i.tax_amount AS amount_tva, i.total_amount AS amount_ttc,
       i.vat_recoverable_from, i.is_vat_recoverable, i.vat_non_recoverable_reason,
       i.legal_issues,
       (SELECT string_agg(COALESCE(pm.label, p.payment_method) || COALESCE(' ' || p.reference_norm, '') || ' du ' || to_char(p.payment_date, 'DD/MM/YYYY'), ' ; ' ORDER BY p.payment_date)
          FROM payments p LEFT JOIN payment_modes pm ON pm.code = p.payment_mode
         WHERE p.invoice_id = i.id AND p.status <> 'void' AND p.amount > 0) AS payments,
       -- Signalements (aucune exclusion automatique : décision de l'expert-comptable).
       NULLIF(btrim(s.ice), '') IS NULL AS flag_no_ice,
       (i.supplier_invoice_number IS NULL AND i.invoice_number LIKE 'FR-%') AS flag_internal_number,
       date_trunc('month', i.vat_recoverable_from)::date AS deduction_period
  FROM invoices i
  JOIN suppliers s ON s.id = i.supplier_id
 WHERE i.invoice_type = 'received' AND i.status <> 'cancelled' AND i.tax_amount > 0;

-- Journal des achats : une ligne par facture reçue, ventilée par taux, avec l'écriture AC.
CREATE OR REPLACE VIEW v_purchase_journal AS
SELECT i.id AS invoice_id, i.invoice_date, i.invoice_number, i.supplier_invoice_number,
       s.name AS supplier_name, NULLIF(btrim(s.ice), '') AS supplier_ice,
       i.amount AS amount_ht, i.tax_amount AS amount_tva, i.total_amount AS amount_ttc,
       COALESCE((SELECT SUM(ii.subtotal) FROM invoice_items ii WHERE ii.invoice_id = i.id AND round(ii.tva_rate) = 20), 0) AS ht_20,
       COALESCE((SELECT SUM(ii.subtotal) FROM invoice_items ii WHERE ii.invoice_id = i.id AND round(ii.tva_rate) = 14), 0) AS ht_14,
       COALESCE((SELECT SUM(ii.subtotal) FROM invoice_items ii WHERE ii.invoice_id = i.id AND round(ii.tva_rate) = 10), 0) AS ht_10,
       COALESCE((SELECT SUM(ii.subtotal) FROM invoice_items ii WHERE ii.invoice_id = i.id AND round(ii.tva_rate) = 7), 0) AS ht_7,
       COALESCE((SELECT SUM(ii.subtotal) FROM invoice_items ii WHERE ii.invoice_id = i.id AND COALESCE(ii.tva_rate, 0) = 0), 0) AS ht_0,
       i.status, i.paid_amount, i.vat_recoverable_from,
       je.entry_number, je.entry_date AS accounting_date, je.id IS NOT NULL AS has_entry
  FROM invoices i
  LEFT JOIN suppliers s ON s.id = i.supplier_id
  LEFT JOIN LATERAL (SELECT je.id, je.entry_number, je.entry_date FROM journal_entries je
                      WHERE je.source_id = i.id AND je.status = 'posted' AND je.source_kind <> 'reversal'
                      ORDER BY je.created_at DESC LIMIT 1) je ON true
 WHERE i.invoice_type = 'received' AND i.status <> 'cancelled';

-- ═══ 3. Registre des entrées (G-D9-10) ═══════════════════════════════════
CREATE OR REPLACE VIEW v_goods_entry_register AS
SELECT 'bc'::text AS source, rv.reception_date AS entry_date, rv.created_at AS recorded_at,
       rv.voucher_number, po.order_number, s.id AS supplier_id, s.name AS supplier_name, NULLIF(btrim(s.ice), '') AS supplier_ice,
       COALESCE(ing.name, pkg.name) AS item_name, rvi.ingredient_id, rvi.packaging_id,
       fn_purchasable_kind(COALESCE(rvi.category_id, ing.category_id, pkg.category_id)) AS kind,
       COALESCE(rvi.signed_quantity, rvi.quantity_received) AS quantity, COALESCE(poi.base_unit, ing.unit, pkg.unit) AS unit,
       ing.container_size, ctc.label AS container_label, rvi.kind AS line_kind,
       COALESCE(rvi.supplier_lot_number, il.supplier_lot_number) AS supplier_lot, il.lot_number AS internal_lot,
       COALESCE(rvi.expiration_date, il.expiration_date) AS dlc, COALESCE(rvi.manufactured_date, il.manufactured_date) AS manufactured_date,
       qc.overall_conformity, qc.temperature_ok, qc.temperature_value, qc.packaging_ok, qc.labels_ok,
       rv.supplier_invoice_number,
       NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS received_by,
       rv.store_id,
       (rvi.ingredient_id IS NOT NULL AND (COALESCE(rvi.supplier_lot_number, il.supplier_lot_number) IS NULL
                                           OR COALESCE(rvi.expiration_date, il.expiration_date) IS NULL)) AS incomplete
  FROM reception_voucher_items rvi
  JOIN reception_vouchers rv ON rv.id = rvi.reception_voucher_id
  JOIN purchase_orders po ON po.id = rv.purchase_order_id
  LEFT JOIN purchase_order_items poi ON poi.id = rvi.purchase_order_item_id
  LEFT JOIN suppliers s ON s.id = po.supplier_id
  LEFT JOIN ingredients ing ON ing.id = rvi.ingredient_id
  LEFT JOIN ref_entries ctc ON ctc.id = ing.container_type_id
  LEFT JOIN packaging_items pkg ON pkg.id = rvi.packaging_id
  LEFT JOIN LATERAL (SELECT * FROM ingredient_lots l WHERE l.reception_voucher_item_id = rvi.id ORDER BY l.created_at LIMIT 1) il ON true
  LEFT JOIN LATERAL (SELECT * FROM reception_quality_checks q WHERE q.reception_voucher_id = rv.id ORDER BY q.checked_at DESC NULLS LAST LIMIT 1) qc ON true
  LEFT JOIN users u ON u.id = rv.received_by
UNION ALL
-- Entrées de stock hors bon de commande : le registre montre les trous au lieu de les cacher.
SELECT 'hors_bc', it.created_at::date, it.created_at, NULL, NULL, il.supplier_id, s.name, NULLIF(btrim(s.ice), ''),
       ing.name, it.ingredient_id, NULL::uuid, fn_purchasable_kind(ing.category_id),
       it.quantity_change, ing.unit, ing.container_size, ctc.label, it.type,
       il.supplier_lot_number, il.lot_number, il.expiration_date, il.manufactured_date,
       NULL::boolean, NULL::boolean, NULL::numeric, NULL::boolean, NULL::boolean, NULL,
       NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
       it.store_id, true
  FROM inventory_transactions it
  JOIN ingredients ing ON ing.id = it.ingredient_id
  LEFT JOIN ref_entries ctc ON ctc.id = ing.container_type_id
  LEFT JOIN ingredient_lots il ON il.id = it.ingredient_lot_id
  LEFT JOIN suppliers s ON s.id = il.supplier_id
  LEFT JOIN users u ON u.id = it.performed_by
 WHERE it.type = 'restock' AND it.reception_voucher_id IS NULL AND it.quantity_change > 0;
