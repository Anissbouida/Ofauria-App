-- 468 — Secteur d'activité paramétrable (packs secteur). Phase 1 multi-secteur.
--
-- Le secteur se choisit dans Paramètres › Société et pilote les modules visibles
-- (hasModule = modules du secteur ∩ droits du rôle). Additif et non destructif :
-- Ofauria démarre sur « boulangerie » = tous les modules, donc aucun effet visible.
-- Le code ne teste JAMAIS le secteur ; il lit la liste de modules activés (capacités).

CREATE TABLE IF NOT EXISTS sector_packs (
  code            VARCHAR(40) PRIMARY KEY,
  label           VARCHAR(120) NOT NULL,
  enabled_modules TEXT[] NOT NULL DEFAULT '{}',
  is_default      BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Boulangerie : miroir de l'existant (toutes les clés de modules canoniques).
INSERT INTO sector_packs (code, label, enabled_modules, is_default) VALUES
  ('boulangerie', 'Boulangerie / Pâtisserie', ARRAY[
     'dashboard','pos','sales','orders','products','customers','stock','recipes',
     'production','employees','accounting','purchasing','users','reports','settings',
     'replenishment','unsold','packaging','reconciliation','controle','projects','crm','maintenance'
   ], true)
ON CONFLICT (code) DO NOTHING;

-- Générique : tout le transverse, sans les modules propres à la fabrication
-- alimentaire (recettes, production, réapprovisionnement, invendus, rapprochement
-- boutique). Le stock générique, le contrôle qualité, les projets, le CRM et la
-- maintenance restent disponibles.
INSERT INTO sector_packs (code, label, enabled_modules) VALUES
  ('generique', 'Générique (multi-secteur)', ARRAY[
     'dashboard','pos','sales','orders','products','customers','stock','employees',
     'accounting','purchasing','users','reports','settings','packaging','controle',
     'projects','crm','maintenance'
   ])
ON CONFLICT (code) DO NOTHING;

-- Secteur de la société (company_settings = ligne unique id = 1). Défaut : boulangerie.
ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS sector_pack VARCHAR(40) NOT NULL DEFAULT 'boulangerie'
    REFERENCES sector_packs(code);
