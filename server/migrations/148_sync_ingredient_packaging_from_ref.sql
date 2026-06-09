-- Migration 148: Sync ingredient & packaging categories from ref_entries
--
-- Avant: les types niveau-3 sous "Matieres premieres > Ingredients" et
--        "Matieres premieres > Emballages" etaient codes en dur dans expense_categories.
-- Apres: ces types sont synchronises automatiquement depuis ref_entries
--        (table_id = 'ingredient_categories' et 'packaging_categories').
--
-- Le referentiel (Parametres > Referentiel) devient la source unique. Toute
-- modification y est repercutee dans le modal "Nouvelle depense".

-- ─── STEP 1: Creer packaging_categories (ref_table + entrees) ───────────────

INSERT INTO ref_tables (id, label, description, icon, source, editable, display_order)
VALUES ('packaging_categories', 'Categories emballages',
        'Boites, sacs, etiquettes, papier boulanger, ficelles & rubans...',
        'Package', 'ref_entries', true, 14)
ON CONFLICT (id) DO UPDATE
  SET label = EXCLUDED.label,
      description = EXCLUDED.description,
      icon = EXCLUDED.icon;

INSERT INTO ref_entries (table_id, code, label, display_order)
VALUES
  ('packaging_categories', 'boites',           'Boites',             1),
  ('packaging_categories', 'sacs',             'Sacs',               2),
  ('packaging_categories', 'etiquettes',       'Etiquettes',         3),
  ('packaging_categories', 'papier_boulanger', 'Papier boulanger',   4),
  ('packaging_categories', 'ficelles_rubans',  'Ficelles & Rubans',  5)
ON CONFLICT (table_id, code) DO NOTHING;

-- ─── STEP 2: Ajout colonne ref_table_id + index unique (parent_id, code) ──

