-- ═══════════════════════════════════════════════════════════════
-- 138: Configuration des sachets (controle anti-gaspillage)
--
-- Permet a l'admin de definir combien d'articles entrent dans un
-- sachet, par categorie de produit. Le calcul a la caisse suggere
-- automatiquement le nombre de sachets a remettre.
--
--   * categories.articles_per_sachet : combien d'articles de cette
--     categorie tiennent dans un sachet (NULL = utilise le defaut global)
--   * categories.needs_sachet        : FALSE pour les produits deja
--     emballes (bouteilles, sachets madeleine conditionnes, etc.)
--   * company_settings.default_articles_per_sachet : valeur de repli
--     quand la categorie n'a pas de ratio defini
--
-- Toutes les colonnes sont additives ; pas de breaking change.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS articles_per_sachet INTEGER
    CHECK (articles_per_sachet IS NULL OR articles_per_sachet > 0);

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS needs_sachet BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS default_articles_per_sachet INTEGER NOT NULL DEFAULT 5
    CHECK (default_articles_per_sachet > 0);
