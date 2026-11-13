-- 507 — Activation des modules et options (plan Production générique, lot P0a).
--
-- Le secteur d'activité (mig 468) devient un PRÉRÉGLAGE : l'administrateur ajuste
-- ensuite chaque module et chaque option dans Paramètres › Secteur et modules.
-- Les tables d'ajustement ne stockent que les ÉCARTS au préréglage : pas de ligne
-- = le module (ou l'option) suit le secteur. Revenir au préréglage = supprimer
-- la ligne. Désactiver ne supprime aucune donnée métier.
--
-- Modules effectifs = modules du secteur + modules activés − modules désactivés,
-- calculés à un seul endroit (sector.repository.ts) et contrôlés côté serveur.
--
-- Additif : sans ligne d'ajustement, chaque secteur se comporte exactement comme
-- avant. Retour arrière : DROP TABLE company_feature_settings, app_features,
-- company_module_settings ; ALTER TABLE sector_packs DROP COLUMN features.

CREATE TABLE IF NOT EXISTS company_module_settings (
  module_key  VARCHAR(40) PRIMARY KEY,
  enabled     BOOLEAN NOT NULL,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Catalogue des options d'un module (fonctions activables à l'intérieur d'un module).
CREATE TABLE IF NOT EXISTS app_features (
  key          VARCHAR(60) PRIMARY KEY,
  module_key   VARCHAR(40) NOT NULL,
  label        VARCHAR(120) NOT NULL,
  description  TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0
);

-- Options allumées par défaut pour chaque secteur.
ALTER TABLE sector_packs ADD COLUMN IF NOT EXISTS features TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS company_feature_settings (
  feature_key VARCHAR(60) PRIMARY KEY REFERENCES app_features(key) ON DELETE CASCADE,
  enabled     BOOLEAN NOT NULL,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Couche boulangerie du module Production (plan, § 1). Le code ne lira ces options
-- qu'au lot P5 ; d'ici là elles sont visibles et réglables dans l'écran.
INSERT INTO app_features (key, module_key, label, description, sort_order) VALUES
  ('dlc_jour', 'production', 'DLC du jour',
   'Chaque lot fabriqué reçoit par défaut une date limite au jour même.', 10),
  ('vitrine', 'production', 'Suivi vitrine',
   'Les lots fabriqués sont suivis en vitrine jusqu''à la vente ou l''invendu.', 20),
  ('contenants_cru_cuit', 'production', 'Contenants cru / cuit',
   'Formats en grammes avec poids cru et poids cuit (cadres, moules, cercles).', 30),
  ('ccp_cuisson', 'production', 'Points critiques de cuisson',
   'Relevés obligatoires aux étapes de cuisson et de refroidissement (températures, durée).', 40),
  ('haccp', 'production', 'HACCP',
   'Plan HACCP et registres d''hygiène dans le module Production.', 50),
  ('lot_thermal', 'production', 'Congélation / décongélation',
   'Passage des lots au congélateur et retour, avec nouvelle date limite.', 60),
  ('fiche_masterclass', 'production', 'Fiche technique bilingue',
   'Fiche technique PDF au format Masterclass, en français et en darija.', 70)
ON CONFLICT (key) DO NOTHING;

UPDATE sector_packs
   SET features = ARRAY['dlc_jour','vitrine','contenants_cru_cuit','ccp_cuisson','haccp','lot_thermal','fiche_masterclass']
 WHERE code = 'boulangerie' AND features = '{}';

-- Journal du paramétrage (mig 328) : qui a activé ou désactivé quoi, et quand.
DO $$
BEGIN
  IF to_regprocedure('log_config_change()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS company_module_settings_config_audit ON company_module_settings;
    CREATE TRIGGER company_module_settings_config_audit AFTER INSERT OR UPDATE OR DELETE ON company_module_settings
      FOR EACH ROW EXECUTE FUNCTION log_config_change('module_key', '');
    DROP TRIGGER IF EXISTS company_feature_settings_config_audit ON company_feature_settings;
    CREATE TRIGGER company_feature_settings_config_audit AFTER INSERT OR UPDATE OR DELETE ON company_feature_settings
      FOR EACH ROW EXECUTE FUNCTION log_config_change('feature_key', '');
  END IF;
END $$;
