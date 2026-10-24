-- ═══════════════════════════════════════════════════════════════════════
-- 314 — Prévision de la demande, lot 1
--   Historique de ventes unifié + calendrier d'événements + saisies manuelles
--   + instantanés (mesure de précision). Le calcul lui-même est en TS
--   (services/demand-forecast.ts) : la base ne fournit que les faits.
--
--   Deux sources de ventes par produit :
--     - sale_items (caisse / import /sales/import), relié à products ;
--     - recon_lines (Contrôle des ventes, imports Loyverse par shift), clé texte
--       product_key SANS lien produit → table de correspondance recon_product_links.
--   Pour un couple (magasin, jour), sale_items prime s'il a des lignes ; sinon
--   recon_lines. Jamais la somme des deux (même vente comptée 2×).
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Correspondance produit Loyverse → produit catalogue ─────────────────
CREATE TABLE IF NOT EXISTS recon_product_links (
  product_key  VARCHAR(200) PRIMARY KEY,
  product_id   UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  matched_by   VARCHAR(10) NOT NULL CHECK (matched_by IN ('sku', 'name', 'manual')),
  updated_by   UUID REFERENCES users(id),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recon_product_links_product ON recon_product_links(product_id);

-- Pré-remplissage : SKU d'abord, puis nom exact (insensible casse/espaces) quand
-- il désigne un seul produit. Les correspondances manuelles ne sont jamais écrasées.
INSERT INTO recon_product_links (product_key, product_id, matched_by)
SELECT rp.product_key, p.id, 'sku'
FROM recon_products rp
JOIN products p ON p.sku IS NOT NULL AND UPPER(TRIM(p.sku)) = rp.product_key
ON CONFLICT (product_key) DO NOTHING;

INSERT INTO recon_product_links (product_key, product_id, matched_by)
SELECT rp.product_key, m.id, 'name'
FROM recon_products rp
JOIN (
  SELECT UPPER(TRIM(name)) AS k, (array_agg(id))[1] AS id
  FROM products
  GROUP BY UPPER(TRIM(name))
  HAVING COUNT(*) = 1
) m ON m.k = UPPER(TRIM(rp.product_name))
ON CONFLICT (product_key) DO NOTHING;

-- ─── Historique journalier unifié ────────────────────────────────────────
-- Jour métier en Africa/Casablanca (fuseau par défaut de utils/timezone.ts).
-- sale_items : produits à l'unité seulement (unit='g' = quantité en grammes,
-- incompatible avec planned_quantity entier).
CREATE OR REPLACE VIEW v_demand_daily AS
WITH pos AS (
  SELECT s.store_id,
         (s.created_at AT TIME ZONE 'Africa/Casablanca')::date AS business_date,
         si.product_id,
         SUM(si.quantity)::numeric AS sold_qty
  FROM sale_items si
  JOIN sales s ON s.id = si.sale_id
  WHERE COALESCE(si.unit, 'unit') = 'unit'
    AND s.store_id IS NOT NULL
  GROUP BY 1, 2, 3
),
pos_days AS (
  SELECT DISTINCT store_id, business_date FROM pos
),
recon_sold AS (
  SELECT d.store_id, d.business_date, l.product_id, SUM(rl.vendu_qty) AS sold_qty
  FROM recon_lines rl
  JOIN recon_days d ON d.id = rl.recon_day_id
  JOIN recon_product_links l ON l.product_key = rl.product_key
  WHERE NOT rl.hidden AND d.store_id IS NOT NULL
  GROUP BY 1, 2, 3
),
-- Journées où les invendus ont réellement été comptés : sur un jour sans aucun
-- invendu saisi, 0 veut dire « non compté », pas « tout vendu » (sinon la
-- correction de rupture gonfle toute la prévision).
recon_counted AS (
  SELECT rl.recon_day_id
  FROM recon_lines rl
  WHERE NOT rl.hidden
  GROUP BY rl.recon_day_id
  HAVING SUM(rl.invendu_qty) > 0
),
-- Reste de fin de journée = invendu du DERNIER shift saisi (comme report()),
-- jamais la somme des shifts.
recon_left AS (
  SELECT DISTINCT ON (d.store_id, d.business_date, l.product_id)
         d.store_id, d.business_date, l.product_id, rl.invendu_qty AS unsold_qty
  FROM recon_lines rl
  JOIN recon_days d ON d.id = rl.recon_day_id
  JOIN recon_counted rc ON rc.recon_day_id = rl.recon_day_id
  LEFT JOIN recon_shifts sh ON sh.id = rl.recon_shift_id
  JOIN recon_product_links l ON l.product_key = rl.product_key
  WHERE NOT rl.hidden AND d.store_id IS NOT NULL
  ORDER BY d.store_id, d.business_date, l.product_id, COALESCE(sh.shift_number, 0) DESC
),
unsold AS (
  SELECT store_id, (decided_at AT TIME ZONE 'Africa/Casablanca')::date AS business_date,
         product_id, SUM(remaining_qty)::numeric AS unsold_qty
  FROM unsold_decisions
  GROUP BY 1, 2, 3
)
SELECT p.store_id, p.business_date, p.product_id, p.sold_qty,
       u.unsold_qty, 'pos'::text AS source
