-- ═══════════════════════════════════════════════════════════════════════
-- 317 — Budget et contrôle de gestion, lot 4
--   1. Budget annuel par compte du CPC (classes 6 et 7) et par mois, comme un
--      budget GL : le réel vient des écritures comptabilisées, par magasin.
--   2. Ventes par produit et par jour, toutes sources (même règle que
--      v_demand_daily, mig 314 : la caisse prime, sinon le Contrôle des ventes),
--      en montant, avec le canal quand il est connu.
--   3. Coût de revient unitaire par produit, en cascade : format de la fiche
--      technique → recette (coût total / rendement) → products.cost_price.
--      Inconnu = NULL, signalé, jamais deviné.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Budgets ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS budgets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fiscal_year   SMALLINT NOT NULL CHECK (fiscal_year BETWEEN 2000 AND 2100),
  store_id      UUID REFERENCES stores(id),
  name          VARCHAR(120) NOT NULL,
  status        VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  notes         TEXT,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by   UUID REFERENCES users(id),
  approved_at   TIMESTAMPTZ
);
-- Un seul budget par exercice et par magasin (NULL = tous magasins).
CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_year_store
  ON budgets (fiscal_year, COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE IF NOT EXISTS budget_lines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id   UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  account_id  UUID NOT NULL REFERENCES accounts(id),
  month       SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  UNIQUE (budget_id, account_id, month)
);

-- ─── Ventes par produit et par jour, en montant ──────────────────────────
CREATE OR REPLACE VIEW v_sales_product_daily AS
WITH pos AS (
  SELECT s.store_id,
         (COALESCE(s.paid_at, s.created_at) AT TIME ZONE 'Africa/Casablanca')::date AS business_date,
         si.product_id, s.channel_id,
         SUM(si.quantity)::numeric AS qty,
         COALESCE(si.unit, 'unit') AS unit,
         SUM(si.subtotal)::numeric AS revenue
  FROM sale_items si
  JOIN sales s ON s.id = si.sale_id
  WHERE s.store_id IS NOT NULL AND s.payment_status IS DISTINCT FROM 'unpaid'
  GROUP BY 1, 2, 3, 4, 6
),
pos_days AS (SELECT DISTINCT store_id, business_date FROM pos),
recon AS (
  SELECT d.store_id, d.business_date, l.product_id,
         SUM(rl.vendu_qty)::numeric AS qty,
         SUM(COALESCE(rl.vendu_amount, rl.vendu_qty * rl.unit_price))::numeric AS revenue
  FROM recon_lines rl
  JOIN recon_days d ON d.id = rl.recon_day_id
  JOIN recon_product_links l ON l.product_key = rl.product_key
  WHERE NOT rl.hidden AND d.store_id IS NOT NULL
  GROUP BY 1, 2, 3
)
SELECT store_id, business_date, product_id, channel_id, qty, unit, revenue, 'pos'::text AS source FROM pos
UNION ALL
SELECT r.store_id, r.business_date, r.product_id,
       (SELECT id FROM sales_channels WHERE is_default ORDER BY display_order LIMIT 1) AS channel_id,
       r.qty, 'unit'::text, r.revenue, 'recon'::text
FROM recon r
WHERE NOT EXISTS (SELECT 1 FROM pos_days pd WHERE pd.store_id = r.store_id AND pd.business_date = r.business_date);

-- ─── Coût de revient unitaire par produit ────────────────────────────────
CREATE OR REPLACE VIEW v_product_unit_cost AS
WITH fmt AS (
  SELECT DISTINCT ON (COALESCE(rf.product_id, r.product_id))
         COALESCE(rf.product_id, r.product_id) AS product_id,
         v.cout_matiere_unitaire AS cost
  FROM v_recipe_format_cost v
  JOIN recipe_formats rf ON rf.id = v.id
  JOIN recipes r ON r.id = v.recipe_id
  WHERE v.cout_matiere_unitaire > 0 AND COALESCE(rf.product_id, r.product_id) IS NOT NULL
  ORDER BY COALESCE(rf.product_id, r.product_id), rf.is_default DESC NULLS LAST, v.ordre
),
rec AS (
  SELECT DISTINCT ON (r.product_id) r.product_id, t.total_cost / NULLIF(r.yield_quantity, 0) AS cost
  FROM v_recipe_total_cost t
  JOIN recipes r ON r.id = t.id
  WHERE t.total_cost > 0 AND r.product_id IS NOT NULL
  ORDER BY r.product_id, r.archived_at NULLS FIRST
)
-- cost_price ≥ prix de vente = valeur de remplissage (souvent cost_price = price),
-- pas un coût : on l'écarte plutôt que d'afficher une marge nulle ou négative.
, manual AS (
  SELECT id AS product_id, cost_price AS cost FROM products
  WHERE cost_price > 0 AND (price IS NULL OR price = 0 OR cost_price < price)
)
SELECT p.id AS product_id,
       COALESCE(f.cost, rc.cost, m.cost) AS unit_cost,
       CASE WHEN f.cost IS NOT NULL THEN 'format'
            WHEN rc.cost IS NOT NULL THEN 'recette'
            WHEN m.cost IS NOT NULL THEN 'fiche_produit'
       END AS cost_source
FROM products p
LEFT JOIN manual m ON m.product_id = p.id
LEFT JOIN fmt f ON f.product_id = p.id
LEFT JOIN rec rc ON rc.product_id = p.id;
