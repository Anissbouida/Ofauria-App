-- M3-02 (plan d'action 2026-11) — conversions propres à l'article.
--
-- item_unit_conversions : « 1 <unité ou contenant source> = facteur <unité cible> » pour un
-- article (ingrédient, emballage, produit). Origines :
--   saisie      : saisie sur la fiche (1 carton = 12 pièces, 1 pièce = 0,35 kg…) ;
--   densite     : reprise de ingredients.densite_kg_l (1 l = densité kg, mig 227) ;
--   contenant   : reprise du contenant de l'ingrédient (1 sac = container_size × unité, mig 226) ;
--   poids_piece : reprise de ingredients.poids_piece_kg (1 pièce = x kg, mig 392).
-- Les colonnes d'origine restent la référence des calculs actuels ; un déclencheur tient
-- les lignes reprises à jour quand elles changent. Une conversion contraire incohérente
-- (A→B puis B→A dont le produit des facteurs n'est pas 1) est refusée.
--
-- INVERSION :
--   DROP TRIGGER trg_ingredient_conversions_sync ON ingredients;
--   DROP FUNCTION trg_fn_ingredient_conversions_sync(), fn_sync_ingredient_conversions(uuid), trg_fn_item_conversion_coherent();
--   DROP TABLE item_unit_conversions;
CREATE TABLE IF NOT EXISTS item_unit_conversions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_kind              varchar(12) NOT NULL CHECK (item_kind IN ('ingredient', 'packaging', 'product')),
  item_id                uuid NOT NULL,
  from_unit_id           uuid REFERENCES ref_entries(id) ON DELETE CASCADE,
  from_container_type_id uuid REFERENCES ref_entries(id) ON DELETE CASCADE,
  to_unit_id             uuid NOT NULL REFERENCES ref_entries(id) ON DELETE CASCADE,
  factor                 numeric(18,8) NOT NULL CHECK (factor > 0),
  origin                 varchar(12) NOT NULL DEFAULT 'saisie' CHECK (origin IN ('saisie', 'densite', 'contenant', 'poids_piece')),
  notes                  text,
  updated_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_iuc_one_source CHECK ((from_unit_id IS NULL) <> (from_container_type_id IS NULL)),
  CONSTRAINT chk_iuc_not_self CHECK (from_unit_id IS NULL OR from_unit_id <> to_unit_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_item_unit_conversions
  ON item_unit_conversions (item_kind, item_id, COALESCE(from_unit_id, from_container_type_id), to_unit_id);
CREATE INDEX IF NOT EXISTS idx_item_unit_conversions_item ON item_unit_conversions (item_kind, item_id);

-- Cohérence : A→B et B→A doivent se compenser (tolérance 1e-6).
CREATE OR REPLACE FUNCTION trg_fn_item_conversion_coherent()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_rev numeric;
BEGIN
  IF NEW.from_unit_id IS NULL THEN RETURN NEW; END IF;
  SELECT factor INTO v_rev FROM item_unit_conversions
   WHERE item_kind = NEW.item_kind AND item_id = NEW.item_id
     AND from_unit_id = NEW.to_unit_id AND to_unit_id = NEW.from_unit_id AND id <> NEW.id;
  IF FOUND AND abs(NEW.factor * v_rev - 1) > 0.000001 THEN
    RAISE EXCEPTION 'CONVERSION_INCOHERENTE: la conversion inverse existe avec un facteur incompatible (% × % ≠ 1)', NEW.factor, v_rev
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_item_conversion_coherent ON item_unit_conversions;
CREATE TRIGGER trg_item_conversion_coherent BEFORE INSERT OR UPDATE ON item_unit_conversions
  FOR EACH ROW EXECUTE FUNCTION trg_fn_item_conversion_coherent();

-- Reprise des colonnes d'origine d'un ingrédient (idempotente).
CREATE OR REPLACE FUNCTION fn_sync_ingredient_conversions(p_ingredient uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  g    record;
  u_l  uuid := (SELECT id FROM ref_entries WHERE table_id = 'units' AND code = 'l');
  u_kg uuid := (SELECT id FROM ref_entries WHERE table_id = 'units' AND code = 'kg');
  u_pc uuid := (SELECT id FROM ref_entries WHERE table_id = 'units' AND code = 'unit');
BEGIN
  DELETE FROM item_unit_conversions WHERE item_kind = 'ingredient' AND item_id = p_ingredient AND origin IN ('densite', 'contenant', 'poids_piece');
  SELECT id, unit_id, densite_kg_l, poids_piece_kg, container_type_id, container_size INTO g FROM ingredients WHERE id = p_ingredient;
  IF g.id IS NULL THEN RETURN; END IF;
  IF g.densite_kg_l IS NOT NULL AND u_l IS NOT NULL AND u_kg IS NOT NULL THEN
    INSERT INTO item_unit_conversions (item_kind, item_id, from_unit_id, to_unit_id, factor, origin)
    VALUES ('ingredient', g.id, u_l, u_kg, g.densite_kg_l, 'densite');
  END IF;
  IF g.poids_piece_kg IS NOT NULL AND u_pc IS NOT NULL AND u_kg IS NOT NULL THEN
    INSERT INTO item_unit_conversions (item_kind, item_id, from_unit_id, to_unit_id, factor, origin)
    VALUES ('ingredient', g.id, u_pc, u_kg, g.poids_piece_kg, 'poids_piece');
  END IF;
  IF g.container_type_id IS NOT NULL AND COALESCE(g.container_size, 0) > 0 AND g.unit_id IS NOT NULL THEN
    INSERT INTO item_unit_conversions (item_kind, item_id, from_container_type_id, to_unit_id, factor, origin)
    VALUES ('ingredient', g.id, g.container_type_id, g.unit_id, g.container_size, 'contenant');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION trg_fn_ingredient_conversions_sync()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_sync_ingredient_conversions(NEW.id);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_ingredient_conversions_sync ON ingredients;
CREATE TRIGGER trg_ingredient_conversions_sync
  AFTER INSERT OR UPDATE OF densite_kg_l, poids_piece_kg, container_type_id, container_size, unit, unit_id ON ingredients
  FOR EACH ROW EXECUTE FUNCTION trg_fn_ingredient_conversions_sync();

-- Rattrapage.
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT id FROM ingredients WHERE densite_kg_l IS NOT NULL OR poids_piece_kg IS NOT NULL OR container_type_id IS NOT NULL LOOP
    PERFORM fn_sync_ingredient_conversions(r.id);
  END LOOP;
END $$;
