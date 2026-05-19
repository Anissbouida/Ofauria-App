-- ═══════════════════════════════════════════════════════════════
-- 139: Tracage des sachets remis par vente
--
-- Permet au reporting de mesurer la sur-distribution de sachets :
--   * sachets_given     : nb effectivement remis par la vendeuse
--   * sachets_suggested : nb calcule par le systeme a partir du panier
--   * sachet_reason     : motif quand sachets_given > sachets_suggested
--                         ('client_demande', 'produit_fragile', 'produit_chaud',
--                          'double_sachet', 'autre')
--
-- Toutes les colonnes sont nullables/avec defaut : pas de breaking change
-- sur les ventes existantes ni sur le code legacy qui n'envoie pas ces champs.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS sachets_given INTEGER
    CHECK (sachets_given IS NULL OR sachets_given >= 0);

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS sachets_suggested INTEGER
    CHECK (sachets_suggested IS NULL OR sachets_suggested >= 0);

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS sachet_reason VARCHAR(40);

-- Index pour le reporting "sur-distribution" (filtre les ventes ou la vendeuse
-- a donne plus de sachets que la suggestion calculee).
CREATE INDEX IF NOT EXISTS idx_sales_sachets_overshoot
  ON sales(user_id, created_at DESC)
  WHERE sachets_given IS NOT NULL
    AND sachets_suggested IS NOT NULL
    AND sachets_given > sachets_suggested;
