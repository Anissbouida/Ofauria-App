-- Migration 192: ingredients.category_id (FK expense_categories) + sync trigger
--
-- Objectif: permettre dans l'economat un selecteur hierarchique "categorie > type"
-- couvrant les branches stockables (Matieres premieres : Ingredients, Emballages ;
-- Equipements & Materiel), au lieu d'une simple liste plate.
--
-- L'ingredient reference desormais la feuille de la hierarchie unique
-- expense_categories. L'ancien champ texte ingredients.category (code) est
-- conserve et maintenu automatiquement par trigger, afin de ne RIEN casser cote
-- lectures serveur (inventory, compta, imports, recettes...).
--
-- Idempotente.

-- ─── STEP 1: Colonne + index ────────────────────────────────────────────────
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES expense_categories(id);
CREATE INDEX IF NOT EXISTS idx_ingredients_category_id ON ingredients(category_id);

-- ─── STEP 2: Backfill depuis le code existant ───────────────────────────────
-- Relie chaque ingredient a la feuille expense_categories dont le code
-- correspond, sous les branches synchronisees (Ingredients / Emballages).
UPDATE ingredients ing
SET category_id = ec.id
FROM expense_categories ec
WHERE ec.code = ing.category
  AND ec.is_active = true
  AND ec.ref_table_id IN ('ingredient_categories', 'packaging_categories')
  AND ing.category_id IS NULL;

-- ─── STEP 3: Trigger de synchronisation bidirectionnelle category <-> id ─────
-- Priorite a category_id (nouveau selecteur). En saisie legacy par code
-- (imports, anciens chemins), on retrouve la feuille correspondante.
CREATE OR REPLACE FUNCTION trg_ingredient_category_sync() RETURNS TRIGGER AS $$
DECLARE
  v_code text;
  v_id   uuid;
  id_changed boolean := (TG_OP = 'INSERT' AND NEW.category_id IS NOT NULL)
                        OR (TG_OP = 'UPDATE' AND NEW.category_id IS DISTINCT FROM OLD.category_id);
  code_changed boolean := (TG_OP = 'INSERT' AND NEW.category IS NOT NULL)
                          OR (TG_OP = 'UPDATE' AND NEW.category IS DISTINCT FROM OLD.category);
BEGIN
  IF id_changed THEN
    -- category_id fait foi ; code derive (NULL pour les feuilles sans code -> 'autre')
    SELECT code INTO v_code FROM expense_categories WHERE id = NEW.category_id;
    NEW.category := COALESCE(v_code, 'autre');
  ELSIF code_changed THEN
    SELECT id INTO v_id FROM expense_categories
     WHERE code = NEW.category AND is_active = true
       AND ref_table_id IN ('ingredient_categories', 'packaging_categories')
     LIMIT 1;
    NEW.category_id := v_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ingredients_category_sync ON ingredients;
CREATE TRIGGER ingredients_category_sync
BEFORE INSERT OR UPDATE ON ingredients
FOR EACH ROW EXECUTE FUNCTION trg_ingredient_category_sync();
