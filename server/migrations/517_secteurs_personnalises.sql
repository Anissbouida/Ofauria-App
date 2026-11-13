-- 517 — Secteurs personnalisés et modèles de configuration (plan Production générique, P10).
--
-- Une configuration réussie (secteur, modules, options, vocabulaire, données de départ)
-- s'exporte en modèle (fichier JSON) et devient un secteur proposé à la liste, comme les
-- secteurs livrés. Colonnes ajoutées à sector_packs :
--   * is_custom   : secteur créé dans l'application (supprimable s'il n'est pas utilisé) ;
--   * base_sector : secteur livré dont il dérive (information) ;
--   * starter     : données de départ chargeables (types d'étape, d'équipement, unités),
--                   même rôle que le pack en code des secteurs livrés (sector-starter) ;
--   * created_by.
-- Additif : les secteurs existants gardent is_custom = false et starter vide.
-- Retour arrière : supprimer les secteurs is_custom, puis les quatre colonnes.

ALTER TABLE sector_packs
  ADD COLUMN IF NOT EXISTS is_custom   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS base_sector VARCHAR(40),
  ADD COLUMN IF NOT EXISTS starter     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_by  UUID REFERENCES users(id) ON DELETE SET NULL;
