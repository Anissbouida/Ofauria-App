-- ═══════════════════════════════════════════════════════════════════════
-- 427 — Cession et mise au rebut des immobilisations (lot Important 9)
-- ═══════════════════════════════════════════════════════════════════════
-- POURQUOI
--   Une immobilisation vendue ou jetée restait « active » et continuait d'être
--   amortie : la sortie du bilan (valeur brute, amortissements cumulés) et la
--   plus ou moins-value n'existaient pas.
--
-- QUOI
--   1. Comptes CGNC de cession : 6512/6513 valeurs nettes d'amortissements des
--      immobilisations cédées, 7512/7513 produits des cessions, 3481 créances
--      sur cessions d'immobilisations.
--   2. fixed_assets : nature et date de sortie, prix, contrepartie, VNC et
--      plus-value figées, écritures de sortie et de dotation complémentaire.
--   3. depreciation_entries.disposal : dotation complémentaire passée à la
--      sortie (annulée avec elle si la cession est annulée).
--
-- Schéma comptable (journal OD, une écriture « Cession ») :
--   dotation complémentaire jusqu'au mois de sortie inclus (6191 / 28xx) ;
--   sortie : 28xx D (cumul) + 651x D (VNC) / 23xx C (valeur brute) ;
--   prix : 3481 ou 5141 ou 5161 D (TTC) / 751x C (HT) + 4455x C (TVA).
--
-- INVERSION
--   ALTER TABLE depreciation_entries DROP COLUMN disposal ;
--   ALTER TABLE fixed_assets DROP COLUMN disposal_kind, … (colonnes ci-dessous) ;
--   les comptes ajoutés peuvent rester.
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO accounts (code, label, account_class, rubrique, poste, account_type, normal_side) VALUES
  ('3481', 'Créances sur cessions d''immobilisations',                                3, '34', '348', 'asset',   'D'),
  ('6512', 'Valeurs nettes d''amortissements des immobilisations incorporelles cédées', 6, '65', '651', 'expense', 'D'),
  ('6513', 'Valeurs nettes d''amortissements des immobilisations corporelles cédées',   6, '65', '651', 'expense', 'D'),
  ('7512', 'Produits des cessions des immobilisations incorporelles',                 7, '75', '751', 'revenue', 'C'),
  ('7513', 'Produits des cessions des immobilisations corporelles',                   7, '75', '751', 'revenue', 'C')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE fixed_assets
  ADD COLUMN IF NOT EXISTS disposal_kind        varchar(10) CHECK (disposal_kind IN ('sale', 'scrap')),
  ADD COLUMN IF NOT EXISTS disposal_price       numeric(14,2) CHECK (disposal_price >= 0),
  ADD COLUMN IF NOT EXISTS disposal_vat         numeric(14,2) NOT NULL DEFAULT 0 CHECK (disposal_vat >= 0),
  ADD COLUMN IF NOT EXISTS disposal_counterpart varchar(12) CHECK (disposal_counterpart IN ('receivable', 'bank', 'cash')),
  ADD COLUMN IF NOT EXISTS disposal_buyer       varchar(200),
  ADD COLUMN IF NOT EXISTS disposal_reason      text,
  ADD COLUMN IF NOT EXISTS disposal_cumulated   numeric(14,2),
  ADD COLUMN IF NOT EXISTS disposal_vnc         numeric(14,2),
  ADD COLUMN IF NOT EXISTS disposal_gain        numeric(14,2),
  ADD COLUMN IF NOT EXISTS disposal_entry_id    uuid REFERENCES journal_entries(id),
  ADD COLUMN IF NOT EXISTS disposed_by          uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS disposed_at          timestamptz;

-- Une immobilisation sortie porte sa date, sa nature et son écriture.
ALTER TABLE fixed_assets DROP CONSTRAINT IF EXISTS fixed_assets_disposal_check;
ALTER TABLE fixed_assets ADD CONSTRAINT fixed_assets_disposal_check CHECK (
  status <> 'disposed' OR (disposal_date IS NOT NULL AND disposal_kind IS NOT NULL AND disposal_entry_id IS NOT NULL));

ALTER TABLE depreciation_entries ADD COLUMN IF NOT EXISTS disposal boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN fixed_assets.disposal_gain IS
  'Mig 427 : plus-value (positive) ou moins-value (négative) = prix HT − VNC à la date de sortie.';
