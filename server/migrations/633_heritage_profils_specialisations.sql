-- 633 — Héritage vivant des profils, famille Agroalimentaire, spécialisations
--       (plan d'exécution multi-industries, étape 2).
--
-- POURQUOI
--   Les profils process, discret et atelier avaient RECOPIÉ les modules et options de
--   « fabrication » à leur création (mig 586) : modifier le parent ne les changeait pas.
--   La boulangerie n'avait pas de parent, alors qu'elle est un métier de l'agroalimentaire,
--   et ses métiers (pâtisserie, viennoiserie, beldi…) n'existaient que sous forme de rôles.
--
-- CE QUI CHANGE
--   1. sector_packs :
--        inherits          vrai : modules et options = ceux du parent (base_sector) + écarts ;
--        add_/remove_modules, add_/remove_features : les écarts de l'enfant ;
--        family, status    regroupement et état affichés dans le choix du profil.
--      enabled_modules et features restent remplis (liste complète) pendant un cycle : retour
--      arrière possible en repassant inherits à faux.
--   2. Famille « agroalimentaire » (racine) et profil « agro_conditionne » (enfant).
--      boulangerie devient enfant d'agroalimentaire ; ses écarts sont CALCULÉS pour que sa
--      configuration effective soit strictement identique (vérifié en fin de migration).
--   3. process, discret, atelier : convertis en écarts par rapport à fabrication (même contrôle).
--      process est relibellé « cosmétique, chimie » : l'agroalimentaire a désormais son profil.
--   4. Spécialisations (sector_specializations, company_specializations) : paquets
--      cumulables d'ateliers, de types d'étape, de capacités. Sept pour la boulangerie.
--      Celles qui correspondent à un atelier existant de la société sont marquées actives,
--      sans rien créer.

ALTER TABLE sector_packs ADD COLUMN IF NOT EXISTS inherits BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sector_packs ADD COLUMN IF NOT EXISTS add_modules TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE sector_packs ADD COLUMN IF NOT EXISTS remove_modules TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE sector_packs ADD COLUMN IF NOT EXISTS add_features TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE sector_packs ADD COLUMN IF NOT EXISTS remove_features TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE sector_packs ADD COLUMN IF NOT EXISTS family TEXT;
ALTER TABLE sector_packs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'disponible';
ALTER TABLE sector_packs ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE sector_packs ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 100;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_sector_packs_status') THEN
    ALTER TABLE sector_packs ADD CONSTRAINT chk_sector_packs_status CHECK (status IN ('disponible', 'a_valider', 'sur_demande'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_sector_packs_not_self_parent') THEN
    ALTER TABLE sector_packs ADD CONSTRAINT chk_sector_packs_not_self_parent CHECK (base_sector IS NULL OR base_sector <> code);
  END IF;
END $$;

-- Différence de deux listes, sans doublon, triée (écarts lisibles).
CREATE OR REPLACE FUNCTION fn_text_array_minus(a TEXT[], b TEXT[]) RETURNS TEXT[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(array_agg(x ORDER BY x), '{}') FROM (SELECT DISTINCT unnest(a) AS x EXCEPT SELECT unnest(b)) s
$$;

-- ── Famille Agroalimentaire ─────────────────────────────────────────────────────
-- Modules : le socle de fabrication + Contrôle & Qualité. Options : HACCP, congélation.
INSERT INTO sector_packs (code, label, enabled_modules, features, is_default, family, status, description, sort_order)
SELECT 'agroalimentaire', 'Agroalimentaire',
       (SELECT ARRAY(SELECT DISTINCT unnest(f.enabled_modules || ARRAY['controle']::text[]) ORDER BY 1)),
       ARRAY['haccp', 'lot_thermal'], false, 'agroalimentaire', 'a_valider',
       'Lots, dates limites, allergènes, HACCP, températures, quarantaine, rappel.', 10
  FROM sector_packs f WHERE f.code = 'fabrication'
ON CONFLICT (code) DO NOTHING;

-- Profil Agroalimentaire conditionné : hérite de la famille, reprend les couches
-- production du profil process (ordre de lot, pesée, contrôle).
INSERT INTO sector_packs (code, label, enabled_modules, features, is_default, base_sector, inherits, family, status, description, sort_order, profile)
SELECT 'agro_conditionne', 'Agroalimentaire conditionné', a.enabled_modules, a.features, false,
       'agroalimentaire', true, 'agroalimentaire', 'a_valider',
       'Conserves, confitures, produits secs, boissons.', 20, p.profile
  FROM sector_packs a LEFT JOIN sector_packs p ON p.code = 'process'
 WHERE a.code = 'agroalimentaire'
ON CONFLICT (code) DO NOTHING;

INSERT INTO sector_labels (sector_pack, label_key, label_value)
SELECT 'agro_conditionne', label_key, label_value FROM sector_labels WHERE sector_pack = 'process'
ON CONFLICT DO NOTHING;

-- ── Conversion des enfants en écarts (configuration effective inchangée) ─────────
UPDATE sector_packs c
   SET base_sector = 'agroalimentaire', inherits = true,
       add_modules = fn_text_array_minus(c.enabled_modules, p.enabled_modules),
       remove_modules = fn_text_array_minus(p.enabled_modules, c.enabled_modules),
       add_features = fn_text_array_minus(c.features, p.features),
       remove_features = fn_text_array_minus(p.features, c.features),
       family = 'agroalimentaire', sort_order = 15,
       description = COALESCE(c.description, 'Boulangerie, pâtisserie, viennoiserie, traiteur, spécialités ; spécialisations cumulables.')
  FROM sector_packs p
 WHERE c.code = 'boulangerie' AND p.code = 'agroalimentaire' AND NOT c.inherits;

UPDATE sector_packs c
   SET inherits = true,
       add_modules = fn_text_array_minus(c.enabled_modules, p.enabled_modules),
       remove_modules = fn_text_array_minus(p.enabled_modules, c.enabled_modules),
       add_features = fn_text_array_minus(c.features, p.features),
       remove_features = fn_text_array_minus(p.features, c.features),
       family = 'industrie', status = 'a_valider'
  FROM sector_packs p
 WHERE c.code IN ('process', 'discret', 'atelier') AND c.base_sector = 'fabrication' AND p.code = 'fabrication' AND NOT c.inherits;

UPDATE sector_packs SET label = 'Industrie — process (cosmétique, chimie)',
       description = COALESCE(description, 'Formulations, pesées, mélanges, contrôle par lot.'), sort_order = 30
 WHERE code = 'process' AND label = 'Industrie — process (cosmétique, agroalimentaire)';
UPDATE sector_packs SET family = 'industrie', sort_order = 25,
       description = COALESCE(description, 'Fabricant généraliste : ordres de fabrication et nomenclatures.') WHERE code = 'fabrication';
UPDATE sector_packs SET sort_order = 35, description = COALESCE(description, 'Sous-ensembles, production en série, numéros de série.') WHERE code = 'discret';
UPDATE sector_packs SET sort_order = 40, description = COALESCE(description, 'Métallerie, menuiserie, pièces uniques par affaire.') WHERE code = 'atelier';
UPDATE sector_packs SET family = 'sans_fabrication', sort_order = 50,
       description = COALESCE(description, 'Achat-revente : production fermée.') WHERE code = 'negoce';
UPDATE sector_packs SET family = 'sans_fabrication', sort_order = 55,
       description = COALESCE(description, 'Services, multi-activité : production fermée.') WHERE code = 'generique';
UPDATE sector_packs SET family = 'personnalise' WHERE is_custom AND family IS NULL;

-- Contrôle : la résolution par écarts redonne exactement les anciennes listes.
DO $$
DECLARE r RECORD; resolved_m TEXT[]; resolved_f TEXT[];
BEGIN
  FOR r IN SELECT c.code, c.enabled_modules, c.features, c.add_modules, c.remove_modules, c.add_features, c.remove_features,
                  p.enabled_modules AS pm, p.features AS pf
             FROM sector_packs c JOIN sector_packs p ON p.code = c.base_sector
            WHERE c.inherits AND NOT p.inherits
  LOOP
    resolved_m := fn_text_array_minus(r.pm || r.add_modules, r.remove_modules);
    resolved_f := fn_text_array_minus(r.pf || r.add_features, r.remove_features);
    IF resolved_m IS DISTINCT FROM fn_text_array_minus(r.enabled_modules, '{}')
       OR resolved_f IS DISTINCT FROM fn_text_array_minus(r.features, '{}') THEN
      RAISE EXCEPTION 'Héritage : la configuration de % change (% / %)', r.code, resolved_m, resolved_f;
    END IF;
  END LOOP;
END $$;

-- ── Spécialisations ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sector_specializations (
  code         VARCHAR(40) PRIMARY KEY,
  sector_pack  VARCHAR(40) NOT NULL REFERENCES sector_packs(code) ON DELETE CASCADE,
  label        VARCHAR(120) NOT NULL,
  description  TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  -- { workshop: { code, label, aliases[] }, step_types: [{code,label}], features: [] }
  content      JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS company_specializations (
  code        VARCHAR(40) PRIMARY KEY REFERENCES sector_specializations(code) ON DELETE CASCADE,
  enabled_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  enabled_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO sector_specializations (code, sector_pack, label, description, sort_order, content) VALUES
  ('boulangerie', 'boulangerie', 'Boulangerie', 'Pains, baguettes, pains spéciaux.', 10,
   '{"workshop": {"code": "boulangerie", "label": "Boulangerie", "aliases": ["boulangerie", "baker"]},
     "step_types": [{"code": "petrissage", "label": "Pétrissage"}, {"code": "pointage", "label": "Pointage"},
                    {"code": "faconnage", "label": "Façonnage"}, {"code": "cuisson", "label": "Cuisson"}],
     "features": ["mode_fournee", "vitrine", "dlc_jour"]}'::jsonb),
  ('patisserie', 'boulangerie', 'Pâtisserie', 'Entremets, tartes, petits gâteaux.', 20,
   '{"workshop": {"code": "patisserie", "label": "Pâtisserie", "aliases": ["patisserie", "pastry_chef"]},
     "step_types": [{"code": "montage", "label": "Montage"}, {"code": "finition", "label": "Finition"}],
     "features": ["contenants_cru_cuit", "vitrine"]}'::jsonb),
  ('viennoiserie', 'boulangerie', 'Viennoiserie', 'Croissants, pains au chocolat, brioches.', 30,
   '{"workshop": {"code": "viennoiserie", "label": "Viennoiserie", "aliases": ["viennoiserie"]},
     "step_types": [{"code": "tourage", "label": "Tourage"}, {"code": "appret", "label": "Apprêt"}],
     "features": ["mode_fournee", "lot_thermal"]}'::jsonb),
  ('biscuiterie', 'boulangerie', 'Biscuiterie', 'Biscuits, sablés, gâteaux secs.', 40,
   '{"workshop": {"code": "biscuiterie", "label": "Biscuiterie", "aliases": ["biscuiterie"]},
     "step_types": [{"code": "cuisson", "label": "Cuisson"}], "features": ["mode_fournee"]}'::jsonb),
  ('traiteur_sale', 'boulangerie', 'Traiteur et salé', 'Pizzas, quiches, sandwichs, plats traiteur.', 50,
   '{"workshop": {"code": "sale", "label": "Salé / Traiteur", "aliases": ["sale", "traiteur", "beldi_sale"]},
     "step_types": [{"code": "assemblage", "label": "Assemblage"}], "features": ["ccp_cuisson"]}'::jsonb),
  ('beldi', 'boulangerie', 'Beldi et spécialités', 'Spécialités traditionnelles.', 60,
   '{"workshop": {"code": "beldi", "label": "Beldi", "aliases": ["beldi", "beldi_sale"]},
     "step_types": [], "features": []}'::jsonb),
  ('chocolaterie', 'boulangerie', 'Chocolaterie et confiserie', 'Bonbons, tablettes, confiseries.', 70,
   '{"workshop": {"code": "chocolaterie", "label": "Chocolaterie", "aliases": ["chocolaterie", "confiserie"]},
     "step_types": [{"code": "temperage", "label": "Tempérage"}, {"code": "moulage", "label": "Moulage"}],
     "features": []}'::jsonb)
ON CONFLICT (code) DO NOTHING;

-- Société existante : une spécialisation dont l'atelier existe déjà est active (rien n'est créé).
INSERT INTO company_specializations (code)
SELECT s.code FROM sector_specializations s
 WHERE EXISTS (
   SELECT 1 FROM production_workshops w
    WHERE w.is_active AND w.code IN (SELECT jsonb_array_elements_text(s.content->'workshop'->'aliases')))
ON CONFLICT (code) DO NOTHING;
