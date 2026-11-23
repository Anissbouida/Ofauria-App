-- 646 — Interfaces adaptatives : définitions d'écran en base (plan d'exécution
-- multi-industries, étape 10, pas 10b et 10g).
--
-- POURQUOI
--   Les colonnes des listes, l'ordre des sections de l'ordre de fabrication et leur
--   visibilité par rôle étaient écrits dans le code : impossible d'adapter un écran au métier,
--   à la société ou au rôle sans développement.
--
-- CE QUI CHANGE
--   - screen_definitions : une définition par écran et par portée, résolue profil → société →
--     rôle (la plus précise l'emporte, élément par élément). Une définition porte :
--       columns  : [{ key, visible, order }]   (listes)
--       sections : [{ key, visible, order }]   (fiche de l'ordre, par onglet)
--       filters  : [{ key, visible, order }]
--       custom_fields : [{ key, section }]     (champ personnalisé placé dans une section)
--     Brouillon puis publication (versionnée) ; seules les définitions publiées s'appliquent.
--   - Les éléments ne viennent que du catalogue de l'écran (shared/screen-catalog) ; certains
--     sont verrouillés (numéro, statut) et ne se masquent pas.
--   Aucune définition livrée : sans définition, chaque écran s'affiche exactement comme avant.
--
-- RETOUR ARRIÈRE
--   DROP TABLE screen_definitions.

CREATE TABLE IF NOT EXISTS screen_definitions (
  id           SERIAL PRIMARY KEY,
  screen_key   VARCHAR(60) NOT NULL,
  scope_type   VARCHAR(12) NOT NULL CHECK (scope_type IN ('profile', 'company', 'role')),
  scope_id     VARCHAR(60) NOT NULL DEFAULT '',
  status       VARCHAR(10) NOT NULL DEFAULT 'brouillon' CHECK (status IN ('brouillon', 'publie', 'archive')),
  version_no   INTEGER NOT NULL DEFAULT 1,
  definition   JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(definition) = 'object'),
  updated_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_screen_definitions_published ON screen_definitions (screen_key, scope_type, scope_id) WHERE status = 'publie';
CREATE UNIQUE INDEX IF NOT EXISTS uq_screen_definitions_draft ON screen_definitions (screen_key, scope_type, scope_id) WHERE status = 'brouillon';
