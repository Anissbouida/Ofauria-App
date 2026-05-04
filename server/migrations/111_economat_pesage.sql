-- Phase Économat / Pesage : split du stock en 2 états
--   - Économat : stock scellé (sacs/boîtes intacts)
--   - Pesage   : stock ouvert / en cours d'utilisation
-- L'ouverture transfère qty depuis economat_quantity vers pesage_quantity.
-- Une DLC effective post-ouverture est calculée : MIN(DLC originale, ouverture + shelf_life_after_opening).

-- ─── Ingredients : container size + DLC post-ouverture ─────────────────────
ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS container_size numeric(10,3),                      -- 25 kg/sac, 2 kg/brique...
  ADD COLUMN IF NOT EXISTS shelf_life_after_opening_days int;                  -- 7j œufs, 30j beurre...

COMMENT ON COLUMN ingredients.container_size IS 'Taille standard d''un contenant (sac, boite, brique) en unite base';
COMMENT ON COLUMN ingredients.shelf_life_after_opening_days IS 'DLC raccourcie une fois le contenant ouvert (en jours)';

-- ─── Ingredient_lots : split economat / pesage + tracking ouverture ───────
ALTER TABLE ingredient_lots
  ADD COLUMN IF NOT EXISTS economat_quantity numeric(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pesage_quantity numeric(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS opening_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS effective_expiry_after_opening date;

COMMENT ON COLUMN ingredient_lots.economat_quantity IS 'Qty scellee (sacs intacts), reserve principale';
COMMENT ON COLUMN ingredient_lots.pesage_quantity IS 'Qty ouverte / en cours d''utilisation';
COMMENT ON COLUMN ingredient_lots.first_opened_at IS 'Date premiere ouverture, base pour DLC post-ouverture';
COMMENT ON COLUMN ingredient_lots.opening_history IS 'Historique des ouvertures: [{qty, opened_at, opened_by, container_count}]';
COMMENT ON COLUMN ingredient_lots.effective_expiry_after_opening IS 'DLC effective post-ouverture = MIN(expiration_date, first_opened_at + shelf_life_after_opening_days)';

-- Indexes pour FEFO Pesage (queue principale) et Économat (suggestions ouverture)
CREATE INDEX IF NOT EXISTS idx_lots_pesage_active
  ON ingredient_lots (ingredient_id, store_id, expiration_date NULLS LAST)
  WHERE status='active' AND pesage_quantity > 0;

CREATE INDEX IF NOT EXISTS idx_lots_economat_active
  ON ingredient_lots (ingredient_id, store_id, expiration_date NULLS LAST)
  WHERE status='active' AND economat_quantity > 0;

-- ─── Vue agrégée remplaçant la table inventory ──────────────────────────
-- Sert pour les dashboards/UI qui ont besoin du total par ingredient/store
-- sans descendre au niveau lot.
CREATE OR REPLACE VIEW v_ingredient_stock AS
SELECT
  i.id as ingredient_id,
  l.store_id,
  COALESCE(SUM(l.economat_quantity), 0) as economat_total,
  COALESCE(SUM(l.pesage_quantity), 0) as pesage_total,
  COALESCE(SUM(l.economat_quantity + l.pesage_quantity), 0) as total_stock,
  COUNT(*) FILTER (WHERE l.economat_quantity > 0) as economat_lots_count,
  COUNT(*) FILTER (WHERE l.pesage_quantity > 0) as pesage_lots_count,
  MIN(l.expiration_date) FILTER (WHERE l.economat_quantity > 0) as economat_nearest_dlc,
  MIN(COALESCE(l.effective_expiry_after_opening::timestamptz, l.expiration_date::timestamptz)) FILTER (WHERE l.pesage_quantity > 0) as pesage_nearest_dlc
FROM ingredients i
LEFT JOIN ingredient_lots l ON l.ingredient_id=i.id AND l.status='active'
GROUP BY i.id, l.store_id;

-- ─── Init data : tout le stock existant migrre dans Économat (option B-4) ─
-- Strategie : economat_quantity = quantity_remaining, pesage_quantity = 0.
-- Les ouvertures se feront progressivement selon les besoins.
-- Note : si certains lots etaient deja "en cours", la magasiniere pourra les
-- forcer en Pesage via l'action "Ouvrir un sac" dans l'UI.
UPDATE ingredient_lots
   SET economat_quantity = quantity_remaining,
       pesage_quantity = 0
 WHERE status = 'active'
   AND economat_quantity = 0
   AND pesage_quantity = 0;

-- Trigger pour maintenir la cohérence : quantity_remaining = economat_quantity + pesage_quantity
-- (pour rétrocompat avec le code legacy qui lit quantity_remaining)
CREATE OR REPLACE FUNCTION sync_quantity_remaining()
RETURNS TRIGGER AS $$
BEGIN
  NEW.quantity_remaining := COALESCE(NEW.economat_quantity, 0) + COALESCE(NEW.pesage_quantity, 0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_quantity_remaining ON ingredient_lots;
CREATE TRIGGER trg_sync_quantity_remaining
  BEFORE INSERT OR UPDATE OF economat_quantity, pesage_quantity ON ingredient_lots
  FOR EACH ROW EXECUTE FUNCTION sync_quantity_remaining();

-- ─── Backfill container_size depuis le nom (heuristique) ────────────────
-- Extrait les nombres+unités depuis le nom de l'ingrédient.
-- Exemples : "Sucre semoule 2kg" -> 2kg, "Œufs liquides 2L" -> 2L, "Beurre 250g" -> 0.25kg
UPDATE ingredients SET container_size = (
  CASE
    WHEN name ~* '(\d+(?:[.,]\d+)?)\s*kg\b' THEN
      CAST(regexp_replace(substring(name from '(\d+(?:[.,]\d+)?)\s*kg\b'), ',', '.') AS numeric)
    WHEN name ~* '(\d+(?:[.,]\d+)?)\s*g\b' AND unit = 'kg' THEN
      CAST(regexp_replace(substring(name from '(\d+(?:[.,]\d+)?)\s*g\b'), ',', '.') AS numeric) / 1000
    WHEN name ~* '(\d+(?:[.,]\d+)?)\s*[lL]\b' THEN
      CAST(regexp_replace(substring(name from '(\d+(?:[.,]\d+)?)\s*[lL]\b'), ',', '.') AS numeric)
    WHEN name ~* '(\d+(?:[.,]\d+)?)\s*ml\b' AND unit IN ('l','L') THEN
      CAST(regexp_replace(substring(name from '(\d+(?:[.,]\d+)?)\s*ml\b'), ',', '.') AS numeric) / 1000
    ELSE NULL
  END
)
WHERE container_size IS NULL;