ALTER TABLE expense_categories
  ADD COLUMN IF NOT EXISTS ref_table_id VARCHAR(60) REFERENCES ref_tables(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_cat_parent_code
  ON expense_categories(parent_id, code)
  WHERE code IS NOT NULL;

-- ─── STEP 3: Mapper les entrees hardcodees existantes vers les codes ──────
-- Preserve les UUIDs existants (donc les payments.category_id restent valides).

-- Ingredients (parent 20000000-0000-0000-0000-000000000004)
UPDATE expense_categories SET code = 'farines',                ref_table_id = 'ingredient_categories' WHERE id = '30000000-0000-0000-0000-000000000012';
UPDATE expense_categories SET code = 'beurre',                 ref_table_id = 'ingredient_categories' WHERE id = '30000000-0000-0000-0000-000000000013';
UPDATE expense_categories SET code = 'sucres',                 ref_table_id = 'ingredient_categories' WHERE id = '30000000-0000-0000-0000-000000000014';
UPDATE expense_categories SET code = 'oeufs',                  ref_table_id = 'ingredient_categories' WHERE id = '30000000-0000-0000-0000-000000000015';
UPDATE expense_categories SET code = 'autre',                  ref_table_id = 'ingredient_categories' WHERE id = '30000000-0000-0000-0000-000000000016';
UPDATE expense_categories SET code = 'lait',                   ref_table_id = 'ingredient_categories' WHERE id = '30000000-0000-0000-0000-000000000035';
UPDATE expense_categories SET code = 'cremes',                 ref_table_id = 'ingredient_categories' WHERE id = '30000000-0000-0000-0000-000000000036';
UPDATE expense_categories SET code = 'chocolat',               ref_table_id = 'ingredient_categories' WHERE id = '30000000-0000-0000-0000-000000000037';
UPDATE expense_categories SET code = 'matieres_grasses',       ref_table_id = 'ingredient_categories' WHERE id = '30000000-0000-0000-0000-000000000038';
UPDATE expense_categories SET code = 'levures',                ref_table_id = 'ingredient_categories' WHERE id = '30000000-0000-0000-0000-000000000039';
UPDATE expense_categories SET code = 'epices',                 ref_table_id = 'ingredient_categories' WHERE id = '30000000-0000-0000-0000-000000000040';
UPDATE expense_categories SET code = 'viandes',                ref_table_id = 'ingredient_categories' WHERE id = '30000000-0000-0000-0000-000000000041';
UPDATE expense_categories SET code = 'poissons_fruits_de_mer', ref_table_id = 'ingredient_categories' WHERE id = '30000000-0000-0000-0000-000000000042';
UPDATE expense_categories SET code = 'legumes',                ref_table_id = 'ingredient_categories' WHERE id = '30000000-0000-0000-0000-000000000043';
UPDATE expense_categories SET code = 'fruits',                 ref_table_id = 'ingredient_categories' WHERE id = '30000000-0000-0000-0000-000000000044';
UPDATE expense_categories SET code = 'fruits_secs',            ref_table_id = 'ingredient_categories' WHERE id = '30000000-0000-0000-0000-000000000045';

-- Emballages (parent 20000000-0000-0000-0000-000000000005)
UPDATE expense_categories SET code = 'boites',           ref_table_id = 'packaging_categories' WHERE id = '30000000-0000-0000-0000-000000000017';
UPDATE expense_categories SET code = 'sacs',             ref_table_id = 'packaging_categories' WHERE id = '30000000-0000-0000-0000-000000000018';
UPDATE expense_categories SET code = 'etiquettes',       ref_table_id = 'packaging_categories' WHERE id = '30000000-0000-0000-0000-000000000019';
UPDATE expense_categories SET code = 'papier_boulanger', ref_table_id = 'packaging_categories' WHERE id = '30000000-0000-0000-0000-000000000082';
UPDATE expense_categories SET code = 'ficelles_rubans',  ref_table_id = 'packaging_categories' WHERE id = '30000000-0000-0000-0000-000000000083';

-- ─── STEP 4: Nettoyer 'emballages' du referentiel ingredient_categories ───
-- C'est une categorie parent qui n'a rien a faire dans la liste des ingredients.

DELETE FROM ref_entries
WHERE table_id = 'ingredient_categories' AND code = 'emballages';

-- ─── STEP 5: Fonction de sync ref_entries → expense_categories ────────────

CREATE OR REPLACE FUNCTION sync_ref_to_expense_categories(
  p_table_id  VARCHAR,
  p_parent_id UUID
) RETURNS VOID AS $$
BEGIN
  -- Upsert: chaque ref_entries devient une expense_categories niveau 3
  INSERT INTO expense_categories
    (name, type, parent_id, level, display_order, is_active, requires_po, code, ref_table_id)
  SELECT r.label, 'expense', p_parent_id, 3,
         r.display_order, r.is_active, true, r.code, p_table_id
  FROM ref_entries r
  WHERE r.table_id = p_table_id
    AND r.code IS NOT NULL
  ON CONFLICT (parent_id, code) WHERE code IS NOT NULL
  DO UPDATE SET
    name          = EXCLUDED.name,
    is_active     = EXCLUDED.is_active,
    display_order = EXCLUDED.display_order,
    ref_table_id  = EXCLUDED.ref_table_id;

  -- Desactiver les expense_categories synchronisees dont le code n'existe plus
  -- dans ref_entries (suppression ou changement de code cote referentiel).
  UPDATE expense_categories ec
  SET is_active = false
  WHERE ec.parent_id = p_parent_id
    AND ec.ref_table_id = p_table_id
    AND ec.code IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM ref_entries re
      WHERE re.table_id = p_table_id AND re.code = ec.code
    );
END;
$$ LANGUAGE plpgsql;

-- ─── STEP 6: Trigger qui propage les changements en temps reel ─────────────

CREATE OR REPLACE FUNCTION trg_sync_ref_to_expense_categories()
RETURNS TRIGGER AS $$
DECLARE
  v_table_id  VARCHAR;
  v_parent_id UUID;
BEGIN
  v_table_id := COALESCE(NEW.table_id, OLD.table_id);

  IF v_table_id = 'ingredient_categories' THEN
    v_parent_id := '20000000-0000-0000-0000-000000000004';
  ELSIF v_table_id = 'packaging_categories' THEN
    v_parent_id := '20000000-0000-0000-0000-000000000005';
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  PERFORM sync_ref_to_expense_categories(v_table_id, v_parent_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ref_entries_sync_expense_categories ON ref_entries;
CREATE TRIGGER ref_entries_sync_expense_categories
AFTER INSERT OR UPDATE OR DELETE ON ref_entries
FOR EACH ROW EXECUTE FUNCTION trg_sync_ref_to_expense_categories();

-- ─── STEP 7: Sync initiale (cree les entrees manquantes : fromages,
--             sauces, conserves, decors, gelifiants, preparations, etc.) ───

SELECT sync_ref_to_expense_categories('ingredient_categories', '20000000-0000-0000-0000-000000000004');
SELECT sync_ref_to_expense_categories('packaging_categories',  '20000000-0000-0000-0000-000000000005');
