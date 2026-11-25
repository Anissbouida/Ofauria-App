-- Lot 11 (assistant multisectoriel) : modèles de rôles par secteur et spécialité.
-- Additif : aucun rôle existant n'est modifié. L'assistant crée, à la publication,
-- les rôles retenus qui n'existent pas encore (roles + role_permissions).
--
-- permissions : [{ module, rights ('v'iew 'c'reate 'e'dit 'd'elete), scope ('own'|'store'|'all'), verbs [] }]
-- requires_modules : le modèle n'est proposé que si ces modules sont retenus.
-- sector_code NULL = socle commun ; sinon proposé pour ce profil et ses descendants.
CREATE TABLE IF NOT EXISTS sector_role_templates (
  id                  serial PRIMARY KEY,
  sector_code         varchar(40) REFERENCES sector_packs(code) ON DELETE CASCADE,
  specialization_code varchar(40) REFERENCES sector_specializations(code) ON DELETE CASCADE,
  code                varchar(30) NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{1,29}$'),
  label               varchar(60) NOT NULL,
  description         text,
  base_role           varchar(30) NOT NULL REFERENCES roles(code) ON UPDATE CASCADE,
  requires_modules    text[] NOT NULL DEFAULT '{}',
  permissions         jsonb NOT NULL CHECK (jsonb_typeof(permissions) = 'array'),
  home_route          varchar(80),
  sort_order          integer NOT NULL DEFAULT 100,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sector_role_templates_code ON sector_role_templates(code);

-- Le rôle de base doit être un rôle système autre qu'administrateur : un modèle ne
-- peut jamais créer un administrateur.
CREATE OR REPLACE FUNCTION fn_check_role_template_base() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.base_role = 'admin' OR NOT EXISTS (SELECT 1 FROM roles r WHERE r.code = NEW.base_role AND r.is_system) THEN
    RAISE EXCEPTION 'Rôle de base invalide pour un modèle : %', NEW.base_role USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_check_role_template_base ON sector_role_templates;
CREATE TRIGGER trg_check_role_template_base BEFORE INSERT OR UPDATE OF base_role ON sector_role_templates
  FOR EACH ROW EXECUTE FUNCTION fn_check_role_template_base();

-- Modèles livrés. Une base où un rôle de base système manque (installation ancienne)
-- ignore simplement le modèle concerné.
INSERT INTO sector_role_templates (sector_code, specialization_code, code, label, description, base_role, requires_modules, permissions, home_route, sort_order)
SELECT t.sector_code, t.spec, t.code, t.label, t.description, t.base_role, t.requires, t.perms::jsonb, t.home, t.sort
FROM (VALUES
  (NULL::varchar, NULL::varchar, 'direction', 'Direction', 'Consulte toute l''activité, approuve les achats et comptabilise ; ne saisit pas.', 'manager', '{}'::text[],
   '[{"module":"dashboard","rights":"v","scope":"all"},{"module":"reports","rights":"v","scope":"all"},{"module":"sales","rights":"v","scope":"all"},{"module":"orders","rights":"v","scope":"all"},{"module":"customers","rights":"v","scope":"all"},{"module":"purchasing","rights":"v","scope":"all","verbs":["approve"]},{"module":"stock","rights":"v","scope":"all"},{"module":"production","rights":"v","scope":"all"},{"module":"accounting","rights":"v","scope":"all","verbs":["post"]},{"module":"employees","rights":"v","scope":"all"},{"module":"projects","rights":"v","scope":"all"}]',
   '/', 10),
  (NULL, NULL, 'comptable', 'Comptable', 'Saisit les pièces comptables ; la comptabilisation reste à la direction.', 'manager', '{accounting}',
   '[{"module":"accounting","rights":"vce","scope":"all"},{"module":"purchasing","rights":"v","scope":"all"},{"module":"sales","rights":"v","scope":"all"},{"module":"reports","rights":"v","scope":"all"}]',
   '/accounting', 20),
  (NULL, NULL, 'resp_achats', 'Responsable des achats', 'Prépare et suit les commandes fournisseurs ; l''approbation reste séparée.', 'manager', '{purchasing}',
   '[{"module":"purchasing","rights":"vce","scope":"all"},{"module":"stock","rights":"v","scope":"all"},{"module":"products","rights":"v","scope":"all"}]',
   '/purchasing', 30),
  (NULL, NULL, 'magasinier', 'Magasinier', 'Réceptions, mouvements et inventaires de son établissement.', 'magasinier', '{stock}',
   '[{"module":"stock","rights":"vce","scope":"store"},{"module":"purchasing","rights":"v","scope":"store"},{"module":"products","rights":"v","scope":"all"}]',
   '/stock', 40),
  (NULL, NULL, 'cashier', 'Caissier', 'Encaisse au point de vente de son établissement.', 'cashier', '{pos}',
   '[{"module":"pos","rights":"vc","scope":"store"},{"module":"customers","rights":"vc","scope":"store"},{"module":"products","rights":"v","scope":"all"}]',
   '/pos', 50),
  (NULL, NULL, 'commercial', 'Commercial', 'Devis, commandes et suivi de ses clients.', 'manager', '{sales}',
   '[{"module":"sales","rights":"vce","scope":"own"},{"module":"orders","rights":"vce","scope":"own"},{"module":"customers","rights":"vce","scope":"own"},{"module":"crm","rights":"vce","scope":"own"},{"module":"products","rights":"v","scope":"all"}]',
   '/sales', 60),
  (NULL, NULL, 'responsable_production', 'Responsable de production', 'Planifie, lance et clôture la production ; gère les fiches techniques.', 'manager', '{production}',
   '[{"module":"production","rights":"vce","scope":"all"},{"module":"recipes","rights":"vce","scope":"all"},{"module":"stock","rights":"v","scope":"all"},{"module":"products","rights":"v","scope":"all"},{"module":"controle","rights":"v","scope":"all"}]',
   '/production', 70),
  (NULL, NULL, 'operateur_production', 'Opérateur de production', 'Exécute les ordres de son atelier.', 'baker', '{production}',
   '[{"module":"production","rights":"ve","scope":"store"},{"module":"recipes","rights":"v","scope":"all"}]',
   '/production', 80),
  (NULL, NULL, 'controleur_qualite', 'Contrôleur qualité', 'Contrôles, non-conformités et libération des lots.', 'manager', '{controle}',
   '[{"module":"controle","rights":"vce","scope":"all"},{"module":"production","rights":"v","scope":"all"},{"module":"stock","rights":"v","scope":"all"}]',
   '/controle', 90),
  (NULL, NULL, 'technicien_maintenance', 'Technicien de maintenance', 'Interventions et entretien des équipements de son établissement.', 'manager', '{maintenance}',
   '[{"module":"maintenance","rights":"vce","scope":"store"}]',
   '/maintenance', 100),
  (NULL, NULL, 'chef_projet', 'Chef de projet', 'Pilote ses projets, temps et coûts.', 'manager', '{projects}',
   '[{"module":"projects","rights":"vce","scope":"own"},{"module":"customers","rights":"v","scope":"all"}]',
   '/projects', 110),
  (NULL, NULL, 'resp_rh', 'Responsable RH', 'Dossiers du personnel, pointage et paie.', 'manager', '{employees}',
   '[{"module":"employees","rights":"vce","scope":"all"}]',
   '/employees', 120),
  ('boulangerie', NULL, 'saleswoman', 'Vendeuse', 'Vente au comptoir, commandes clients et invendus.', 'saleswoman', '{pos}',
   '[{"module":"pos","rights":"vc","scope":"store"},{"module":"orders","rights":"vc","scope":"store"},{"module":"unsold","rights":"vc","scope":"store"},{"module":"customers","rights":"vc","scope":"store"}]',
   '/pos', 200),
  ('boulangerie', 'patisserie', 'pastry_chef', 'Pâtissier', 'Production pâtissière de son atelier.', 'pastry_chef', '{production}',
   '[{"module":"production","rights":"ve","scope":"store"},{"module":"recipes","rights":"v","scope":"all"}]',
   '/production', 210),
  ('fabrication', NULL, 'planificateur', 'Planificateur de production', 'Plan directeur, besoins nets et réapprovisionnement.', 'manager', '{production}',
   '[{"module":"production","rights":"vce","scope":"all"},{"module":"replenishment","rights":"vc","scope":"all"},{"module":"stock","rights":"v","scope":"all"}]',
   '/production', 220),
  ('negoce', NULL, 'preparateur', 'Préparateur de commandes', 'Préparation et expédition des commandes de son établissement.', 'magasinier', '{stock}',
   '[{"module":"stock","rights":"ve","scope":"store"},{"module":"orders","rights":"v","scope":"store"}]',
   '/stock', 230),
  ('agroalimentaire', NULL, 'resp_qualite', 'Responsable qualité', 'Plans de contrôle, HACCP, traçabilité et rappels de lots.', 'manager', '{controle}',
   '[{"module":"controle","rights":"vced","scope":"all"},{"module":"production","rights":"v","scope":"all"},{"module":"stock","rights":"v","scope":"all"}]',
   '/controle', 240)
) AS t(sector_code, spec, code, label, description, base_role, requires, perms, home, sort)
WHERE EXISTS (SELECT 1 FROM roles r WHERE r.code = t.base_role AND r.is_system)
  AND (t.sector_code IS NULL OR EXISTS (SELECT 1 FROM sector_packs s WHERE s.code = t.sector_code))
  AND (t.spec IS NULL OR EXISTS (SELECT 1 FROM sector_specializations s WHERE s.code = t.spec))
ON CONFLICT (code) DO NOTHING;
