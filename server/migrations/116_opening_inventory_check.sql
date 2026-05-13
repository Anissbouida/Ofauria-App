-- Migration 116: Contrôle d'inventaire d'ouverture J+1
-- Objectif: vérifier au matin que les invendus réexposés de la veille
-- sont physiquement présents en vitrine. Double validation obligatoire si écart.
-- Bloque l'ouverture de la caisse tant que non validé.

BEGIN;

-- ─── 1. Discriminateur opening / closing + workflow validation ───
ALTER TABLE daily_inventory_checks
  ADD COLUMN IF NOT EXISTS check_type VARCHAR(20) NOT NULL DEFAULT 'closing'
    CHECK (check_type IN ('closing', 'opening')),
  ADD COLUMN IF NOT EXISTS previous_check_id UUID REFERENCES daily_inventory_checks(id),
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'awaiting_validation', 'validated', 'rejected')),
  ADD COLUMN IF NOT EXISTS validated_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Tous les anciens checks sont des closing déjà validés
UPDATE daily_inventory_checks SET status = 'validated' WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_daily_inventory_checks_type_status
  ON daily_inventory_checks (check_type, status, created_at DESC);

-- ─── 2. Données d'écart (attendu vs trouvé) sur lignes ───
ALTER TABLE daily_inventory_check_items
  ADD COLUMN IF NOT EXISTS expected_qty INTEGER,
  ADD COLUMN IF NOT EXISTS found_qty INTEGER,
  ADD COLUMN IF NOT EXISTS missing_reason VARCHAR(50)
    CHECK (missing_reason IN (
      'theft', 'breakage', 'forgotten_recycle', 'undeclared_loss',
      'measurement_error', 'other'
    ) OR missing_reason IS NULL);

-- ─── 3. Yield ratio sur destinations de recyclage ───
-- Ex: baguette → chapelure = 0.7 (perte au séchage), croissant → croissant rassis = 1.0
ALTER TABLE product_recycle_destinations
  ADD COLUMN IF NOT EXISTS yield_ratio NUMERIC(5, 4) NOT NULL DEFAULT 1.0
    CHECK (yield_ratio > 0 AND yield_ratio <= 2);

COMMENT ON COLUMN product_recycle_destinations.yield_ratio IS
  'Ratio de conversion produit -> ingrédient (1.0 = 100%, 0.7 = perte 30%).';

-- ─── 4. Garde-fou: empêcher l'ouverture d'une session caisse
--      tant qu'un check opening n'est pas validé pour la veille ───
-- On crée une fonction qui sera appelée par un trigger BEFORE INSERT
-- sur cash_register_sessions.

CREATE OR REPLACE FUNCTION check_opening_inventory_required()
RETURNS TRIGGER AS $$
DECLARE
  yesterday_remaining INTEGER;
  validated_opening_count INTEGER;
BEGIN
  -- Compter les produits invendus réexposés de la session précédente
  -- (même store, dernière session fermée)
  SELECT COALESCE(SUM(dici.remaining_qty), 0)
  INTO yesterday_remaining
  FROM daily_inventory_checks dic
  JOIN daily_inventory_check_items dici ON dici.check_id = dic.id
  WHERE dic.store_id = NEW.store_id
    AND dic.check_type = 'closing'
    AND dici.destination = 'reexpose'
    AND dici.remaining_qty > 0
    AND dic.created_at = (
      SELECT MAX(dic2.created_at)
      FROM daily_inventory_checks dic2
      WHERE dic2.store_id = NEW.store_id
        AND dic2.check_type = 'closing'
    );

  -- Si rien à recontrôler, on laisse passer
  IF yesterday_remaining = 0 THEN
    RETURN NEW;
  END IF;

  -- Sinon, exiger un check opening validé après la dernière clôture
  SELECT COUNT(*)
  INTO validated_opening_count
  FROM daily_inventory_checks dic
  WHERE dic.store_id = NEW.store_id
    AND dic.check_type = 'opening'
    AND dic.status = 'validated'
    AND dic.created_at > (
      SELECT MAX(dic2.created_at)
      FROM daily_inventory_checks dic2
      WHERE dic2.store_id = NEW.store_id
        AND dic2.check_type = 'closing'
    );

  IF validated_opening_count = 0 THEN
    RAISE EXCEPTION 'opening_inventory_check_required: % invendus réexposés en attente de contrôle d''ouverture pour le store %',
      yesterday_remaining, NEW.store_id
      USING ERRCODE = 'P0001',
            HINT = 'Effectuer le contrôle d''inventaire d''ouverture avant d''ouvrir la caisse.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_opening_inventory ON cash_register_sessions;
CREATE TRIGGER trg_check_opening_inventory
  BEFORE INSERT ON cash_register_sessions
  FOR EACH ROW
  WHEN (NEW.store_id IS NOT NULL)
  EXECUTE FUNCTION check_opening_inventory_required();

COMMIT;
