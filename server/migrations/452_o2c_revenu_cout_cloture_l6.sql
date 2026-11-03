-- ═══════════════════════════════════════════════════════════════════════
-- 452 — Cycle de vente (O2C), lot L6 : revenu, coût, clôture
--        docs/AUDIT_O2C_GAP_ANALYSIS.md § 4.2 L6 / § 5.7 (G-RR-01 à 05, 07 à 09)
--
--   1. Coût figé : coût unitaire du lot de produit fini (part du coût réel de
--      son plan de production, sinon coût standard), recopié sur chaque ligne
--      vendue (ticket) ou livrée (BL) au moment de la sortie. Les marges de
--      gestion se calculent sur ce coût, POS et ventes pro confondus.
--   2. Fin de période : factures à établir (3427) sur les BL livrés non
--      facturés, extournées à l'ouverture ; variation du stock de produits
--      finis (3151 / 7132). Inventaire intermittent (CGNC) : pas de coût des
--      ventes passé au grand livre à chaque ticket.
--   3. Contrôles de clôture : factures clients sans écriture (bloquant), BL
--      non facturés sans FAE et stock de produits finis non valorisé (alertes).
--
-- TVA des ventes comptoir (G-RR-06) : hors lot, en attente de l'avis de
-- l'expert-comptable.
-- Rollback : DROP des colonnes unit_cost, des fonctions et vues ajoutées, de la
--   table period_end_operations ; rejouer fn_close_checklist de la mig 416.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Coût figé ────────────────────────────────────────────────────────
ALTER TABLE product_lots        ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12,4);
ALTER TABLE sale_items          ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12,4);
ALTER TABLE delivery_note_items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12,4);

-- Coût unitaire d'une ligne de plan : coût réel du plan réparti entre ses lignes au
-- prorata de leur coût théorique (complet, sinon matière, sinon quantité), divisé par
-- la quantité produite ; à défaut de coût réel, le coût standard du produit.
CREATE OR REPLACE FUNCTION fn_plan_item_unit_cost(p_plan_item UUID, p_product UUID)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT ROUND(cr.cout_total * w.self_w / NULLIF(w.total_w, 0) / NULLIF(w.self_qty, 0), 4)
       FROM production_plan_items me
       JOIN production_cout_reel cr ON cr.plan_id = me.plan_id AND cr.cout_total > 0
       CROSS JOIN LATERAL (
         SELECT SUM(COALESCE(o.theo_cout_complet_u, o.theo_cout_matiere_u, 1) * o.actual_quantity) AS total_w,
                MAX(CASE WHEN o.id = me.id THEN COALESCE(o.theo_cout_complet_u, o.theo_cout_matiere_u, 1) * o.actual_quantity END) AS self_w,
                MAX(CASE WHEN o.id = me.id THEN o.actual_quantity END) AS self_qty
           FROM production_plan_items o WHERE o.plan_id = me.plan_id AND o.actual_quantity > 0) w
      WHERE me.id = p_plan_item),
    (SELECT ROUND(unit_cost, 4) FROM v_product_unit_cost WHERE product_id = p_product))
$$;

CREATE OR REPLACE FUNCTION fn_lot_cost_fill() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.unit_cost IS NULL THEN NEW.unit_cost := fn_plan_item_unit_cost(NEW.plan_item_id, NEW.product_id); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_lot_cost_fill ON product_lots;
CREATE TRIGGER trg_lot_cost_fill BEFORE INSERT ON product_lots FOR EACH ROW EXECUTE FUNCTION fn_lot_cost_fill();

