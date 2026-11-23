-- 634 — Fiche technique générique (plan d'exécution multi-industries, étape 2 bis).
--
-- POURQUOI
--   La fiche portait des verrous propres à la boulangerie (rapport d'analyse, § 4 bis) :
--   V1 contenant de cuisson figé (types 1 à 5, unités de lancement en dur), V2 emballage
--   compté comme un coût et jamais sorti du stock, V4 rendement et quantité de format
--   limités par des CHECK, V3 durée de vie plafonnée à 365 jours sans DLC / DDM sur
--   l'article, V5 aucune valeur nutritionnelle, V6 mode de vente figé.
--
-- CE QUI CHANGE (tout est additif ; les fiches existantes ne changent pas)
--   2b-2  Référentiels « types de production » et « unités de lancement » (ref_entries) ;
--         le CHECK 1..5 sur production_contenants.type_production devient une validation
--         sur le référentiel. Le format sans contenant existait déjà (mig 267).
--   2b-3  recipe_format_components.source_packaging_id : une ligne de nomenclature peut être
--         un EMBALLAGE (quantité par unité produite), sorti du stock à la déclaration.
--         Rôle de ligne (matiere, semi_fini, emballage) posé automatiquement et contrôlé.
--         Le coût d'emballage du format est RECALCULÉ depuis ces lignes quand il y en a :
--         les vues de coût, qui lisent cout_emballage_unitaire, n'ont pas à changer.
--   2b-4  recipes.reference_mode (fournee | lot | pourcentage) + taille et unité du lot ;
--         recipe_components.pct : en mode pourcentage la quantité est dérivée du pourcentage
--         à l'enregistrement, donc les besoins sont calculés comme avant.
--         Unités du format (quantité, rendement) contrôlées par le référentiel des unités.
--   2b-5  products.date_kind (dlc | ddm), recopiée sur le lot produit ; durée de vie jusqu'à
--         3 650 jours ; sale_type et sale_unit contrôlés par un référentiel.
--   2b-6  ingredients.nutrition (valeurs pour 100 g) ; products.prepackaged : la déclaration
--         nutritionnelle n'est exigée que pour un article préemballé.

-- ── 2b-2 Référentiels du contenant ────────────────────────────────────────────────
INSERT INTO ref_tables (id, label, description, icon, source, editable, display_order) VALUES
  ('production_types', 'Types de production',
   'Façon de produire un contenant ou un format (moule, entremets, pièces, pétrissage…).', 'Factory', 'ref_entries', true, 0),
  ('production_launch_units', 'Unités de lancement',
   'Unité dans laquelle on lance une fabrication (cadre, moule, fournée, lot, kg…). « poids » : calcul au poids.', 'Ruler', 'ref_entries', true, 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ref_entries (table_id, code, label, display_order, metadata) VALUES
  ('production_types', '1', 'Moule / Découpe', 10, '{}'),
  ('production_types', '2', 'Entremets monté', 20, '{}'),
  ('production_types', '3', 'Pièces individuelles', 30, '{}'),
  ('production_types', '4', 'Pétrissage / Cuisson', 40, '{}'),
  ('production_types', '5', 'Laminage / Cuisson', 50, '{}'),
  ('production_types', '6', 'Lot de fabrication', 60, '{}'),
  ('production_launch_units', 'cadre', 'Cadre', 10, '{"mode":"pieces"}'),
  ('production_launch_units', 'moule', 'Moule', 20, '{"mode":"pieces"}'),
  ('production_launch_units', 'cercle', 'Cercle', 30, '{"mode":"pieces"}'),
  ('production_launch_units', 'fournee', 'Fournée', 40, '{"mode":"pieces"}'),
  ('production_launch_units', 'kg_pate', 'Kg de pâte', 50, '{"mode":"poids"}'),
  ('production_launch_units', 'lot', 'Lot', 60, '{"mode":"pieces"}'),
  ('production_launch_units', 'kg', 'Kilogramme', 70, '{"mode":"poids"}')
ON CONFLICT (table_id, code) DO NOTHING;

ALTER TABLE production_contenants DROP CONSTRAINT IF EXISTS production_contenants_type_production_check;

CREATE OR REPLACE FUNCTION fn_check_contenant_type() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type_production IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM ref_entries WHERE table_id = 'production_types' AND code = NEW.type_production::text) THEN
    RAISE EXCEPTION 'Type de production inconnu : %', NEW.type_production USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_check_contenant_type ON production_contenants;
CREATE TRIGGER trg_check_contenant_type BEFORE INSERT OR UPDATE OF type_production ON production_contenants
  FOR EACH ROW EXECUTE FUNCTION fn_check_contenant_type();

-- ── 2b-3 Emballage en composant ───────────────────────────────────────────────────
ALTER TABLE recipe_format_components
  ADD COLUMN IF NOT EXISTS source_packaging_id UUID REFERENCES packaging_items(id) ON DELETE RESTRICT;

ALTER TABLE recipe_format_components DROP CONSTRAINT IF EXISTS chk_rfc_one_source;
ALTER TABLE recipe_format_components ADD CONSTRAINT chk_rfc_one_source CHECK (
  ((source_recipe_id IS NOT NULL)::int + (source_ingredient_id IS NOT NULL)::int + (source_packaging_id IS NOT NULL)::int) = 1);

-- Rôle de ligne : déduit de la source quand il n'est pas fourni, puis contrôlé.
UPDATE recipe_format_components SET role = CASE WHEN source_recipe_id IS NOT NULL THEN 'semi_fini' ELSE 'matiere' END
 WHERE role IS NULL OR role = '';
UPDATE recipe_components SET role = CASE WHEN source_recipe_id IS NOT NULL THEN 'semi_fini' ELSE 'matiere' END
 WHERE role IS NULL OR role = '';

CREATE OR REPLACE FUNCTION fn_component_role() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected TEXT;
BEGIN
  expected := CASE
    WHEN TG_TABLE_NAME = 'recipe_format_components' AND NEW.source_packaging_id IS NOT NULL THEN 'emballage'
    WHEN NEW.source_recipe_id IS NOT NULL THEN 'semi_fini'
    ELSE 'matiere' END;
  IF NEW.role IS NULL OR NEW.role = '' THEN
    NEW.role := expected;
  ELSIF NEW.role NOT IN ('matiere', 'semi_fini', 'emballage') THEN
    -- Rôles historiques de la composition (base, garniture…) : ramenés à la nature de la source.
    NEW.role := expected;
  ELSIF NEW.role <> expected THEN
    RAISE EXCEPTION 'Rôle « % » incompatible avec la source de la ligne (attendu « % »)', NEW.role, expected USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_rfc_role ON recipe_format_components;
CREATE TRIGGER trg_rfc_role BEFORE INSERT OR UPDATE ON recipe_format_components FOR EACH ROW EXECUTE FUNCTION fn_component_role();
DROP TRIGGER IF EXISTS trg_rc_role ON recipe_components;
CREATE TRIGGER trg_rc_role BEFORE INSERT OR UPDATE ON recipe_components FOR EACH ROW EXECUTE FUNCTION fn_component_role();

-- Coût d'emballage du format = somme des lignes d'emballage (quantité par unité × coût).
-- Sans ligne d'emballage, la valeur saisie est conservée (repli historique).
CREATE OR REPLACE FUNCTION fn_format_packaging_cost() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fid UUID; total NUMERIC; n INT;
BEGIN
  fid := COALESCE(NEW.format_id, OLD.format_id);
  SELECT count(*), COALESCE(SUM(c.quantite * COALESCE(p.unit_cost, 0)), 0)
    INTO n, total
    FROM recipe_format_components c JOIN packaging_items p ON p.id = c.source_packaging_id
   WHERE c.format_id = fid;
  IF n > 0 THEN
    UPDATE recipe_formats SET cout_emballage_unitaire = round(total, 4), updated_at = now()
     WHERE id = fid AND cout_emballage_unitaire IS DISTINCT FROM round(total, 4);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_rfc_packaging_cost ON recipe_format_components;
CREATE TRIGGER trg_rfc_packaging_cost AFTER INSERT OR UPDATE OR DELETE ON recipe_format_components
  FOR EACH ROW EXECUTE FUNCTION fn_format_packaging_cost();

-- ── 2b-4 Quantité de référence et unités ──────────────────────────────────────────
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS reference_mode TEXT NOT NULL DEFAULT 'fournee';
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS reference_batch_qty NUMERIC;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS reference_batch_unit TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_recipes_reference_mode') THEN
    ALTER TABLE recipes ADD CONSTRAINT chk_recipes_reference_mode CHECK (reference_mode IN ('fournee', 'lot', 'pourcentage'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_recipes_reference_batch') THEN
    ALTER TABLE recipes ADD CONSTRAINT chk_recipes_reference_batch CHECK (
      reference_mode = 'fournee' OR (reference_batch_qty IS NOT NULL AND reference_batch_qty > 0));
  END IF;
END $$;
ALTER TABLE recipe_components ADD COLUMN IF NOT EXISTS pct NUMERIC;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rc_pct') THEN
    ALTER TABLE recipe_components ADD CONSTRAINT chk_rc_pct CHECK (pct IS NULL OR (pct > 0 AND pct <= 100));
  END IF;
END $$;

-- Unités du format : le référentiel des unités (mig 058/554) remplace les CHECK figés.
ALTER TABLE recipe_formats DROP CONSTRAINT IF EXISTS recipe_formats_quantite_par_format_unite_check;
ALTER TABLE recipe_formats DROP CONSTRAINT IF EXISTS recipe_formats_rendement_unite_check;
CREATE OR REPLACE FUNCTION fn_check_format_units() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ref_entries WHERE table_id = 'units' AND lower(code) = lower(NEW.quantite_par_format_unite))
     AND lower(NEW.quantite_par_format_unite) NOT IN ('g', 'kg', 'ml', 'l', 'cl', 'unit') THEN
    RAISE EXCEPTION 'Unité inconnue pour la quantité du format : %', NEW.quantite_par_format_unite USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ref_entries WHERE table_id = 'units' AND lower(code) = lower(NEW.rendement_unite))
     AND lower(NEW.rendement_unite) NOT IN ('unit', 'kg', 'l') THEN
    RAISE EXCEPTION 'Unité inconnue pour le rendement du format : %', NEW.rendement_unite USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_check_format_units ON recipe_formats;
CREATE TRIGGER trg_check_format_units BEFORE INSERT OR UPDATE OF quantite_par_format_unite, rendement_unite ON recipe_formats
  FOR EACH ROW EXECUTE FUNCTION fn_check_format_units();

-- ── 2b-5 Date limite et cycle de vie ──────────────────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS date_kind TEXT NOT NULL DEFAULT 'dlc';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_products_date_kind') THEN
    ALTER TABLE products ADD CONSTRAINT chk_products_date_kind CHECK (date_kind IN ('dlc', 'ddm'));
  END IF;
END $$;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_shelf_life_days_range;
ALTER TABLE products ADD CONSTRAINT products_shelf_life_days_range CHECK (shelf_life_days IS NULL OR (shelf_life_days >= 0 AND shelf_life_days <= 3650));

ALTER TABLE product_lots ADD COLUMN IF NOT EXISTS date_kind TEXT NOT NULL DEFAULT 'dlc';
CREATE OR REPLACE FUNCTION fn_product_lot_date_kind() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT COALESCE(p.date_kind, 'dlc') INTO NEW.date_kind FROM products p WHERE p.id = NEW.product_id;
  NEW.date_kind := COALESCE(NEW.date_kind, 'dlc');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_product_lot_date_kind ON product_lots;
CREATE TRIGGER trg_product_lot_date_kind BEFORE INSERT ON product_lots FOR EACH ROW EXECUTE FUNCTION fn_product_lot_date_kind();

INSERT INTO ref_tables (id, label, description, icon, source, editable, display_order) VALUES
  ('product_sale_types', 'Cycles de vente', 'Cycle de vie d''un article en boutique (du jour, à date limite, sur commande, sur stock…).', 'CalendarClock', 'ref_entries', true, 0),
  ('product_sale_units', 'Unités de vente', 'Unité dans laquelle un article se vend (pièce, poids, personne, carton…).', 'Scale', 'ref_entries', true, 0)
ON CONFLICT (id) DO NOTHING;
INSERT INTO ref_entries (table_id, code, label, display_order, metadata) VALUES
  ('product_sale_types', 'jour', 'Du jour', 10, '{}'),
  ('product_sale_types', 'dlv', 'À date limite de vente', 20, '{}'),
  ('product_sale_types', 'commande', 'Sur commande', 30, '{}'),
  ('product_sale_types', 'stock', 'Sur stock (longue conservation)', 40, '{}'),
  ('product_sale_units', 'unit', 'À la pièce', 10, '{}'),
  ('product_sale_units', 'weight', 'Au poids', 20, '{}'),
  ('product_sale_units', 'person', 'À la personne', 30, '{}'),
  ('product_sale_units', 'carton', 'Au carton', 40, '{}')
ON CONFLICT (table_id, code) DO NOTHING;

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sale_type_check;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sale_unit_check;
CREATE OR REPLACE FUNCTION fn_check_product_sale_refs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sale_type IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ref_entries WHERE table_id = 'product_sale_types' AND code = NEW.sale_type) THEN
    RAISE EXCEPTION 'Cycle de vente inconnu : %', NEW.sale_type USING ERRCODE = '23514';
  END IF;
  IF NEW.sale_unit IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ref_entries WHERE table_id = 'product_sale_units' AND code = NEW.sale_unit) THEN
    RAISE EXCEPTION 'Unité de vente inconnue : %', NEW.sale_unit USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_check_product_sale_refs ON products;
CREATE TRIGGER trg_check_product_sale_refs BEFORE INSERT OR UPDATE OF sale_type, sale_unit ON products
  FOR EACH ROW EXECUTE FUNCTION fn_check_product_sale_refs();

-- ── 2b-6 Nutrition ────────────────────────────────────────────────────────────────
-- Valeurs pour 100 g : energy_kj, energy_kcal, fat, saturated_fat, carbohydrates, sugars,
-- fibre, protein, salt (g, kcal ou kJ). Clés absentes = inconnues.
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS nutrition JSONB;
ALTER TABLE products ADD COLUMN IF NOT EXISTS prepackaged BOOLEAN NOT NULL DEFAULT false;
