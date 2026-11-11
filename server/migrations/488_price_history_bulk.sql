-- Phase 6.5 — Historique des prix + mise à jour en masse.
--
-- Toute modification du prix catalogue d'un article est tracée (price_change_log) par un
-- trigger ; la mise à jour en masse (ex. +5 % sur une famille) pose le motif/lot/auteur
-- en variables de session, et chaque ligne modifiée est journalisée automatiquement.
--
-- Additif : aucune donnée existante touchée ; sans changement de prix, aucune trace.

CREATE TABLE IF NOT EXISTS price_change_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  old_price   NUMERIC(12,4),
  new_price   NUMERIC(12,4),
  pct         NUMERIC(8,3),
  reason      TEXT,
  batch_id    UUID,
  changed_by  UUID REFERENCES users(id),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_price_change_log_product ON price_change_log (product_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_change_log_batch ON price_change_log (batch_id) WHERE batch_id IS NOT NULL;

-- Trigger : journalise tout changement de products.price. Le motif/lot/auteur viennent
-- des variables de session posées par l'appelant (SET LOCAL app.price_change_*), vides
-- pour une modification ordinaire (la trace reste, sans contexte).
CREATE OR REPLACE FUNCTION fn_log_price_change() RETURNS trigger AS $$
DECLARE
  v_reason TEXT := NULLIF(current_setting('app.price_change_reason', true), '');
  v_batch  TEXT := NULLIF(current_setting('app.price_change_batch', true), '');
  v_user   TEXT := NULLIF(current_setting('app.price_change_user', true), '');
BEGIN
  IF NEW.price IS DISTINCT FROM OLD.price THEN
    INSERT INTO price_change_log (product_id, old_price, new_price, pct, reason, batch_id, changed_by)
    VALUES (NEW.id, OLD.price, NEW.price,
            CASE WHEN OLD.price IS NOT NULL AND OLD.price <> 0
                 THEN ROUND(((NEW.price - OLD.price) / OLD.price * 100)::numeric, 3) END,
            v_reason, v_batch::uuid, v_user::uuid);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_log_price_change ON products;
CREATE TRIGGER trg_log_price_change
  AFTER UPDATE OF price ON products
  FOR EACH ROW EXECUTE FUNCTION fn_log_price_change();
