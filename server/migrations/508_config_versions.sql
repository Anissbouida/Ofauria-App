-- 508 — Configuration versionnée des modules (plan Production générique, lot P0b).
--
-- Chaque changement de l'écran Paramètres › Secteur et modules (secteur, modules,
-- options, retour au préréglage, restauration) enregistre l'état COMPLET qui en
-- résulte : on peut revenir à n'importe quelle version en un clic. Une restauration
-- crée elle-même une nouvelle version, donc on peut annuler une annulation.
-- config_audit_log (mig 328) garde en plus le détail ligne par ligne.
--
-- snapshot = { "sector": "boulangerie", "modules": { "crm": false }, "features": { "haccp": false } }
-- (modules / features = écarts au préréglage, comme les tables d'ajustement de la mig 507).
--
-- Additif. Retour arrière : DROP TABLE config_versions.

CREATE TABLE IF NOT EXISTS config_versions (
  id          BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  label       TEXT NOT NULL,
  snapshot    JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_config_versions_created ON config_versions (created_at DESC, id DESC);

-- Nettoyage unique : un écart égal au préréglage du secteur courant n'en est pas un
-- (créé par un aller-retour de secteur avant que le changement de secteur ne les
-- retire). Il affichait « Ajusté » sans rien changer.
DELETE FROM company_module_settings cms
 USING company_settings cs JOIN sector_packs sp ON sp.code = cs.sector_pack
 WHERE cs.id = 1 AND cms.enabled = (cms.module_key = ANY (sp.enabled_modules));
DELETE FROM company_feature_settings cfs
 USING company_settings cs JOIN sector_packs sp ON sp.code = cs.sector_pack
 WHERE cs.id = 1 AND cfs.enabled = (cfs.feature_key = ANY (sp.features));
