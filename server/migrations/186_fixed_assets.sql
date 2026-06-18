-- Migration 186 : Immobilisations et amortissements (CGNC Maroc)
--
-- POURQUOI
--   Le materiel (four, frigo, caisse, mobilier, agencements) constitue des
--   immobilisations qui s'amortissent sur plusieurs annees. Chaque dotation
--   genere une ecriture 6191 (dotation) / 28xx (amortissement cumule). Ce module
--   gere le registre des immos et la generation des ecritures de dotation.
--
-- PORTEE
--   - Comptes d'amortissement CGNC manquants (2831, 2833, 2834).
--   - Table fixed_assets : registre des immobilisations.
--   - Table depreciation_entries : planning + lien vers l'ecriture generee.
--   Aucune table existante modifiee.
--
-- INVERSION
--   DROP TABLE depreciation_entries; DROP TABLE fixed_assets;
--   (les comptes seedes peuvent rester, inoffensifs)

-- ============================================================================
-- 1. Comptes d'amortissement manquants (contra-actif, sens crediteur)
-- ============================================================================
INSERT INTO accounts (code, label, account_class, rubrique, poste, account_type, normal_side) VALUES
  ('2831', 'Amortissements des non-valeurs',                   2, '28', '283', 'asset', 'C'),
  ('2833', 'Amortissements des constructions',                 2, '28', '283', 'asset', 'C'),
  ('2834', 'Amortissements du mobilier et amenagements',       2, '28', '283', 'asset', 'C')
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- 2. Table fixed_assets (registre des immobilisations)
-- ============================================================================
CREATE TABLE IF NOT EXISTS fixed_assets (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label                   VARCHAR(200) NOT NULL,
  -- Comptes comptables
  asset_account_id        UUID NOT NULL REFERENCES accounts(id),        -- 23xx (valeur brute)
  depreciation_account_id UUID NOT NULL REFERENCES accounts(id),        -- 28xx (amort. cumule)
  expense_account_id      UUID NOT NULL REFERENCES accounts(id),        -- 6191 (dotation)
  -- Donnees d'amortissement
  acquisition_date        DATE NOT NULL,
  acquisition_cost        DECIMAL(14,2) NOT NULL CHECK (acquisition_cost > 0),
  residual_value          DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK (residual_value >= 0),
  duration_years          INT NOT NULL CHECK (duration_years > 0),
  method                  VARCHAR(20) NOT NULL DEFAULT 'linear'
                            CHECK (method IN ('linear', 'degressive')),
  -- Statut du cycle de vie
  status                  VARCHAR(20) NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'disposed', 'fully_depreciated')),
  disposal_date           DATE,
  -- Tracabilite
  supplier_id             UUID REFERENCES suppliers(id),
  store_id                UUID REFERENCES stores(id),
  notes                   TEXT,
  created_by              UUID REFERENCES users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (residual_value < acquisition_cost)
);

CREATE INDEX IF NOT EXISTS idx_fixed_assets_status ON fixed_assets(status);
CREATE INDEX IF NOT EXISTS idx_fixed_assets_store  ON fixed_assets(store_id);

COMMENT ON TABLE fixed_assets IS
  'Registre des immobilisations. Chaque immo s''amortit selon method/duration et genere des ecritures de dotation.';

-- ============================================================================
-- 3. Table depreciation_entries (dotations periodiques)
-- ============================================================================
-- Une ligne par periode (mois) amortie. Reliee a l'ecriture comptable generee.
-- Unicite (asset, annee, mois) -> idempotence du calcul.

CREATE TABLE IF NOT EXISTS depreciation_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixed_asset_id    UUID NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  fiscal_year       SMALLINT NOT NULL,
  period_month      SMALLINT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  amount            DECIMAL(14,2) NOT NULL CHECK (amount >= 0),
  journal_entry_id  UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (fixed_asset_id, fiscal_year, period_month)
);

CREATE INDEX IF NOT EXISTS idx_depr_asset  ON depreciation_entries(fixed_asset_id);
CREATE INDEX IF NOT EXISTS idx_depr_period ON depreciation_entries(fiscal_year, period_month);

COMMENT ON TABLE depreciation_entries IS
  'Dotations aux amortissements par immobilisation et par mois. journal_entry_id lie a l''ecriture 6191/28xx.';