FROM pos p
LEFT JOIN unsold u USING (store_id, business_date, product_id)
UNION ALL
SELECT r.store_id, r.business_date, r.product_id, r.sold_qty,
       COALESCE(rl.unsold_qty, u.unsold_qty) AS unsold_qty, 'recon'::text AS source
FROM recon_sold r
LEFT JOIN recon_left rl USING (store_id, business_date, product_id)
LEFT JOIN unsold u USING (store_id, business_date, product_id)
WHERE NOT EXISTS (
  SELECT 1 FROM pos_days pd WHERE pd.store_id = r.store_id AND pd.business_date = r.business_date
);

-- ─── Calendrier d'événements ─────────────────────────────────────────────
-- uplift_pct : effet attendu sur la demande (+30 = +30 %, -100 = fermé).
-- 'fermeture' : jour exclu de l'historique et prévision à 0.
CREATE TABLE IF NOT EXISTS calendar_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     UUID REFERENCES stores(id) ON DELETE CASCADE,
  date_start   DATE NOT NULL,
  date_end     DATE NOT NULL,
  kind         VARCHAR(20) NOT NULL
               CHECK (kind IN ('ramadan', 'fete', 'vacances', 'evenement', 'fermeture')),
  label        VARCHAR(150) NOT NULL,
  uplift_pct   NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (uplift_pct >= -100 AND uplift_pct <= 500),
  category_id  INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (date_end >= date_start)
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_dates ON calendar_events(date_start, date_end);

-- ─── Saisies manuelles (priment sur le calcul) ───────────────────────────
CREATE TABLE IF NOT EXISTS demand_forecast_overrides (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  forecast_date  DATE NOT NULL,
  quantity       INTEGER NOT NULL CHECK (quantity >= 0),
  reason         TEXT,
  set_by         UUID REFERENCES users(id),
  set_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, product_id, forecast_date)
);

-- ─── Instantanés : ce qui a été proposé au moment de l'utiliser ──────────
-- Premier usage gagne (plan créé, fiche de besoin) : la précision se mesure
-- sur ce qui a réellement guidé la décision, pas sur un recalcul a posteriori.
CREATE TABLE IF NOT EXISTS demand_forecast_snapshots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  forecast_date  DATE NOT NULL,
  forecast_qty   INTEGER NOT NULL,
  base_qty       NUMERIC(12,2),
  method         VARCHAR(20) NOT NULL,
  used_for       VARCHAR(20) NOT NULL CHECK (used_for IN ('plan', 'fiche', 'manual')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, product_id, forecast_date)
);
