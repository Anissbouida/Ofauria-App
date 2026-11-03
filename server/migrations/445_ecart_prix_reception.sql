-- Écart de prix à la réception (analyse d'écart P2P, lot L3 — incrément 2/5).
-- docs/AUDIT_P2P_GAP_ANALYSIS.md
--
-- Aujourd'hui le prix saisi à la réception entre librement dans le lot et le CMUP,
-- même s'il diffère du prix du bon de commande. Cet incrément DÉTECTE l'écart
-- (au-delà de la tolérance match_tolerances) et le marque pour décision d'un
-- responsable (approuvé / rejeté). Il ne change pas encore le CMUP : l'exclusion
-- du stock d'une ligne en écart et la réévaluation sont l'incrément 3/5 (celui
-- qui déplace des montants, avec dry-run). Ici, pure détection + traçabilité.

ALTER TABLE reception_voucher_items
  ADD COLUMN IF NOT EXISTS price_status VARCHAR(12) NOT NULL DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS price_decided_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS price_decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS price_decision_note TEXT;

ALTER TABLE reception_voucher_items DROP CONSTRAINT IF EXISTS reception_voucher_items_price_status_check;
ALTER TABLE reception_voucher_items ADD CONSTRAINT reception_voucher_items_price_status_check
  CHECK (price_status IN ('ok', 'variance', 'approved', 'rejected'));

COMMENT ON COLUMN reception_voucher_items.price_status IS
  'Écart prix reçu / prix BC (mig 445, lot L3 P2P) : ok = dans la tolérance ; variance = écart à décider ; approved/rejected = décision d''un responsable. N''affecte pas encore le CMUP (incrément 3/5).';

-- Détection à la réception : prix reçu hors tolérance (match_tolerances global :
-- écart absolu OU pourcentage du prix BC). On ne touche pas une ligne dont la
-- décision est déjà posée. Historique inchangé (seules les nouvelles lignes).
CREATE OR REPLACE FUNCTION fn_rvi_price_check() RETURNS trigger AS $$
DECLARE v_abs numeric; v_pct numeric;
BEGIN
  IF NEW.price_status IS DISTINCT FROM 'ok' THEN RETURN NEW; END IF;
  IF NEW.po_unit_price IS NOT NULL AND NEW.unit_price IS NOT NULL AND NEW.po_unit_price > 0 THEN
    SELECT COALESCE(price_abs, 0), COALESCE(price_pct, 0) INTO v_abs, v_pct
      FROM match_tolerances WHERE scope_type = 'global' AND scope_id IS NULL LIMIT 1;
    IF abs(NEW.unit_price - NEW.po_unit_price) > GREATEST(COALESCE(v_abs, 0), NEW.po_unit_price * COALESCE(v_pct, 0) / 100) THEN
      NEW.price_status := 'variance';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_rvi_price_check ON reception_voucher_items;
CREATE TRIGGER trg_rvi_price_check BEFORE INSERT ON reception_voucher_items
  FOR EACH ROW EXECUTE FUNCTION fn_rvi_price_check();

CREATE INDEX IF NOT EXISTS ix_rvi_price_status ON reception_voucher_items(price_status) WHERE price_status = 'variance';
