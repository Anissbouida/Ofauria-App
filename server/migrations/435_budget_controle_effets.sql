-- ═══════════════════════════════════════════════════════════════════════
-- 435 — Contrôle budgétaire et portefeuille d'effets (lot Bonus 15)
--
--   1. Contrôle budgétaire sur le budget annuel par compte (mig 317) :
--      action « aucune / alerte / blocage » et période de contrôle (année ou
--      cumul à fin de mois). Engagé = part des bons de commande engagés ni
--      reçue ni facturée (la réception passe déjà la charge contre 4417, la
--      facture ensuite : le réel les porte), au compte de charge de la ligne.
--   2. Portefeuille d'effets clients : chèques et traites reçus remis en
--      banque par bordereau, à l'encaissement ou à l'escompte (traites).
--      Escompte : 5141 (net) + 6311 agios + 6147 commissions + 34552 TVA
--      au débit, 5520 crédits d'escompte (nominal) au crédit ; à l'échéance
--      l'effet se dénoue en 5520 / 5113. Impayé : le règlement est annulé
--      (motif « Effet impayé », extourne, créance client rouverte), la banque
--      reprend le nominal escompté (5520 / 5141) et ses frais (6147 / 5141).
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Contrôle budgétaire ──────────────────────────────────────────────
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS control_action VARCHAR(8) NOT NULL DEFAULT 'none';
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS control_period VARCHAR(12) NOT NULL DEFAULT 'annual';
DO $$ BEGIN
  ALTER TABLE budgets ADD CONSTRAINT budgets_control_action_check CHECK (control_action IN ('none', 'warn', 'block'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE budgets ADD CONSTRAINT budgets_control_period_check CHECK (control_period IN ('annual', 'cumulative'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Compte de charge d'une catégorie (elle-même ou le plus proche parent qui en a un).
CREATE OR REPLACE FUNCTION fn_expense_category_account(p_category UUID) RETURNS UUID
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE chain AS (
    SELECT id, parent_id, account_id, 0 AS depth FROM expense_categories WHERE id = p_category
    UNION ALL
    SELECT c.id, c.parent_id, c.account_id, ch.depth + 1
      FROM expense_categories c JOIN chain ch ON ch.parent_id = c.id
     WHERE ch.depth < 20
  )
  SELECT account_id FROM chain WHERE account_id IS NOT NULL ORDER BY depth LIMIT 1
$$;

-- Engagements : lignes de BC engagés, montant HT restant (ni reçu ni facturé).
CREATE OR REPLACE VIEW v_budget_commitments AS
WITH po AS (
  SELECT po.id, po.order_number, po.store_id, po.order_date, po.status,
         COALESCE(po.exchange_rate, 1)::numeric AS rate
    FROM purchase_orders po
   WHERE po.status IN ('envoye', 'livre_partiel', 'en_attente_facturation', 'livre_complet')
),
lines AS (
  SELECT poi.id AS line_id, po.id AS purchase_order_id, po.order_number, po.store_id, po.order_date,
         COALESCE(poi.category_id, ing.category_id, pkg.category_id) AS category_id,
         COALESCE(poi.amount_ht,
                  poi.quantity_ordered * COALESCE(poi.unit_price, 0) * (1 - COALESCE(poi.discount_pct, 0) / 100))::numeric * po.rate AS amount_ht,
         poi.quantity_ordered::numeric AS ordered,
         COALESCE(poi.quantity_delivered, 0)::numeric AS delivered
    FROM purchase_order_items poi
    JOIN po ON po.id = poi.purchase_order_id
    LEFT JOIN ingredients ing ON ing.id = poi.ingredient_id
    LEFT JOIN packaging_items pkg ON pkg.id = poi.packaging_id
),
po_total AS (SELECT purchase_order_id, SUM(amount_ht) AS total FROM lines GROUP BY 1),
invoiced AS (
  SELECT x.purchase_order_id, SUM(x.ht) AS ht
    FROM (
      SELECT DISTINCT i.id, COALESCE(ipo.purchase_order_id, i.purchase_order_id) AS purchase_order_id,
             (i.total_amount - COALESCE(i.tax_amount, 0))::numeric AS ht
        FROM invoices i
        LEFT JOIN invoice_purchase_orders ipo ON ipo.invoice_id = i.id
       WHERE i.status <> 'cancelled' AND i.invoice_type = 'received'
         AND COALESCE(ipo.purchase_order_id, i.purchase_order_id) IS NOT NULL
    ) x
   GROUP BY 1
)
SELECT l.line_id, l.purchase_order_id, l.order_number, l.store_id, l.order_date,
       fn_expense_category_account(l.category_id) AS account_id,
       ROUND(l.amount_ht * GREATEST(0, 1 - GREATEST(
         CASE WHEN l.ordered > 0 THEN LEAST(1, l.delivered / l.ordered) ELSE 1 END,
         CASE WHEN COALESCE(t.total, 0) > 0 THEN LEAST(1, COALESCE(inv.ht, 0) / t.total) ELSE 0 END)), 2) AS committed
  FROM lines l
  LEFT JOIN po_total t ON t.purchase_order_id = l.purchase_order_id
  LEFT JOIN invoiced inv ON inv.purchase_order_id = l.purchase_order_id;

-- ─── 2. Portefeuille d'effets ────────────────────────────────────────────
INSERT INTO accounts (code, label, account_class, rubrique, poste, account_type, normal_side) VALUES
  ('5520', 'Crédits d''escompte', 5, '55', '552', 'liability', 'C')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS bill_remittances (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  remittance_number    VARCHAR(20) NOT NULL UNIQUE,
  kind                 VARCHAR(10) NOT NULL CHECK (kind IN ('collection', 'discount')),
  treasury_account_id  UUID NOT NULL REFERENCES treasury_accounts(id),
  remittance_date      DATE NOT NULL,
  store_id             UUID REFERENCES stores(id),
  gross_amount         NUMERIC(14,2) NOT NULL CHECK (gross_amount > 0),
  -- Escompte : agios (intérêts), commissions HT et leur TVA, retenus par la banque.
  interest             NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (interest >= 0),
  commission           NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (commission >= 0),
  commission_vat       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (commission_vat >= 0),
  net_amount           NUMERIC(14,2) NOT NULL,
  status               VARCHAR(10) NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'cancelled')),
  entry_id             UUID REFERENCES journal_entries(id),
  note                 TEXT,
  created_by           UUID REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_by         UUID REFERENCES users(id),
  cancelled_at         TIMESTAMPTZ,
  CHECK (kind = 'discount' OR (interest = 0 AND commission = 0 AND commission_vat = 0)),
  CHECK (net_amount = gross_amount - interest - commission - commission_vat)
);
CREATE INDEX IF NOT EXISTS idx_bill_remittances_date ON bill_remittances (remittance_date DESC);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS remittance_id UUID REFERENCES bill_remittances(id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS unpaid_at DATE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS unpaid_fees NUMERIC(14,2);
CREATE INDEX IF NOT EXISTS idx_payments_remittance ON payments (remittance_id) WHERE remittance_id IS NOT NULL;

INSERT INTO ref_entries (table_id, code, label, display_order, metadata) VALUES
  ('purchase_reason_codes', 'void_unpaid_bill', 'Effet ou chèque client impayé', 40, '{"scope":["void_payment"]}')
ON CONFLICT DO NOTHING;
