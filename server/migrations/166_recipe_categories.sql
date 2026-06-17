-- Migration 166 : Categories operationnelles des recettes.
--
-- Distincte de `categories` (table existante INTEGER, focus commercial : BAGUETTE,
-- MACARON, BOITES...). Ici on classifie les recettes par section de production :
-- boulangerie, viennoiserie, patisserie, sale/beldi, gateaux marocains, base
-- de production. Sert au filtrage des recettes (y compris is_base=true qui
-- n'ont pas de produit lie) et aux rapports par section.

CREATE TABLE IF NOT EXISTS recipe_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) NOT NULL UNIQUE,
  label VARCHAR(100) NOT NULL,
  color VARCHAR(20) NOT NULL DEFAULT '#94a3b8',
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE recipe_categories IS
  'Classification operationnelle des recettes par section de production. Distincte de la table commerciale `categories`.';

-- Seed des 6 categories de base. Couleurs choisies pour contraste suffisant
-- en badge UI (proche du palette Tailwind 500).
INSERT INTO recipe_categories (code, label, color, display_order) VALUES
  ('boulangerie',       'Boulangerie',           '#d97706', 10),  -- amber-600
  ('viennoiserie',      'Viennoiserie',          '#ca8a04', 20),  -- yellow-600
  ('patisserie',        'Patisserie',            '#db2777', 30),  -- pink-600
  ('sale_beldi',        'Sale / Beldi',          '#16a34a', 40),  -- green-600
  ('gateaux_marocains', 'Gateaux marocains',     '#9333ea', 50),  -- purple-600
  ('base_production',   'Base de production',    '#64748b', 60)   -- slate-500
ON CONFLICT (code) DO NOTHING;

-- Colonne sur recipes. Nullable : recettes existantes restent non classifiees
-- jusqu'au backfill ou edition manuelle.
ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS category_id UUID NULL REFERENCES recipe_categories(id) ON DELETE SET NULL;

COMMENT ON COLUMN recipes.category_id IS
  'FK vers recipe_categories. Classifie la recette par section de production. Nullable.';

CREATE INDEX IF NOT EXISTS idx_recipes_category ON recipes(category_id) WHERE category_id IS NOT NULL;

-- Backfill conservatif par mots-cles sur le nom du produit lie.
-- N'ecrit QUE si le match est clair; laisse NULL pour les ambigus.
-- Les recettes is_base=true sont mappees a 'base_production' par defaut.
WITH cat_ids AS (
  SELECT code, id FROM recipe_categories
),
matches AS (
  SELECT r.id AS recipe_id,
    CASE
      WHEN r.is_base = true THEN 'base_production'
      WHEN UPPER(COALESCE(p.name, r.name)) ~* '(BAGUETTE|^PAIN |TRADITION|CIABATTA|FOCACCIA|FOUGASSE|MICHE|BATARD)' THEN 'boulangerie'
      WHEN UPPER(COALESCE(p.name, r.name)) ~* '(CROISSANT|VIENNOISERIE|PAIN AU CHOCOLAT|BRIOCHE|CHAUSSON|KOUIGN|TRESSE)' THEN 'viennoiserie'
      WHEN UPPER(COALESCE(p.name, r.name)) ~* '(MSEMEN|M''SEMEN|MEHFOLA|MAHJOUBA|BAGHRIR|BRIOUATE|BRIOUAT|HARSHA|HARCHA|PASTILLA|BSTILLA|BASTILLA|SELLOU|SFOUF|MAKROUDH|MAKROUT|GHRIBA|KAAB|CORNES.*GAZELLE|FEKKAS|CHEBAKIA)' THEN 'gateaux_marocains'
      WHEN UPPER(COALESCE(p.name, r.name)) ~* '(MACARON|TARTE|ECLAIR|MILLEFEUILLE|MILLE.FEUILLE|FRAISIER|OPERA|FORET.NOIRE|FOR[EÊ]T|CHEESECAKE|CHARLOTTE|CAKE|ENTREMETS|PARIS.BREST|SAINT.HONORE|FLAN|MOUSSE|DACQUOISE|BAVAROIS|FINANCIER|MADELEINE)' THEN 'patisserie'
      WHEN UPPER(COALESCE(p.name, r.name)) ~* '(SAL[EÉ]|QUICHE|MINI PIZZA|FEUILLET[EÉ]|PIZZ|EMPANADA|CAKE SAL|MINI HAMBURGER)' THEN 'sale_beldi'
      ELSE NULL
    END AS code
  FROM recipes r
  LEFT JOIN products p ON p.id = r.product_id
  WHERE r.category_id IS NULL
)
UPDATE recipes r
SET category_id = c.id
FROM matches m
JOIN cat_ids c ON c.code = m.code
WHERE r.id = m.recipe_id
  AND m.code IS NOT NULL
  AND r.category_id IS NULL;
