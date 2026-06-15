-- Migration 161 : Plan de production multi-format
--
-- Probleme : production_plan_items a UNIQUE (plan_id, product_id), ce qui
-- empeche d'avoir le meme produit (= meme recette) en plusieurs formats sur
-- une meme fournee. Or notre nouveau modele recipe_formats permet justement
-- de produire 3 cake moyens + 3 petits en un seul lancement. Aujourd'hui ca
-- exigerait 2 plans differents.
--
-- Solution : ajouter format_id (NULL si format unique / mode legacy), lever
-- l'UNIQUE strict, et le remplacer par UNIQUE (plan_id, product_id, format_id)
-- pour empecher les doublons exacts. NULL est considere different de NULL
-- dans une contrainte UNIQUE PG, donc les anciennes lignes (format_id NULL)
-- restent autorisees a coexister — mais on les considere par convention comme
-- "1 seul format par produit dans le plan".
--
-- Aucun changement de comportement pour les lignes existantes : format_id
-- reste NULL, l'UI continue d'afficher comme avant. La fonctionnalite
-- multi-format est opt-in : le code applicatif doit explicitement passer un
-- format_id pour creer plusieurs lignes.

ALTER TABLE production_plan_items
  ADD COLUMN IF NOT EXISTS format_id UUID REFERENCES recipe_formats(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_plan_items_format ON production_plan_items(format_id) WHERE format_id IS NOT NULL;

-- Lever l'UNIQUE existant et le remplacer par une version incluant format_id.
-- Note : PG considere NULL != NULL dans UNIQUE, donc les anciennes lignes
-- (format_id NULL) peuvent toujours coexister meme avec le meme (plan_id, product_id).
-- C'est volontaire pour preserver le comportement legacy.
ALTER TABLE production_plan_items
  DROP CONSTRAINT IF EXISTS production_plan_items_plan_id_product_id_key;

-- Nouvel UNIQUE : meme couple format_id seulement (NULL acceptes en multiple via PG sémantique).
-- Pour les nouveaux usages multi-format, format_id sera toujours rempli.
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_item_product_format
  ON production_plan_items(plan_id, product_id, format_id)
  WHERE format_id IS NOT NULL;

-- Pour le mode legacy (format_id NULL), on garde l'unicite stricte sur (plan_id, product_id).
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_item_product_legacy
  ON production_plan_items(plan_id, product_id)
  WHERE format_id IS NULL;

COMMENT ON COLUMN production_plan_items.format_id IS
  'Format de production specifique (recipe_formats.id). NULL = legacy / format unique. Permet d''avoir plusieurs lignes pour le meme produit avec des formats differents.';