-- Coût réel du plan calculé ou recalculé : il se fige sur les lots du plan
-- (les lignes déjà vendues gardent le coût qu'elles ont reçu).
CREATE OR REPLACE FUNCTION fn_plan_cost_to_lots() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE product_lots pl SET unit_cost = fn_plan_item_unit_cost(pl.plan_item_id, pl.product_id)
   WHERE pl.production_plan_id = NEW.plan_id;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_plan_cost_to_lots ON production_cout_reel;
CREATE TRIGGER trg_plan_cost_to_lots AFTER INSERT OR UPDATE OF cout_matieres, cout_main_oeuvre, cout_energie, cout_charges_fixes
  ON production_cout_reel FOR EACH ROW EXECUTE FUNCTION fn_plan_cost_to_lots();

UPDATE product_lots SET unit_cost = fn_plan_item_unit_cost(plan_item_id, product_id) WHERE unit_cost IS NULL;

-- Coût figé d'une ligne sortie : moyenne pondérée des lots consommés, coût standard
-- pour la part non suivie par lots.
CREATE OR REPLACE FUNCTION fn_freeze_sale_costs(p_sale UUID) RETURNS void
LANGUAGE sql AS $$
  UPDATE sale_items si SET unit_cost = x.cost
    FROM (SELECT si2.id,
                 ROUND((COALESCE(SUM(l.quantity * COALESCE(pl.unit_cost, std.unit_cost)), 0)
                        + GREATEST(si2.quantity - COALESCE(SUM(l.quantity), 0), 0) * std.unit_cost)
                       / NULLIF(si2.quantity, 0), 4) AS cost
            FROM sale_items si2
            LEFT JOIN sale_item_lots l ON l.sale_item_id = si2.id
            LEFT JOIN product_lots pl ON pl.id = l.product_lot_id
            LEFT JOIN v_product_unit_cost std ON std.product_id = si2.product_id
           WHERE si2.sale_id = p_sale AND si2.quantity > 0
           GROUP BY si2.id, si2.quantity, std.unit_cost) x
   WHERE si.id = x.id AND si.unit_cost IS NULL
$$;

CREATE OR REPLACE FUNCTION fn_freeze_dn_costs(p_note UUID) RETURNS void
LANGUAGE sql AS $$
  UPDATE delivery_note_items d SET unit_cost = x.cost
    FROM (SELECT d2.id,
                 ROUND((COALESCE(SUM(l.quantity * COALESCE(pl.unit_cost, std.unit_cost)), 0)
                        + GREATEST(d2.quantity - COALESCE(SUM(l.quantity), 0), 0) * std.unit_cost)
                       / NULLIF(d2.quantity, 0), 4) AS cost
            FROM delivery_note_items d2
            LEFT JOIN delivery_note_item_lots l ON l.delivery_note_item_id = d2.id
            LEFT JOIN product_lots pl ON pl.id = l.product_lot_id
            LEFT JOIN v_product_unit_cost std ON std.product_id = d2.product_id
           WHERE d2.delivery_note_id = p_note AND d2.product_id IS NOT NULL
           GROUP BY d2.id, d2.quantity, std.unit_cost) x
   WHERE d.id = x.id AND d.unit_cost IS NULL
$$;

-- Lignes de vente pour les marges : ticket (POS), rapprochement (ventes saisies
-- avant le POS) et BL professionnels, avec le coût figé quand il existe.
CREATE OR REPLACE VIEW v_sales_margin_lines AS
SELECT s.store_id, (COALESCE(s.paid_at, s.created_at) AT TIME ZONE 'Africa/Casablanca')::date AS business_date,
       si.product_id, s.channel_id, COALESCE(si.unit, 'unit') AS unit,
       SUM(si.quantity)::numeric AS qty, SUM(si.subtotal) AS revenue,
       SUM(si.quantity * si.unit_cost) FILTER (WHERE si.unit_cost IS NOT NULL) AS frozen_cost,
       COALESCE(SUM(si.quantity) FILTER (WHERE si.unit_cost IS NOT NULL), 0)::numeric AS frozen_qty,
       'pos'::text AS source
  FROM sale_items si JOIN sales s ON s.id = si.sale_id
 WHERE s.store_id IS NOT NULL AND (s.payment_status IS DISTINCT FROM 'unpaid' OR s.sold_on_credit)
 GROUP BY 1, 2, 3, 4, 5
UNION ALL
SELECT v.store_id, v.business_date, v.product_id, v.channel_id, v.unit, v.qty, v.revenue, NULL, 0, v.source
  FROM v_sales_product_daily v WHERE v.source = 'recon'
UNION ALL
SELECT dn.store_id, dn.delivery_date, dni.product_id,
       COALESCE(o.channel_id, (SELECT id FROM sales_channels WHERE code = 'gros' LIMIT 1)), 'unit',
       SUM(dni.quantity), SUM(dni.subtotal),
       SUM(dni.quantity * dni.unit_cost) FILTER (WHERE dni.unit_cost IS NOT NULL),
       COALESCE(SUM(dni.quantity) FILTER (WHERE dni.unit_cost IS NOT NULL), 0),
       'b2b'
  FROM delivery_note_items dni
  JOIN delivery_notes dn ON dn.id = dni.delivery_note_id
  LEFT JOIN orders o ON o.id = dn.order_id
 WHERE dn.status <> 'cancelled' AND dni.product_id IS NOT NULL
 GROUP BY 1, 2, 3, 4;

-- ─── 2. Fin de période ───────────────────────────────────────────────────
INSERT INTO accounts (code, label, account_class, rubrique, poste, account_type, normal_side)
VALUES ('3427', 'Clients - Factures à établir', 3, '34', '342', 'asset', 'D'),
       ('7132', 'Variation des stocks de produits', 7, '71', '713', 'revenue', 'C')
ON CONFLICT (code) DO NOTHING;
INSERT INTO posting_profiles (event_type, account_code, description) VALUES
  ('unbilled_receivable', '3427', 'BL livrés non facturés à la clôture : factures à établir (O2C L6, mig 452)'),
  ('fg_stock', '3151', 'Stock de produits finis valorisé à la clôture (O2C L6, mig 452)'),
  ('fg_stock_variation', '7132', 'Variation du stock de produits finis (O2C L6, mig 452)')
ON CONFLICT DO NOTHING;

-- Livré non facturé à une date : BL livrés à cette date, non facturés ou facturés après.
CREATE OR REPLACE VIEW v_o2c_unbilled_at AS
SELECT fp.end_date AS as_of, dn.id AS delivery_note_id, dn.number, dn.customer_id, dn.delivery_date,
       SUM(dni.subtotal) AS ht
  FROM fiscal_periods fp
  JOIN delivery_notes dn ON dn.delivery_date <= fp.end_date AND dn.status IN ('delivered', 'invoiced')
  JOIN delivery_note_items dni ON dni.delivery_note_id = dn.id
  LEFT JOIN invoices i ON i.id = dn.invoice_id
 WHERE dn.status = 'delivered' OR i.invoice_date > fp.end_date
 GROUP BY fp.end_date, dn.id;

CREATE TABLE IF NOT EXISTS period_end_operations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id     UUID NOT NULL REFERENCES fiscal_periods(id),
  kind          VARCHAR(20) NOT NULL CHECK (kind IN ('fae', 'fg_stock')),
  amount        NUMERIC(14,2) NOT NULL,
  detail        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_period_end_op_active ON period_end_operations (period_id, kind) WHERE superseded_at IS NULL;

-- ─── 3. Contrôles de clôture (reprend la version de la mig 416) ──────────
CREATE OR REPLACE FUNCTION fn_close_checklist(p_period uuid)
RETURNS TABLE (code text, label text, item_count bigint, amount numeric, blocking boolean) LANGUAGE sql STABLE AS $$
  WITH p AS (SELECT * FROM fiscal_periods WHERE id = p_period)
  SELECT 'previous_open', 'Période précédente encore ouverte',
         count(*), NULL::numeric, true
    FROM fiscal_periods f, p WHERE f.end_date = p.start_date - 1 AND f.status = 'open'
  UNION ALL
  SELECT 'invoices_unposted', 'Factures fournisseurs sans écriture',
         count(*), COALESCE(sum(i.total_amount), 0), true
    FROM invoices i, p
   WHERE i.invoice_type = 'received' AND i.status <> 'cancelled' AND i.total_amount > 0
     AND i.invoice_date BETWEEN p.start_date AND p.end_date
     AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_id = i.id AND je.status = 'posted')
  UNION ALL
  SELECT 'payments_unposted', 'Paiements sans écriture',
         count(*), COALESCE(sum(pa.amount), 0), true
    FROM payments pa, p
   WHERE pa.status <> 'void' AND pa.amount > 0 AND pa.payment_method <> 'avoir'
     AND pa.payment_date BETWEEN p.start_date AND p.end_date
     AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_id = pa.id AND je.status = 'posted')
  UNION ALL
  SELECT 'outbox_pending', 'Comptabilisations en attente (file)',
         count(*), NULL::numeric, true
    FROM ledger_outbox o WHERE o.status <> 'posted'
  UNION ALL
  SELECT 'draft_entries', 'Écritures en brouillon dans la période',
         count(*), NULL::numeric, true
    FROM journal_entries je, p WHERE je.status = 'draft' AND je.fiscal_period_id = p.id
  UNION ALL
  SELECT 'grir_aged', 'Réceptions non facturées depuis plus de 30 jours',
         count(*), COALESCE(sum(g.open_amount), 0), false
    FROM v_grir_open_items g, p WHERE g.first_event <= p.end_date AND g.open_amount > 0 AND (p.end_date - g.first_event) > 30
  UNION ALL
  SELECT 'invoice_holds', 'Factures du mois avec blocage ouvert',
         count(DISTINCT h.invoice_id), NULL::numeric, false
    FROM invoice_holds h JOIN invoices i ON i.id = h.invoice_id, p
   WHERE h.released_at IS NULL AND i.invoice_date BETWEEN p.start_date AND p.end_date
  -- ─── Caisse (mig 415) ───
  UNION ALL
  SELECT 'pos_sessions_open', 'Sessions de caisse non fermées',
         count(*), NULL::numeric, true
    FROM cash_register_sessions cs, p
   WHERE cs.status <> 'closed'
     AND (cs.opened_at AT TIME ZONE 'Africa/Casablanca')::date BETWEEN p.start_date AND p.end_date
  UNION ALL
  SELECT 'pos_sales_unposted', 'Tickets de caisse sans écriture',
         count(*), COALESCE(sum(s.total), 0), true
    FROM sales s, p
   WHERE s.payment_status IS DISTINCT FROM 'unpaid' AND s.total > 0
     AND DATE(COALESCE(s.paid_at, s.created_at) AT TIME ZONE 'Africa/Casablanca') BETWEEN p.start_date AND p.end_date
     AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_id = s.id AND je.status <> 'draft')
     AND NOT EXISTS (SELECT 1 FROM manual_shift_entries m
                      WHERE m.store_id = s.store_id
                        AND m.entry_date = DATE(COALESCE(s.paid_at, s.created_at) AT TIME ZONE 'Africa/Casablanca'))
  UNION ALL
  SELECT 'cash_credit_balance', 'Caisse (5161) en solde créditeur en fin de période',
         (CASE WHEN c.bal < 0 THEN 1 ELSE 0 END)::bigint, c.bal, true
    FROM (SELECT COALESCE(sum(l.debit) - sum(l.credit), 0) AS bal
            FROM journal_entry_lines l
            JOIN journal_entries je ON je.id = l.journal_entry_id
            JOIN accounts a ON a.id = l.account_id, p
           WHERE a.code = '5161' AND je.status IN ('posted', 'reversed') AND je.entry_date <= p.end_date
             AND je.entry_date >= fn_ledger_window_start(p.end_date, 5)) c
  UNION ALL
  SELECT 'pos_closure_diff_unposted', 'Écarts de fermeture de caisse sans écriture',
         count(*), COALESCE(sum(cs.difference), 0), false
    FROM cash_register_sessions cs, p
   WHERE cs.status = 'closed' AND COALESCE(cs.difference, 0) <> 0
     AND (cs.closed_at AT TIME ZONE 'Africa/Casablanca')::date BETWEEN p.start_date AND p.end_date
     AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_id = cs.id AND je.source_kind = 'closure_diff' AND je.status <> 'draft')
  UNION ALL
  SELECT 'pos_days_without_sales', 'Jours sans aucune vente en caisse',
         count(*), NULL::numeric, false
    FROM p, generate_series(p.start_date, LEAST(p.end_date, CURRENT_DATE), interval '1 day') AS d(day)
   WHERE NOT EXISTS (SELECT 1 FROM sales s
                      WHERE DATE(COALESCE(s.paid_at, s.created_at) AT TIME ZONE 'Africa/Casablanca') = d.day::date)
     AND NOT EXISTS (SELECT 1 FROM manual_shift_entries m WHERE m.entry_date = d.day::date)
  -- ─── Cycle de vente (mig 452, O2C L6) ───
  UNION ALL
  SELECT 'customer_invoices_unposted', 'Factures clients sans écriture',
         count(*), COALESCE(sum(i.total_amount), 0), true
    FROM invoices i, p
   WHERE i.invoice_type = 'emitted' AND i.status <> 'cancelled' AND i.total_amount > 0
     AND i.invoice_date BETWEEN p.start_date AND p.end_date
     AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_id = i.id AND je.status = 'posted')
  UNION ALL
  SELECT 'o2c_unbilled_deliveries', 'BL livrés non facturés à la fin de la période (factures à établir non passées)',
         count(*), COALESCE(sum(x.ht), 0), false
    FROM p, v_o2c_unbilled_at x
   WHERE x.as_of = p.end_date
     AND NOT EXISTS (SELECT 1 FROM period_end_operations o WHERE o.period_id = p.id AND o.kind = 'fae' AND o.superseded_at IS NULL)
  UNION ALL
  SELECT 'fg_stock_not_valued', 'Stock de produits finis non valorisé pour la période',
         (CASE WHEN EXISTS (SELECT 1 FROM period_end_operations o WHERE o.period_id = p.id AND o.kind = 'fg_stock' AND o.superseded_at IS NULL)
               THEN 0 ELSE 1 END)::bigint, NULL::numeric, false
    FROM p
$$;
