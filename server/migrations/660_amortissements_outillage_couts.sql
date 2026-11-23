-- ═══════════════════════════════════════════════════════════════════════
-- 660 — Amortissement des équipements et coût de l'outillage dans le coût de revient
-- ═══════════════════════════════════════════════════════════════════════
-- POURQUOI
--   Le coût de revient ne comptait ni l'usure des équipements (four, pétrin, chambre de
--   pousse…) ni celle de l'outillage (moules, plaques, cercles, ustensiles). Le registre
--   des immobilisations (fixed_assets, avec ses dotations) existait mais n'était lu par
--   aucun calcul de coût.
--
-- QUOI
--   1. fixed_assets : rattachement analytique — centre de coûts, ou produit dédié (charge
--      directe), ou exclu (immobilisation sans lien avec la production : véhicule de
--      direction…). Sans rattachement : le centre de production si l'immobilisation est un
--      équipement de production (production_equipements.fixed_asset_id), sinon
--      l'administration.
--   2. fn_fixed_asset_month_depreciation(immobilisation, mois) : dotation du mois — écriture
--      de dotation enregistrée (depreciation_entries) si elle existe, sinon linéaire
--      (coût − valeur résiduelle) ÷ (durée × 12) pendant la durée d'amortissement, jusqu'à
--      la cession.
--   3. production_tools : registre de l'outillage et du petit matériel (non immobilisé) :
--      coût, quantité, date d'achat, durée d'usage en mois → coût mensuel = coût × quantité
--      ÷ durée, pendant la durée d'usage ; rattaché à un centre ou à un produit.
--   Le moteur analytique les ajoute aux charges des centres (nature « amortissement » ou
--   « outillage ») ou aux charges directes du produit ; le coût d'un plan les détaille.
--
-- INVERSION
--   DROP TABLE production_tools ; DROP FUNCTION fn_fixed_asset_month_depreciation(uuid, date) ;
--   ALTER TABLE fixed_assets DROP COLUMN cost_center_id, DROP COLUMN product_id, DROP COLUMN analytic_excluded ;
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS cost_center_id    uuid REFERENCES cost_centers(id);
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS product_id        uuid REFERENCES products(id);
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS analytic_excluded boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN fixed_assets.cost_center_id IS 'Mig 660 : centre de coûts qui porte la dotation (NULL = production si équipement de production, sinon administration).';
COMMENT ON COLUMN fixed_assets.product_id IS 'Mig 660 : équipement dédié à un produit — la dotation est une charge directe de ce produit.';
COMMENT ON COLUMN fixed_assets.analytic_excluded IS 'Mig 660 : immobilisation hors coût de revient.';

CREATE OR REPLACE FUNCTION fn_fixed_asset_month_depreciation(p_asset uuid, p_period date)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT SUM(d.amount) FROM depreciation_entries d
      WHERE d.fixed_asset_id = p_asset AND NOT COALESCE(d.disposal, false)
        AND d.fiscal_year = EXTRACT(YEAR FROM p_period) AND d.period_month = EXTRACT(MONTH FROM p_period)),
    (SELECT ROUND((fa.acquisition_cost - fa.residual_value) / (fa.duration_years * 12.0), 2)
       FROM fixed_assets fa
      WHERE fa.id = p_asset
        AND date_trunc('month', fa.acquisition_date) <= p_period
        AND p_period < date_trunc('month', fa.acquisition_date) + make_interval(years => fa.duration_years)
        AND (fa.disposal_date IS NULL OR date_trunc('month', fa.disposal_date) > p_period)),
    0)
$$;
COMMENT ON FUNCTION fn_fixed_asset_month_depreciation(uuid, date) IS
  'Mig 660 : dotation d''un mois d''une immobilisation — écriture de dotation enregistrée, sinon linéaire sur la durée, jusqu''à la cession.';

CREATE TABLE IF NOT EXISTS production_tools (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       uuid REFERENCES stores(id),
  label          varchar(160) NOT NULL,
  category       varchar(20) NOT NULL DEFAULT 'ustensile'
                 CHECK (category IN ('moule', 'plaque', 'ustensile', 'petit_materiel', 'textile', 'autre')),
  unit_cost      numeric(12,2) NOT NULL CHECK (unit_cost >= 0),
  quantity       numeric(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  purchase_date  date NOT NULL DEFAULT CURRENT_DATE,
  life_months    int NOT NULL CHECK (life_months BETWEEN 1 AND 240),
  cost_center_id uuid REFERENCES cost_centers(id),
  product_id     uuid REFERENCES products(id),
  is_active      boolean NOT NULL DEFAULT true,
  notes          text,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_production_tools_store ON production_tools (store_id) WHERE is_active;
COMMENT ON TABLE production_tools IS
  'Mig 660 : outillage et petit matériel (non immobilisés) — coût mensuel = coût unitaire × quantité ÷ durée d''usage, pendant la durée d''usage ; centre de coûts (défaut : production) ou produit dédié.';

DROP TRIGGER IF EXISTS production_tools_config_audit ON production_tools;
CREATE TRIGGER production_tools_config_audit AFTER INSERT OR UPDATE OR DELETE ON production_tools
  FOR EACH ROW EXECUTE FUNCTION log_config_change('id', 'store_id');
