-- M3-04 (plan d'action 2026-11) — quantité + unité à côté des colonnes _g / _kg.
--
-- Les colonnes de poids portent leur unité dans leur nom. Pour chacune, on ajoute
-- <nom>_qty (numérique) et <nom>_unit_id (unité du référentiel, M3-01). Rattrapage :
-- quantité = ancienne colonne, unité = celle du nom. Double écriture par déclencheur
-- (trg_fn_qty_unit_sync, générique) :
--   l'ancienne colonne change  → quantité = ancienne valeur, unité = celle du nom ;
--   la quantité ou l'unité change → ancienne colonne = quantité convertie dans l'unité
--                                   du nom (fn_convert_qty, M3-03) ; une conversion
--                                   impossible est refusée.
-- Les anciennes colonnes restent lues par les vues et rapports (commentaire « obsolète »).
--
-- INVERSION : DROP TRIGGER trg_qty_unit_sync_<colonne> ON <table>; DROP FUNCTION trg_fn_qty_unit_sync();
--   ALTER TABLE <table> DROP COLUMN <nom>_qty, DROP COLUMN <nom>_unit_id;

-- TG_ARGV : ancienne colonne, colonne quantité, colonne unité, code de l'unité du nom.
CREATE OR REPLACE FUNCTION trg_fn_qty_unit_sync()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  n jsonb := to_jsonb(NEW);
  o jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  legacy_col text := TG_ARGV[0]; qty_col text := TG_ARGV[1]; unit_col text := TG_ARGV[2]; base_code text := TG_ARGV[3];
  base_id uuid := (SELECT id FROM ref_entries WHERE table_id = 'units' AND code = base_code);
  legacy_changed boolean := (n -> legacy_col) IS DISTINCT FROM (o -> legacy_col);
  new_changed boolean := (n -> qty_col) IS DISTINCT FROM (o -> qty_col) OR (n -> unit_col) IS DISTINCT FROM (o -> unit_col);
  unit_code text; conv numeric;
BEGIN
  IF new_changed AND (TG_OP = 'UPDATE' OR n ->> qty_col IS NOT NULL) THEN
    IF n ->> qty_col IS NULL THEN
      NEW := jsonb_populate_record(NEW, jsonb_build_object(legacy_col, NULL));
    ELSE
      SELECT code INTO unit_code FROM ref_entries WHERE id = COALESCE((n ->> unit_col)::uuid, base_id);
      conv := fn_convert_qty((n ->> qty_col)::numeric, unit_code, base_code);
      IF conv IS NULL THEN
        RAISE EXCEPTION 'Unité % non convertible en %', unit_code, base_code USING ERRCODE = 'check_violation';
      END IF;
      NEW := jsonb_populate_record(NEW, jsonb_build_object(legacy_col, conv, unit_col, COALESCE((n ->> unit_col)::uuid, base_id)));
    END IF;
  ELSIF legacy_changed THEN
    NEW := jsonb_populate_record(NEW, jsonb_build_object(qty_col, n -> legacy_col, unit_col, CASE WHEN n ->> legacy_col IS NULL THEN NULL ELSE base_id END));
  END IF;
  RETURN NEW;
END $$;


ALTER TABLE recipe_formats ADD COLUMN IF NOT EXISTS poids_cru_qty numeric(14,4), ADD COLUMN IF NOT EXISTS poids_cru_unit_id uuid REFERENCES ref_entries(id) ON DELETE SET NULL;
UPDATE recipe_formats SET poids_cru_qty = poids_cru_g, poids_cru_unit_id = (SELECT id FROM ref_entries WHERE table_id = 'units' AND code = 'g')
 WHERE poids_cru_g IS NOT NULL AND poids_cru_qty IS NULL;
COMMENT ON COLUMN recipe_formats.poids_cru_g IS 'Obsolète (M3-04) : lire poids_cru_qty + poids_cru_unit_id. Tenue à jour par trg_qty_unit_sync_poids_cru_g.';
DROP TRIGGER IF EXISTS trg_qty_unit_sync_poids_cru_g ON recipe_formats;
CREATE TRIGGER trg_qty_unit_sync_poids_cru_g BEFORE INSERT OR UPDATE OF poids_cru_g, poids_cru_qty, poids_cru_unit_id ON recipe_formats
  FOR EACH ROW EXECUTE FUNCTION trg_fn_qty_unit_sync('poids_cru_g', 'poids_cru_qty', 'poids_cru_unit_id', 'g');

ALTER TABLE recipe_formats ADD COLUMN IF NOT EXISTS poids_cuit_qty numeric(14,4), ADD COLUMN IF NOT EXISTS poids_cuit_unit_id uuid REFERENCES ref_entries(id) ON DELETE SET NULL;
UPDATE recipe_formats SET poids_cuit_qty = poids_cuit_g, poids_cuit_unit_id = (SELECT id FROM ref_entries WHERE table_id = 'units' AND code = 'g')
 WHERE poids_cuit_g IS NOT NULL AND poids_cuit_qty IS NULL;
COMMENT ON COLUMN recipe_formats.poids_cuit_g IS 'Obsolète (M3-04) : lire poids_cuit_qty + poids_cuit_unit_id. Tenue à jour par trg_qty_unit_sync_poids_cuit_g.';
DROP TRIGGER IF EXISTS trg_qty_unit_sync_poids_cuit_g ON recipe_formats;
CREATE TRIGGER trg_qty_unit_sync_poids_cuit_g BEFORE INSERT OR UPDATE OF poids_cuit_g, poids_cuit_qty, poids_cuit_unit_id ON recipe_formats
  FOR EACH ROW EXECUTE FUNCTION trg_fn_qty_unit_sync('poids_cuit_g', 'poids_cuit_qty', 'poids_cuit_unit_id', 'g');

ALTER TABLE recipes ADD COLUMN IF NOT EXISTS piece_weight_qty numeric(14,4), ADD COLUMN IF NOT EXISTS piece_weight_unit_id uuid REFERENCES ref_entries(id) ON DELETE SET NULL;
UPDATE recipes SET piece_weight_qty = piece_weight_kg, piece_weight_unit_id = (SELECT id FROM ref_entries WHERE table_id = 'units' AND code = 'kg')
 WHERE piece_weight_kg IS NOT NULL AND piece_weight_qty IS NULL;
COMMENT ON COLUMN recipes.piece_weight_kg IS 'Obsolète (M3-04) : lire piece_weight_qty + piece_weight_unit_id. Tenue à jour par trg_qty_unit_sync_piece_weight_kg.';
DROP TRIGGER IF EXISTS trg_qty_unit_sync_piece_weight_kg ON recipes;
CREATE TRIGGER trg_qty_unit_sync_piece_weight_kg BEFORE INSERT OR UPDATE OF piece_weight_kg, piece_weight_qty, piece_weight_unit_id ON recipes
  FOR EACH ROW EXECUTE FUNCTION trg_fn_qty_unit_sync('piece_weight_kg', 'piece_weight_qty', 'piece_weight_unit_id', 'kg');

ALTER TABLE recipe_versions ADD COLUMN IF NOT EXISTS piece_weight_qty numeric(14,4), ADD COLUMN IF NOT EXISTS piece_weight_unit_id uuid REFERENCES ref_entries(id) ON DELETE SET NULL;
UPDATE recipe_versions SET piece_weight_qty = piece_weight_kg, piece_weight_unit_id = (SELECT id FROM ref_entries WHERE table_id = 'units' AND code = 'kg')
 WHERE piece_weight_kg IS NOT NULL AND piece_weight_qty IS NULL;
COMMENT ON COLUMN recipe_versions.piece_weight_kg IS 'Obsolète (M3-04) : lire piece_weight_qty + piece_weight_unit_id. Tenue à jour par trg_qty_unit_sync_piece_weight_kg.';
DROP TRIGGER IF EXISTS trg_qty_unit_sync_piece_weight_kg ON recipe_versions;
CREATE TRIGGER trg_qty_unit_sync_piece_weight_kg BEFORE INSERT OR UPDATE OF piece_weight_kg, piece_weight_qty, piece_weight_unit_id ON recipe_versions
  FOR EACH ROW EXECUTE FUNCTION trg_fn_qty_unit_sync('piece_weight_kg', 'piece_weight_qty', 'piece_weight_unit_id', 'kg');

ALTER TABLE production_contenants ADD COLUMN IF NOT EXISTS poids_qty numeric(14,4), ADD COLUMN IF NOT EXISTS poids_unit_id uuid REFERENCES ref_entries(id) ON DELETE SET NULL;
UPDATE production_contenants SET poids_qty = poids_kg, poids_unit_id = (SELECT id FROM ref_entries WHERE table_id = 'units' AND code = 'kg')
 WHERE poids_kg IS NOT NULL AND poids_qty IS NULL;
COMMENT ON COLUMN production_contenants.poids_kg IS 'Obsolète (M3-04) : lire poids_qty + poids_unit_id. Tenue à jour par trg_qty_unit_sync_poids_kg.';
DROP TRIGGER IF EXISTS trg_qty_unit_sync_poids_kg ON production_contenants;
CREATE TRIGGER trg_qty_unit_sync_poids_kg BEFORE INSERT OR UPDATE OF poids_kg, poids_qty, poids_unit_id ON production_contenants
  FOR EACH ROW EXECUTE FUNCTION trg_fn_qty_unit_sync('poids_kg', 'poids_qty', 'poids_unit_id', 'kg');

ALTER TABLE production_rendement ADD COLUMN IF NOT EXISTS masse_cuite_qty numeric(14,4), ADD COLUMN IF NOT EXISTS masse_cuite_unit_id uuid REFERENCES ref_entries(id) ON DELETE SET NULL;
UPDATE production_rendement SET masse_cuite_qty = masse_cuite_kg, masse_cuite_unit_id = (SELECT id FROM ref_entries WHERE table_id = 'units' AND code = 'kg')
 WHERE masse_cuite_kg IS NOT NULL AND masse_cuite_qty IS NULL;
COMMENT ON COLUMN production_rendement.masse_cuite_kg IS 'Obsolète (M3-04) : lire masse_cuite_qty + masse_cuite_unit_id. Tenue à jour par trg_qty_unit_sync_masse_cuite_kg.';
DROP TRIGGER IF EXISTS trg_qty_unit_sync_masse_cuite_kg ON production_rendement;
CREATE TRIGGER trg_qty_unit_sync_masse_cuite_kg BEFORE INSERT OR UPDATE OF masse_cuite_kg, masse_cuite_qty, masse_cuite_unit_id ON production_rendement
  FOR EACH ROW EXECUTE FUNCTION trg_fn_qty_unit_sync('masse_cuite_kg', 'masse_cuite_qty', 'masse_cuite_unit_id', 'kg');

ALTER TABLE production_rendement ADD COLUMN IF NOT EXISTS masse_petrie_qty numeric(14,4), ADD COLUMN IF NOT EXISTS masse_petrie_unit_id uuid REFERENCES ref_entries(id) ON DELETE SET NULL;
UPDATE production_rendement SET masse_petrie_qty = masse_petrie_kg, masse_petrie_unit_id = (SELECT id FROM ref_entries WHERE table_id = 'units' AND code = 'kg')
 WHERE masse_petrie_kg IS NOT NULL AND masse_petrie_qty IS NULL;
COMMENT ON COLUMN production_rendement.masse_petrie_kg IS 'Obsolète (M3-04) : lire masse_petrie_qty + masse_petrie_unit_id. Tenue à jour par trg_qty_unit_sync_masse_petrie_kg.';
DROP TRIGGER IF EXISTS trg_qty_unit_sync_masse_petrie_kg ON production_rendement;
CREATE TRIGGER trg_qty_unit_sync_masse_petrie_kg BEFORE INSERT OR UPDATE OF masse_petrie_kg, masse_petrie_qty, masse_petrie_unit_id ON production_rendement
  FOR EACH ROW EXECUTE FUNCTION trg_fn_qty_unit_sync('masse_petrie_kg', 'masse_petrie_qty', 'masse_petrie_unit_id', 'kg');

ALTER TABLE production_rendement ADD COLUMN IF NOT EXISTS patons_poids_unitaire_qty numeric(14,4), ADD COLUMN IF NOT EXISTS patons_poids_unitaire_unit_id uuid REFERENCES ref_entries(id) ON DELETE SET NULL;
UPDATE production_rendement SET patons_poids_unitaire_qty = patons_poids_unitaire_g, patons_poids_unitaire_unit_id = (SELECT id FROM ref_entries WHERE table_id = 'units' AND code = 'g')
 WHERE patons_poids_unitaire_g IS NOT NULL AND patons_poids_unitaire_qty IS NULL;
COMMENT ON COLUMN production_rendement.patons_poids_unitaire_g IS 'Obsolète (M3-04) : lire patons_poids_unitaire_qty + patons_poids_unitaire_unit_id. Tenue à jour par trg_qty_unit_sync_patons_poids_unitaire_g.';
DROP TRIGGER IF EXISTS trg_qty_unit_sync_patons_poids_unitaire_g ON production_rendement;
CREATE TRIGGER trg_qty_unit_sync_patons_poids_unitaire_g BEFORE INSERT OR UPDATE OF patons_poids_unitaire_g, patons_poids_unitaire_qty, patons_poids_unitaire_unit_id ON production_rendement
  FOR EACH ROW EXECUTE FUNCTION trg_fn_qty_unit_sync('patons_poids_unitaire_g', 'patons_poids_unitaire_qty', 'patons_poids_unitaire_unit_id', 'g');
