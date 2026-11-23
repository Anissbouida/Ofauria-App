-- 644 — Magasin générique, tâche 5 : réservation de matière par ordre (plan d'exécution
-- multi-industries, étape 8 ; capacité « reservation_matiere » de l'étape 1).
--
-- POURQUOI
--   Deux ordres confirmés comptaient sur le même stock : le second découvrait la rupture au bon
--   de sortie. En mécanique ou en assemblage, la matière doit être réservée dès la confirmation.
--
-- CE QUI CHANGE (seulement quand la capacité est active ; éteinte par défaut, Ofauria inchangé)
--   - material_reservations : à la confirmation, chaque besoin de l'ordre réserve ce qui est
--     libre dans l'établissement (stock des lots utilisables moins les réservations des autres
--     ordres). La part non couverte est notée (shortage) et signalée.
--   - v_material_free_stock : stock libre par matière et établissement.
--   - Résolution automatique (déclencheur sur l'ordre) : démarrage → « consommée » (la matière
--     sort par le bon de sortie) ; retour en brouillon ou annulation → « libérée ».
--
-- RETOUR ARRIÈRE
--   DROP TRIGGER trg_resolve_material_reservations ON production_plans ;
--   DROP FUNCTION fn_resolve_material_reservations() ; DROP VIEW v_material_free_stock ;
--   DROP TABLE material_reservations.

CREATE TABLE IF NOT EXISTS material_reservations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id       UUID NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  store_id      UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  quantity      NUMERIC(14,4) NOT NULL CHECK (quantity >= 0),
  shortage      NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (shortage >= 0),
  status        VARCHAR(12) NOT NULL DEFAULT 'reservee' CHECK (status IN ('reservee', 'consommee', 'liberee')),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_material_reservations_plan ON material_reservations (plan_id);
CREATE INDEX IF NOT EXISTS idx_material_reservations_active ON material_reservations (ingredient_id, store_id) WHERE status = 'reservee';

CREATE OR REPLACE VIEW v_material_free_stock AS
SELECT s.ingredient_id, s.store_id, s.stock,
       COALESCE(r.reserved, 0) AS reserved,
       GREATEST(s.stock - COALESCE(r.reserved, 0), 0) AS free
  FROM (SELECT il.ingredient_id, il.store_id,
               sum(CASE WHEN il.status IN ('active', 'expired') THEN il.pesage_quantity ELSE 0 END
                   + CASE WHEN il.status = 'active' THEN il.economat_quantity ELSE 0 END) AS stock
          FROM ingredient_lots il WHERE il.store_id IS NOT NULL GROUP BY il.ingredient_id, il.store_id) s
  LEFT JOIN (SELECT ingredient_id, store_id, sum(quantity) AS reserved
               FROM material_reservations WHERE status = 'reservee' GROUP BY ingredient_id, store_id) r
    ON r.ingredient_id = s.ingredient_id AND r.store_id = s.store_id;
COMMENT ON VIEW v_material_free_stock IS 'Étape 8 (mig 644) : stock des lots utilisables moins les réservations actives des ordres.';

CREATE OR REPLACE FUNCTION fn_resolve_material_reservations() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status IN ('in_progress', 'completed') THEN
    UPDATE material_reservations SET status = 'consommee', resolved_at = now() WHERE plan_id = NEW.id AND status = 'reservee';
  ELSIF NEW.status IN ('draft', 'cancelled') THEN
    UPDATE material_reservations SET status = 'liberee', resolved_at = now() WHERE plan_id = NEW.id AND status = 'reservee';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_resolve_material_reservations ON production_plans;
CREATE TRIGGER trg_resolve_material_reservations AFTER UPDATE OF status ON production_plans
  FOR EACH ROW EXECUTE FUNCTION fn_resolve_material_reservations();

UPDATE app_features
   SET description = 'Les matières d''un ordre confirmé sont réservées : un autre ordre ne peut plus compter dessus. La part non couverte est signalée à la confirmation.'
 WHERE key = 'reservation_matiere';
