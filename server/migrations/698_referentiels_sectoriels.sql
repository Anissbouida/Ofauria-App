-- Référentiels pilotés par le secteur d'activité (architecture à trois niveaux).
--
-- Constat : les valeurs des référentiels (familles de matières, fonctions, équipements,
-- étapes…) étaient posées par les migrations pour TOUTE société, sans lien avec le secteur.
-- Une société configurée « Bâtiment et travaux publics » voyait donc Farines, Sucres,
-- Boulanger, Pétrin…
--
-- Modèle :
--   * commun       — sectors et specializations vides : valable pour tous ;
--   * sectoriel    — rattaché à un ou plusieurs profils (hérité par leurs profils enfants)
--                    et/ou à des spécialités ;
--   * personnalisé — créé par la société (origin = 'company'), jamais touché par la
--                    synchronisation.
--   Surcharge : le libellé d'une valeur livrée se modifie ; system_label garde l'original.
--   Activation : 'auto' suit le secteur ; 'forced_on' / 'forced_off' = choix de la société.
--
-- La colonne lue par tous les écrans reste is_active : la synchronisation
-- (fn_ref_sync_sectors, déclenchée à chaque changement de secteur ou de spécialité) la met
-- à jour. Aucun écran n'a donc à connaître le secteur. Une valeur déjà utilisée par des
-- données n'est jamais désactivée ; rien n'est supprimé (les libellés historiques restent
-- lisibles).

-- ─── 1. Colonnes de portée ────────────────────────────────────────────────────────────
ALTER TABLE ref_tables
  ADD COLUMN IF NOT EXISTS module          text,
  ADD COLUMN IF NOT EXISTS sectors         text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS label_overrides jsonb  NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN ref_tables.module IS 'Module requis pour que la table soit proposée (NULL = toujours).';
COMMENT ON COLUMN ref_tables.sectors IS 'Profils pour lesquels la table a un sens (vide = tous).';
COMMENT ON COLUMN ref_tables.label_overrides IS 'Libellé/description par profil : {"btp": {"label": "…", "description": "…"}}.';

ALTER TABLE ref_entries
  ADD COLUMN IF NOT EXISTS sectors         text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS specializations text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS origin          text   NOT NULL DEFAULT 'company',
  ADD COLUMN IF NOT EXISTS activation      text   NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS system_label    text,
  ADD COLUMN IF NOT EXISTS catalog_version integer NOT NULL DEFAULT 1;
DO $$ BEGIN
  ALTER TABLE ref_entries ADD CONSTRAINT chk_ref_entries_origin CHECK (origin IN ('system', 'company'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE ref_entries ADD CONSTRAINT chk_ref_entries_activation CHECK (activation IN ('auto', 'forced_on', 'forced_off'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_ref_entries_sectors ON ref_entries USING gin (sectors);

-- Tables natives qui portent aussi des valeurs propres à un métier.
ALTER TABLE expense_categories
  ADD COLUMN IF NOT EXISTS sectors    text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS activation text   NOT NULL DEFAULT 'auto';
ALTER TABLE revenue_categories
  ADD COLUMN IF NOT EXISTS sectors    text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS activation text   NOT NULL DEFAULT 'auto';
ALTER TABLE recipe_categories
  ADD COLUMN IF NOT EXISTS is_active  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sectors    text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS activation text    NOT NULL DEFAULT 'auto';

-- Existant : tout ce qui est déjà là est réputé livré ; ce qui était désactivé à la main le reste.
UPDATE ref_entries SET activation = 'forced_off' WHERE NOT is_active AND activation = 'auto' AND system_label IS NULL;
UPDATE ref_entries SET origin = 'system', system_label = label WHERE system_label IS NULL;
UPDATE expense_categories SET activation = 'forced_off' WHERE NOT is_active AND activation = 'auto';
UPDATE revenue_categories SET activation = 'forced_off' WHERE NOT is_active AND activation = 'auto';

-- ─── 2. Journal des synchronisations (versionnement des activations) ──────────────────
CREATE TABLE IF NOT EXISTS ref_sector_sync_log (
  id              bigserial PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),
  user_id         uuid,
  reason          text NOT NULL,
  sectors         text[] NOT NULL,
  specializations text[] NOT NULL,
  activated       integer NOT NULL DEFAULT 0,
  deactivated     integer NOT NULL DEFAULT 0,
  kept_in_use     integer NOT NULL DEFAULT 0,
  details         jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Colonnes « code » (non clés étrangères) qui utilisent une valeur de référentiel : sert à
-- ne jamais désactiver une valeur portée par des données. Extensible sans code.
CREATE TABLE IF NOT EXISTS ref_usage_sources (
  table_id      varchar(60) NOT NULL REFERENCES ref_tables(id) ON DELETE CASCADE,
  source_table  text NOT NULL,
  source_column text NOT NULL,
  PRIMARY KEY (table_id, source_table, source_column)
);
INSERT INTO ref_usage_sources (table_id, source_table, source_column)
SELECT v.t, v.st, v.sc FROM (VALUES
  ('units', 'ingredients', 'unit'), ('units', 'packaging_items', 'unit'), ('units', 'recipe_ingredients', 'unit'),
  ('units', 'purchase_requests', 'unit'), ('units', 'rfq_items', 'unit'), ('units', 'sale_items', 'unit'),
  ('units', 'recipe_packaging', 'unit'), ('units', 'semi_finished_stock', 'unit'),
  ('yield_units', 'recipes', 'yield_unit'),
  ('ingredient_categories', 'ingredients', 'category'),
  ('packaging_categories', 'packaging_items', 'category'),
  ('employee_roles', 'employees', 'role'),
  ('production_step_types', 'production_item_etapes', 'type_etape'),
  ('production_step_types', 'quality_control_plan_lines', 'step_type_code'),
  ('production_equipment_types', 'production_equipements', 'type'),
  ('process_reading_params', 'production_step_readings', 'parametre'),
  ('process_reading_params', 'quality_control_plan_lines', 'reading_param'),
  ('component_roles', 'recipe_components', 'role'), ('component_roles', 'recipe_format_components', 'role'),
  ('type_decoupe', 'production_contenants', 'type_decoupe'),
  ('production_launch_units', 'production_contenants', 'unite_lancement'),
  ('production_types', 'production_contenants', 'type_production'),
  ('product_sale_units', 'products', 'sale_unit'),
  ('project_activity_types', 'production_plan_activity', 'activity_type')
) v(t, st, sc)
WHERE EXISTS (SELECT 1 FROM ref_tables rt WHERE rt.id = v.t)
ON CONFLICT DO NOTHING;

-- ─── 3. Fonctions ─────────────────────────────────────────────────────────────────────
-- Profils donnés + tous leurs parents (base_sector), sans doublon.
CREATE OR REPLACE FUNCTION fn_sector_lineage(p_codes text[]) RETURNS text[] LANGUAGE sql STABLE AS $$
  WITH RECURSIVE l(code, depth) AS (
    SELECT c, 0 FROM unnest(p_codes) c
    UNION
    SELECT sp.base_sector::text, l.depth + 1 FROM l JOIN sector_packs sp ON sp.code = l.code
     WHERE sp.base_sector IS NOT NULL AND l.depth < 8
  )
  SELECT COALESCE(array_agg(DISTINCT code ORDER BY code), '{}') FROM l WHERE code IS NOT NULL;
$$;

-- Lignée des secteurs actifs de la société (principal + secondaires + parents).
CREATE OR REPLACE FUNCTION fn_active_sector_lineage() RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT fn_sector_lineage(COALESCE(
    NULLIF((SELECT array_agg(sector_code::text) FROM company_sectors), '{}'),
    (SELECT array_agg(sector_pack::text) FROM company_settings WHERE id = 1 AND sector_pack IS NOT NULL),
    '{}'));
$$;

-- Spécialités actives qui relèvent des profils de la société. Une spécialité restée cochée
-- après un changement de secteur (elle n'est jamais supprimée) ne compte plus.
CREATE OR REPLACE FUNCTION fn_active_specializations() RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT COALESCE(array_agg(c.code::text ORDER BY c.code), '{}')
    FROM company_specializations c
    JOIN sector_specializations s ON s.code = c.code
   WHERE s.sector_pack = ANY(fn_active_sector_lineage());
$$;

-- Une valeur s'applique si elle est commune, ou rattachée à un profil de la lignée, ou à
-- une spécialité active.
CREATE OR REPLACE FUNCTION fn_ref_applicable(p_sectors text[], p_specs text[], p_lineage text[], p_active_specs text[])
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT (cardinality(p_sectors) = 0 AND cardinality(p_specs) = 0)
      OR p_sectors && p_lineage
      OR p_specs && p_active_specs;
$$;

-- Identifiants de p_ids référencés par une clé étrangère vers p_target (hors auto-référence).
CREATE OR REPLACE FUNCTION fn_ref_fk_used_ids(p_target regclass, p_ids uuid[]) RETURNS uuid[] LANGUAGE plpgsql AS $$
DECLARE
  r record;
  v_used uuid[] := '{}';
  v_hit uuid[];
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN RETURN v_used; END IF;
  FOR r IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f' AND c.confrelid = p_target AND c.conrelid <> p_target AND cardinality(c.conkey) = 1
  LOOP
    EXECUTE format('SELECT COALESCE(array_agg(DISTINCT %I), ''{}'') FROM %s WHERE %I = ANY($1)', r.col, r.tbl, r.col)
      INTO v_hit USING p_ids;
    v_used := v_used || v_hit;
  END LOOP;
  RETURN v_used;
END $$;

-- Valeurs de ref_entries (parmi p_ids) portées par des données : clé étrangère, colonne
-- « code » déclarée dans ref_usage_sources, ou catégorie de dépense miroir utilisée.
CREATE OR REPLACE FUNCTION fn_ref_entries_in_use(p_ids uuid[]) RETURNS uuid[] LANGUAGE plpgsql AS $$
DECLARE
  r record;
  v_used uuid[];
  v_hit uuid[];
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN RETURN '{}'; END IF;
  v_used := fn_ref_fk_used_ids('ref_entries'::regclass, p_ids);
  FOR r IN
    SELECT s.table_id, s.source_table, s.source_column
      FROM ref_usage_sources s
     WHERE EXISTS (SELECT 1 FROM ref_entries re WHERE re.id = ANY(p_ids) AND re.table_id = s.table_id)
       AND EXISTS (SELECT 1 FROM information_schema.columns c
                    WHERE c.table_schema = 'public' AND c.table_name = s.source_table AND c.column_name = s.source_column)
  LOOP
    EXECUTE format(
      'SELECT COALESCE(array_agg(re.id), ''{}'') FROM ref_entries re
        WHERE re.id = ANY($1) AND re.table_id = $2 AND re.code IS NOT NULL
          AND EXISTS (SELECT 1 FROM %I t WHERE t.%I::text = re.code)', r.source_table, r.source_column)
      INTO v_hit USING p_ids, r.table_id;
    v_used := v_used || v_hit;
  END LOOP;
  -- Familles miroir (ingredient_categories, packaging_categories → expense_categories).
  SELECT COALESCE(array_agg(re.id), '{}') INTO v_hit
    FROM ref_entries re
    JOIN expense_categories ec ON ec.ref_table_id = re.table_id AND ec.code = re.code
   WHERE re.id = ANY(p_ids)
     AND ec.id = ANY(fn_ref_fk_used_ids('expense_categories'::regclass,
           ARRAY(SELECT ec2.id FROM expense_categories ec2 JOIN ref_entries re2
                   ON ec2.ref_table_id = re2.table_id AND ec2.code = re2.code WHERE re2.id = ANY(p_ids))));
  RETURN v_used || v_hit;
END $$;

-- Synchronisation : aligne is_active des valeurs « auto » sur le secteur et les spécialités
-- actifs. Idempotente. Renvoie le bilan ; journalise s'il y a eu un changement.
CREATE OR REPLACE FUNCTION fn_ref_sync_sectors(p_reason text DEFAULT 'manual') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_lineage text[] := fn_active_sector_lineage();
  v_specs   text[] := fn_active_specializations();
  v_cand    uuid[];
  v_used    uuid[];
  v_on      jsonb := '[]'::jsonb;
  v_off     jsonb := '[]'::jsonb;
  v_kept    jsonb := '[]'::jsonb;
  v_n       integer;
  v_native  integer := 0;
BEGIN
  -- Aucun secteur connu (base en cours d'installation) : ne rien toucher.
  IF cardinality(v_lineage) = 0 THEN
    RETURN jsonb_build_object('activated', 0, 'deactivated', 0, 'kept_in_use', 0, 'skipped', true);
  END IF;

  -- a) ref_entries : désactivation de ce qui ne s'applique plus, sauf valeurs utilisées.
  SELECT COALESCE(array_agg(id), '{}') INTO v_cand FROM ref_entries
   WHERE activation = 'auto' AND is_active AND NOT fn_ref_applicable(sectors, specializations, v_lineage, v_specs);
  v_used := fn_ref_entries_in_use(v_cand);
  SELECT COALESCE(jsonb_agg(table_id || ':' || COALESCE(code, id::text) ORDER BY table_id, code), '[]'::jsonb) INTO v_kept
    FROM ref_entries WHERE id = ANY(v_used);
  WITH u AS (
    UPDATE ref_entries SET is_active = false, updated_at = now()
     WHERE id = ANY(v_cand) AND NOT (id = ANY(v_used)) RETURNING table_id, code, id)
  SELECT COALESCE(jsonb_agg(table_id || ':' || COALESCE(code, id::text) ORDER BY table_id, code), '[]'::jsonb) INTO v_off FROM u;
  -- b) activation de ce qui s'applique désormais.
  WITH u AS (
    UPDATE ref_entries SET is_active = true, updated_at = now()
     WHERE activation = 'auto' AND NOT is_active AND fn_ref_applicable(sectors, specializations, v_lineage, v_specs)
     RETURNING table_id, code, id)
  SELECT COALESCE(jsonb_agg(table_id || ':' || COALESCE(code, id::text) ORDER BY table_id, code), '[]'::jsonb) INTO v_on FROM u;

  -- c) tables natives : seules les lignes rattachées à un profil sont concernées.
  SELECT COALESCE(array_agg(id), '{}') INTO v_cand FROM expense_categories
   WHERE activation = 'auto' AND is_active AND ref_table_id IS NULL AND cardinality(sectors) > 0 AND NOT (sectors && v_lineage);
  v_used := fn_ref_fk_used_ids('expense_categories'::regclass, v_cand);
  UPDATE expense_categories SET is_active = false WHERE id = ANY(v_cand) AND NOT (id = ANY(v_used));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_native := v_native + v_n;
  UPDATE expense_categories SET is_active = true
   WHERE activation = 'auto' AND NOT is_active AND ref_table_id IS NULL AND cardinality(sectors) > 0 AND sectors && v_lineage;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_native := v_native + v_n;

  UPDATE revenue_categories SET is_active = (sectors && v_lineage)
   WHERE activation = 'auto' AND cardinality(sectors) > 0 AND is_active IS DISTINCT FROM (sectors && v_lineage);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_native := v_native + v_n;

  SELECT COALESCE(array_agg(id), '{}') INTO v_cand FROM recipe_categories
   WHERE activation = 'auto' AND is_active AND cardinality(sectors) > 0 AND NOT (sectors && v_lineage);
  v_used := fn_ref_fk_used_ids('recipe_categories'::regclass, v_cand);
  UPDATE recipe_categories SET is_active = false WHERE id = ANY(v_cand) AND NOT (id = ANY(v_used));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_native := v_native + v_n;
  UPDATE recipe_categories SET is_active = true
   WHERE activation = 'auto' AND NOT is_active AND cardinality(sectors) > 0 AND sectors && v_lineage;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_native := v_native + v_n;

  IF jsonb_array_length(v_on) + jsonb_array_length(v_off) + v_native > 0 OR p_reason = 'manual' THEN
    INSERT INTO ref_sector_sync_log (user_id, reason, sectors, specializations, activated, deactivated, kept_in_use, details)
    VALUES (NULLIF(current_setting('app.user_id', true), '')::uuid, p_reason, v_lineage, v_specs,
            jsonb_array_length(v_on), jsonb_array_length(v_off), jsonb_array_length(v_kept),
            jsonb_build_object('activated', v_on, 'deactivated', v_off, 'kept_in_use', v_kept, 'native_changes', v_native));
  END IF;
  RETURN jsonb_build_object('activated', jsonb_array_length(v_on), 'deactivated', jsonb_array_length(v_off),
                            'kept_in_use', jsonb_array_length(v_kept), 'native_changes', v_native,
                            'sectors', to_jsonb(v_lineage), 'specializations', to_jsonb(v_specs));
END $$;

CREATE OR REPLACE FUNCTION trg_ref_sync_sectors() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_ref_sync_sectors(TG_ARGV[0]);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS company_sectors_ref_sync ON company_sectors;
CREATE TRIGGER company_sectors_ref_sync AFTER INSERT OR UPDATE OR DELETE ON company_sectors
  FOR EACH STATEMENT EXECUTE FUNCTION trg_ref_sync_sectors('sector_change');
DROP TRIGGER IF EXISTS company_specializations_ref_sync ON company_specializations;
CREATE TRIGGER company_specializations_ref_sync AFTER INSERT OR DELETE ON company_specializations
  FOR EACH STATEMENT EXECUTE FUNCTION trg_ref_sync_sectors('specialization_change');

-- ─── 4. Rattachement des tables (module, libellés par profil) ─────────────────────────
UPDATE ref_tables SET module = v.m FROM (VALUES
  ('component_roles', 'production'), ('production_step_types', 'production'), ('production_equipment_types', 'production'),
  ('process_reading_params', 'production'), ('type_decoupe', 'production'), ('yield_units', 'production'),
  ('production_types', 'production'), ('production_launch_units', 'production'), ('production_loss_reasons', 'production'),
  ('production_categories', 'production'), ('unsold_destinations', 'unsold'),
  ('absence_reasons', 'employees'), ('employee_roles', 'employees'), ('contract_types', 'employees'), ('leave_types', 'employees'),
  ('crm_sources', 'crm'), ('project_activity_types', 'projects'), ('purchase_reason_codes', 'purchasing'),
  ('nc_causes', 'controle'), ('packaging_categories', 'packaging'),
  ('ingredient_categories', 'stock'), ('container_types', 'stock'), ('material_loss_reasons', 'stock'),
  ('quote_lost_reasons', 'sales'), ('product_sale_types', 'products'), ('product_sale_units', 'products'),
  ('product_categories', 'products')
) v(id, m) WHERE ref_tables.id = v.id;
UPDATE ref_tables SET sectors = '{boulangerie}' WHERE id = 'type_decoupe';

-- Descriptions neutres ; la formulation boulangère passe en libellé du profil.
UPDATE ref_tables SET description = v.d, label_overrides = v.o::jsonb FROM (VALUES
  ('employee_roles', 'Fonctions et métiers des salariés',
   '{"boulangerie": {"description": "Boulanger, pâtissier, vendeuse, caissier…"},
     "btp": {"description": "Conducteur de travaux, chef de chantier, maçon, grutier…"},
     "fabrication": {"description": "Opérateur, chef d''atelier, technicien de maintenance…"},
     "restauration": {"description": "Chef de cuisine, cuisinier, serveur…"},
     "services": {"description": "Consultant, chef de projet, technicien…"},
     "transport": {"description": "Chauffeur, exploitant, cariste…"},
     "sante": {"description": "Pharmacien, préparateur…"},
     "agriculture": {"description": "Chef d''exploitation, ouvrier agricole, tractoriste…"},
     "textile": {"description": "Couturier, coupeur, modéliste…"}}'),
  ('ingredient_categories', 'Familles d''articles achetés et stockés',
   '{"agroalimentaire": {"description": "Farines, sucres, produits laitiers…"},
     "restauration": {"description": "Viandes, légumes, produits laitiers, boissons…"},
     "btp": {"label": "Familles de matériaux", "description": "Ciment, acier, béton, granulats…"},
     "fabrication": {"label": "Familles de matières et composants", "description": "Métaux, plastiques, composants, consommables d''atelier…"},
     "textile": {"label": "Familles de matières et fournitures", "description": "Tissus, fils, mercerie…"},
     "negoce": {"label": "Familles d''articles", "description": "Marchandises et consommables"},
     "commerce_detail": {"label": "Familles d''articles", "description": "Marchandises et consommables"},
     "ecommerce": {"label": "Familles d''articles", "description": "Marchandises et consommables"},
     "services": {"label": "Familles d''articles", "description": "Fournitures, matériel informatique, pièces d''intervention…"},
     "transport": {"label": "Familles d''articles", "description": "Carburants, pièces de rechange, pneumatiques…"},
     "sante": {"label": "Familles d''articles", "description": "Médicaments, parapharmacie, dispositifs médicaux…"},
     "agriculture": {"label": "Familles d''intrants", "description": "Semences, engrais, produits phytosanitaires…"}}'),
  ('production_equipment_types', 'Familles d''équipements et de ressources utilisées pour le coût réel',
   '{"boulangerie": {"description": "Four, pétrin, batteur, laminoir…"},
     "btp": {"label": "Types d''engins et de matériel", "description": "Engins, grues, bétonnières, échafaudages…"},
     "fabrication": {"description": "Machine, poste manuel, outillage…"}}'),
  ('production_step_types', 'Étapes des fiches techniques et des plans. « CCP » : l''étape ne se clôture pas sans relevé.',
   '{"boulangerie": {"description": "Pétrissage, façonnage, cuisson… « CCP » : l''étape ne se clôture pas sans relevé."},
     "fabrication": {"description": "Préparation, usinage, assemblage, contrôle… « CCP » : l''étape ne se clôture pas sans relevé."},
     "btp": {"label": "Phases de travaux", "description": "Terrassement, fondations, structure, réception…"}}'),
  ('packaging_categories', 'Familles d''emballages', '{"boulangerie": {"description": "Boîtes, sacs, étiquettes, papier boulanger, ficelles et rubans…"}}'),
  ('production_categories', 'Familles de fabrication des fiches techniques', '{"boulangerie": {"description": "Boulangerie, viennoiserie, pâtisserie…"}}'),
  ('component_roles', 'Rôles d''un composant dans une nomenclature', '{"boulangerie": {"description": "Fond, garniture, nappage…"}}'),
  ('production_types', 'Façon de produire un contenant ou un format', '{"boulangerie": {"description": "Moule, entremets, pièces, pétrissage…"}}'),
  ('production_launch_units', 'Unité dans laquelle on lance une fabrication. « poids » : calcul au poids.', '{"boulangerie": {"description": "Cadre, moule, fournée, lot, kg… « poids » : calcul au poids."}}'),
  ('units', 'Unités de mesure des articles et des quantités',
   '{"agroalimentaire": {"description": "Gramme, kilogramme, litre, pièce…"}, "btp": {"description": "Mètre, m², m³, tonne, forfait…"}}')
) v(id, d, o) WHERE ref_tables.id = v.id;

-- ─── 5. Étiquetage de l'existant (valeurs boulangères / alimentaires) ─────────────────
-- La boulangerie hérite de l'agroalimentaire : une valeur « agroalimentaire » lui reste acquise.
UPDATE ref_entries SET sectors = '{agroalimentaire,restauration}'
 WHERE cardinality(sectors) = 0 AND (
   (table_id = 'ingredient_categories' AND code <> 'autre')
   OR (table_id = 'production_step_types' AND code IN ('cuisson', 'refroidissement'))
   OR (table_id = 'production_equipment_types' AND code IN ('four', 'batteur', 'surgele', 'frigo'))
   OR (table_id = 'process_reading_params' AND code IN ('temp_four', 'duree_cuisson', 'temp_coeur'))
   OR (table_id = 'product_sale_units' AND code = 'person'));
UPDATE ref_entries SET sectors = '{boulangerie}'
 WHERE cardinality(sectors) = 0 AND (
   (table_id = 'employee_roles' AND code IN ('baker', 'pastry_chef', 'viennoiserie', 'beldi_sale'))
   OR (table_id = 'production_step_types' AND code IN ('petrissage', 'pointage', 'faconnage', 'tourage', 'appret'))
   OR (table_id = 'production_equipment_types' AND code IN ('petrin', 'laminoir'))
   OR (table_id = 'process_reading_params' AND code = 'temp_pate')
   OR (table_id = 'type_decoupe' AND code <> 'sans_decoupe')
   OR (table_id = 'yield_units' AND code IN ('moule', 'plaque', 'batch'))
   OR (table_id = 'production_types' AND code IN ('1', '2', '3', '4', '5'))
   OR (table_id = 'production_launch_units' AND code IN ('cadre', 'moule', 'cercle', 'fournee', 'kg_pate'))
   OR (table_id = 'packaging_categories' AND code IN ('papier_boulanger', 'ficelles_rubans')));
UPDATE ref_entries SET sectors = '{boulangerie,commerce_detail}'
 WHERE cardinality(sectors) = 0 AND table_id = 'employee_roles' AND code = 'saleswoman';
UPDATE ref_entries SET sectors = '{agroalimentaire,restauration,commerce_detail}'
 WHERE cardinality(sectors) = 0 AND table_id = 'production_equipment_types' AND code = 'vitrine';

-- Rôles de composant : l'ancien filtre metadata.sectors (M8-06) devient la colonne commune.
UPDATE ref_entries SET sectors = ARRAY(SELECT jsonb_array_elements_text(metadata->'sectors'))
 WHERE table_id = 'component_roles' AND jsonb_typeof(metadata->'sectors') = 'array' AND cardinality(sectors) = 0;
UPDATE ref_entries SET sectors = '{fabrication,generique,negoce,textile,btp,agriculture,transport,services,sante,commerce_detail,ecommerce}'
 WHERE table_id = 'component_roles' AND code IN ('matiere', 'composant', 'sous_ensemble', 'consommable', 'accessoire');

-- Tables natives.
UPDATE expense_categories SET sectors = '{boulangerie}' WHERE cardinality(sectors) = 0 AND ref_table_id IS NULL
   AND name IN ('Fours & Pétrins', 'Ustensiles pâtisserie');
UPDATE expense_categories SET sectors = '{agroalimentaire,restauration,commerce_detail,sante}' WHERE cardinality(sectors) = 0 AND ref_table_id IS NULL
   AND name IN ('Chambre froide & Frigos', 'Vitrines & Présentoirs');
WITH RECURSIVE t AS (
  SELECT id FROM revenue_categories WHERE name IN ('Boulangerie', 'Patisserie', 'Viennoiserie', 'Gateaux sur commande')
  UNION SELECT rc.id FROM revenue_categories rc JOIN t ON rc.parent_id = t.id)
UPDATE revenue_categories SET sectors = '{boulangerie}' WHERE id IN (SELECT id FROM t) AND cardinality(sectors) = 0;
UPDATE recipe_categories SET sectors = '{boulangerie}'
 WHERE cardinality(sectors) = 0 AND code IN ('boulangerie', 'viennoiserie', 'patisserie', 'sale_beldi', 'gateaux_marocains');

-- ─── 6. Catalogue sectoriel ───────────────────────────────────────────────────────────
-- Inséré inactif ; la synchronisation active ce qui correspond au secteur de la société.
-- Aucune valeur nouvelle n'est rattachée à « agroalimentaire » : la boulangerie en hérite et
-- ses listes ne doivent pas changer.
-- Code déjà présent (pack de départ déjà chargé) : seul le rattachement est posé, le
-- libellé et l'état de la société sont conservés.
INSERT INTO ref_entries (table_id, code, label, display_order, metadata, sectors, specializations, origin, is_active, activation, system_label)
SELECT v.t, v.c, v.l, 400 + (row_number() OVER (PARTITION BY v.t))::int * 10, v.m::jsonb, v.s::text[], v.sp::text[], 'system', false, 'auto', v.l
FROM (VALUES
  -- Familles d'articles / de matières
  ('ingredient_categories', 'ciment_liants',        'Ciments & liants',                    '{btp}', '{}', '{}'),
  ('ingredient_categories', 'granulats',            'Granulats (sable, gravier)',          '{btp}', '{}', '{}'),
  ('ingredient_categories', 'beton_mortiers',       'Béton & mortiers',                    '{btp}', '{}', '{}'),
  ('ingredient_categories', 'aciers',               'Aciers & ferraillage',                '{btp}', '{}', '{}'),
  ('ingredient_categories', 'bois_coffrage',        'Bois & coffrage',                     '{btp}', '{}', '{}'),
  ('ingredient_categories', 'briques_blocs',        'Briques, blocs & agglos',             '{btp}', '{}', '{}'),
  ('ingredient_categories', 'etancheite_isolation', 'Étanchéité & isolation',              '{btp}', '{}', '{}'),
  ('ingredient_categories', 'epi',                  'Équipements de protection (EPI)',     '{btp,fabrication,agriculture}', '{}', '{}'),
  ('ingredient_categories', 'quincaillerie',        'Quincaillerie & fixations',           '{btp,fabrication}', '{materiaux_quincaillerie}', '{}'),
  ('ingredient_categories', 'carburants',           'Carburants & lubrifiants',            '{btp,transport,agriculture}', '{}', '{}'),
  ('ingredient_categories', 'peintures_revetements','Peintures & revêtements',             '{}', '{second_oeuvre}', '{}'),
  ('ingredient_categories', 'electricite',          'Matériel électrique',                 '{}', '{second_oeuvre}', '{}'),
  ('ingredient_categories', 'plomberie',            'Plomberie & sanitaire',               '{}', '{second_oeuvre}', '{}'),
  ('ingredient_categories', 'menuiserie',           'Menuiserie & vitrerie',               '{}', '{second_oeuvre}', '{}'),
  ('ingredient_categories', 'carrelage',            'Carrelage & faïence',                 '{}', '{second_oeuvre}', '{}'),
  ('ingredient_categories', 'enrobes',              'Enrobés & bitume',                    '{}', '{travaux_publics}', '{}'),
  ('ingredient_categories', 'tuyaux_reseaux',       'Tuyaux & réseaux',                    '{}', '{travaux_publics}', '{}'),
  ('ingredient_categories', 'metaux',               'Métaux & tôles',                      '{fabrication}', '{}', '{}'),
  ('ingredient_categories', 'plastiques',           'Plastiques & polymères',              '{fabrication}', '{}', '{}'),
  ('ingredient_categories', 'composants',           'Composants & pièces détachées',       '{fabrication}', '{}', '{}'),
  ('ingredient_categories', 'consommables_atelier', 'Consommables d''atelier',             '{fabrication,textile}', '{}', '{}'),
  ('ingredient_categories', 'traitements_surface',  'Peintures & traitements de surface',  '{fabrication}', '{}', '{}'),
  ('ingredient_categories', 'tissus',               'Tissus',                              '{textile}', '{}', '{}'),
  ('ingredient_categories', 'fils',                 'Fils',                                '{textile}', '{}', '{}'),
  ('ingredient_categories', 'mercerie',             'Mercerie & accessoires',              '{textile}', '{}', '{}'),
  ('ingredient_categories', 'teintures',            'Teintures & produits de finition',    '{textile}', '{}', '{}'),
  ('ingredient_categories', 'marchandises',         'Marchandises',                        '{negoce,commerce_detail,ecommerce}', '{}', '{}'),
  ('ingredient_categories', 'produits_alimentaires','Produits alimentaires',               '{}', '{gros_alimentaire,alimentation_generale}', '{}'),
  ('ingredient_categories', 'droguerie',            'Droguerie & entretien',               '{commerce_detail}', '{gros_alimentaire,equipement_maison}', '{}'),
  ('ingredient_categories', 'boissons',             'Boissons',                            '{restauration}', '{boissons,gros_alimentaire,alimentation_generale}', '{}'),
  ('ingredient_categories', 'hygiene_entretien',    'Produits d''hygiène & d''entretien',  '{restauration,sante}', '{}', '{}'),
  ('ingredient_categories', 'semences',             'Semences & plants',                   '{agriculture}', '{}', '{}'),
  ('ingredient_categories', 'engrais',              'Engrais & amendements',               '{agriculture}', '{}', '{}'),
  ('ingredient_categories', 'phytosanitaires',      'Produits phytosanitaires',            '{agriculture}', '{}', '{}'),
  ('ingredient_categories', 'irrigation',           'Matériel d''irrigation',              '{agriculture}', '{}', '{}'),
  ('ingredient_categories', 'aliments_betail',      'Aliments du bétail',                  '{}', '{elevage}', '{}'),
  ('ingredient_categories', 'produits_veterinaires','Produits vétérinaires',               '{}', '{elevage}', '{}'),
  ('ingredient_categories', 'pieces_rechange',      'Pièces de rechange',                  '{transport,fabrication,btp,agriculture}', '{maintenance_interventions}', '{}'),
  ('ingredient_categories', 'pneumatiques',         'Pneumatiques',                        '{transport}', '{}', '{}'),
  ('ingredient_categories', 'palettes_emballages',  'Palettes & emballages de transport',  '{transport,negoce}', '{}', '{}'),
  ('ingredient_categories', 'fournitures_bureau',   'Fournitures de bureau',               '{services}', '{}', '{}'),
  ('ingredient_categories', 'materiel_informatique','Matériel informatique',               '{services,ecommerce}', '{}', '{}'),
  ('ingredient_categories', 'medicaments',          'Médicaments',                         '{sante}', '{}', '{}'),
  ('ingredient_categories', 'parapharmacie',        'Parapharmacie & cosmétique',          '{sante}', '{}', '{}'),
  ('ingredient_categories', 'dispositifs_medicaux', 'Dispositifs médicaux',                '{sante}', '{}', '{}'),
  ('ingredient_categories', 'consommables_medicaux','Consommables médicaux',               '{sante}', '{}', '{}'),

  -- Unités de mesure
  ('units', 'm3',      'Mètre cube',      '{btp,transport,agriculture}', '{}', '{"category":"volume_m3","to_base":1,"is_base":true,"decimals":3,"system":false}'),
  ('units', 't',       'Tonne',           '{btp,transport,agriculture,fabrication,negoce}', '{}', '{"category":"mass","to_base":1000000,"is_base":false,"decimals":3,"system":false}'),
  ('units', 'mlin',    'Mètre linéaire',  '{btp,textile}', '{}', '{"category":"length","to_base":1,"is_base":false,"decimals":2,"system":false}'),
  ('units', 'km',      'Kilomètre',       '{transport}', '{}', '{"category":"length","to_base":1000,"is_base":false,"decimals":1,"system":false}'),
  ('units', 'ha',      'Hectare',         '{agriculture}', '{}', '{"category":"area","to_base":10000,"is_base":false,"decimals":2,"system":false}'),
  ('units', 'q',       'Quintal',         '{agriculture}', '{}', '{"category":"mass","to_base":100000,"is_base":false,"decimals":2,"system":false}'),
  ('units', 'jour',    'Jour',            '{btp,services,transport}', '{}', '{"category":"day","to_base":1,"is_base":true,"decimals":2,"system":false}'),
  ('units', 'forfait', 'Forfait',         '{btp,services,transport}', '{}', '{"category":"lump","to_base":1,"is_base":true,"decimals":2,"system":false}'),
  ('units', 'palette', 'Palette',         '{negoce,transport,ecommerce,fabrication}', '{}', '{"category":"palette","to_base":1,"is_base":true,"decimals":0,"system":false}'),
  ('units', 'carton',  'Carton',          '{negoce,commerce_detail,ecommerce,sante}', '{}', '{"category":"carton","to_base":1,"is_base":true,"decimals":0,"system":false}'),
  ('units', 'colis',   'Colis',           '{transport,ecommerce,negoce}', '{}', '{"category":"colis","to_base":1,"is_base":true,"decimals":0,"system":false}'),
  ('units', 'rouleau', 'Rouleau',         '{textile}', '{second_oeuvre}', '{"category":"rouleau","to_base":1,"is_base":true,"decimals":0,"system":false}'),
  ('units', 'boite',   'Boîte',           '{sante}', '{}', '{"category":"boite","to_base":1,"is_base":true,"decimals":0,"system":false}'),
  ('units', 'sac',     'Sac',             '{btp,agriculture}', '{}', '{"category":"sac","to_base":1,"is_base":true,"decimals":0,"system":false}'),

  -- Fonctions des employés
  ('employee_roles', 'conducteur_travaux',  'Conducteur de travaux',        '{btp}', '{}', '{}'),
  ('employee_roles', 'chef_chantier',       'Chef de chantier',             '{btp}', '{}', '{}'),
  ('employee_roles', 'chef_equipe',         'Chef d''équipe',               '{btp,fabrication,agriculture}', '{}', '{}'),
  ('employee_roles', 'macon',               'Maçon',                        '{btp}', '{}', '{}'),
  ('employee_roles', 'coffreur',            'Coffreur',                     '{btp}', '{}', '{}'),
  ('employee_roles', 'ferrailleur',         'Ferrailleur',                  '{btp}', '{}', '{}'),
  ('employee_roles', 'grutier',             'Grutier',                      '{btp}', '{}', '{}'),
  ('employee_roles', 'conducteur_engins',   'Conducteur d''engins',         '{btp}', '{}', '{}'),
  ('employee_roles', 'metreur',             'Métreur',                      '{btp}', '{}', '{}'),
  ('employee_roles', 'electricien',         'Électricien',                  '{}', '{second_oeuvre,maintenance_interventions}', '{}'),
  ('employee_roles', 'plombier',            'Plombier',                     '{}', '{second_oeuvre,maintenance_interventions}', '{}'),
  ('employee_roles', 'peintre',             'Peintre',                      '{}', '{second_oeuvre}', '{}'),
  ('employee_roles', 'carreleur',           'Carreleur',                    '{}', '{second_oeuvre}', '{}'),
  ('employee_roles', 'operateur',           'Opérateur de production',      '{fabrication,textile}', '{}', '{}'),
  ('employee_roles', 'chef_atelier',        'Chef d''atelier',              '{fabrication,textile}', '{}', '{}'),
  ('employee_roles', 'technicien_maintenance','Technicien de maintenance',  '{fabrication,transport}', '{maintenance_interventions}', '{}'),
  ('employee_roles', 'controleur_qualite',  'Contrôleur qualité',           '{fabrication,textile}', '{}', '{}'),
  ('employee_roles', 'magasinier',          'Magasinier',                   '{fabrication,btp,negoce,transport,textile,commerce_detail,ecommerce,sante,agriculture,restauration}', '{}', '{}'),
  ('employee_roles', 'couturier',           'Couturier',                    '{textile}', '{}', '{}'),
  ('employee_roles', 'coupeur',             'Coupeur',                      '{textile}', '{}', '{}'),
  ('employee_roles', 'modeliste',           'Modéliste',                    '{textile}', '{}', '{}'),
  ('employee_roles', 'commercial',          'Commercial',                   '{negoce,services,ecommerce,fabrication,btp,textile,transport}', '{}', '{}'),
  ('employee_roles', 'vendeur',             'Vendeur',                      '{commerce_detail,negoce}', '{}', '{}'),
  ('employee_roles', 'preparateur_commandes','Préparateur de commandes',    '{negoce,ecommerce,transport}', '{}', '{}'),
  ('employee_roles', 'chauffeur_livreur',   'Chauffeur-livreur',            '{negoce,transport,ecommerce,btp}', '{}', '{}'),
  ('employee_roles', 'chef_cuisine',        'Chef de cuisine',              '{restauration}', '{}', '{}'),
  ('employee_roles', 'cuisinier',           'Cuisinier',                    '{restauration}', '{}', '{}'),
  ('employee_roles', 'commis',              'Commis de cuisine',            '{restauration}', '{}', '{}'),
  ('employee_roles', 'serveur',             'Serveur',                      '{restauration}', '{}', '{}'),
  ('employee_roles', 'plongeur',            'Plongeur',                     '{restauration}', '{}', '{}'),
  ('employee_roles', 'receptionniste',      'Réceptionniste',               '{}', '{hotel}', '{}'),
  ('employee_roles', 'chef_exploitation',   'Chef d''exploitation',         '{agriculture}', '{}', '{}'),
  ('employee_roles', 'ouvrier_agricole',    'Ouvrier agricole',             '{agriculture}', '{}', '{}'),
  ('employee_roles', 'tractoriste',         'Tractoriste',                  '{agriculture}', '{}', '{}'),
  ('employee_roles', 'chauffeur_pl',        'Chauffeur poids lourd',        '{transport}', '{}', '{}'),
  ('employee_roles', 'exploitant_transport','Exploitant transport',         '{transport}', '{}', '{}'),
  ('employee_roles', 'cariste',             'Cariste',                      '{transport,negoce,fabrication}', '{}', '{}'),
  ('employee_roles', 'consultant',          'Consultant',                   '{services}', '{}', '{}'),
  ('employee_roles', 'chef_projet',         'Chef de projet',               '{services,btp}', '{}', '{}'),
  ('employee_roles', 'technicien',          'Technicien',                   '{services}', '{}', '{}'),
  ('employee_roles', 'formateur',           'Formateur',                    '{}', '{formation}', '{}'),
  ('employee_roles', 'assistant_administratif','Assistant administratif',   '{services,btp,transport,sante}', '{}', '{}'),
  ('employee_roles', 'pharmacien',          'Pharmacien',                   '{sante}', '{}', '{}'),
  ('employee_roles', 'preparateur_pharmacie','Préparateur en pharmacie',    '{sante}', '{}', '{}'),
  ('employee_roles', 'gestionnaire_ecommerce','Gestionnaire e-commerce',    '{ecommerce}', '{}', '{}'),
  ('employee_roles', 'service_client',      'Chargé du service client',     '{ecommerce}', '{retours_sav}', '{}'),

  -- Types d'équipement / de ressource
  ('production_equipment_types', 'engin_chantier',   'Engin de chantier',          '{btp}', '{}', '{}'),
  ('production_equipment_types', 'grue',             'Grue',                       '{btp}', '{}', '{}'),
  ('production_equipment_types', 'betonniere',       'Bétonnière',                 '{btp}', '{}', '{}'),
  ('production_equipment_types', 'echafaudage',      'Échafaudage',                '{btp}', '{}', '{}'),
  ('production_equipment_types', 'coffrage',         'Matériel de coffrage',       '{btp}', '{}', '{}'),
  ('production_equipment_types', 'vehicule',         'Véhicule',                   '{btp,transport,negoce,services,agriculture,ecommerce}', '{}', '{}'),
  ('production_equipment_types', 'machine',          'Machine',                    '{fabrication,textile}', '{}', '{}'),
  ('production_equipment_types', 'poste_manuel',     'Poste manuel',               '{fabrication,textile}', '{}', '{}'),
  ('production_equipment_types', 'outillage',        'Outillage',                  '{fabrication,btp,textile,services}', '{}', '{}'),
  ('production_equipment_types', 'machine_coudre',   'Machine à coudre',           '{textile}', '{}', '{}'),
  ('production_equipment_types', 'table_coupe',      'Table de coupe',             '{textile}', '{}', '{}'),
  ('production_equipment_types', 'plaque_cuisson',   'Piano / plaque de cuisson',  '{restauration}', '{}', '{}'),
  ('production_equipment_types', 'tracteur',         'Tracteur',                   '{agriculture}', '{}', '{}'),
  ('production_equipment_types', 'materiel_irrigation','Matériel d''irrigation',   '{agriculture}', '{}', '{}'),
  ('production_equipment_types', 'camion',           'Camion',                     '{transport,btp}', '{}', '{}'),
  ('production_equipment_types', 'chariot_elevateur','Chariot élévateur',          '{transport,negoce,fabrication}', '{}', '{}'),

  -- Types d'étape / phases
  ('production_step_types', 'preparation',     'Préparation',            '{fabrication,textile,restauration}', '{}', '{}'),
  ('production_step_types', 'usinage',         'Usinage',                '{fabrication}', '{}', '{}'),
  ('production_step_types', 'assemblage',      'Assemblage',             '{fabrication,textile}', '{traiteur_sale}', '{}'),
  ('production_step_types', 'controle',        'Contrôle qualité',       '{fabrication,textile}', '{}', '{"default_param":"poids"}'),
  ('production_step_types', 'conditionnement', 'Conditionnement',        '{fabrication,textile,agriculture}', '{}', '{}'),
  ('production_step_types', 'coupe',           'Coupe',                  '{textile}', '{}', '{}'),
  ('production_step_types', 'couture',         'Couture',                '{textile}', '{}', '{}'),
  ('production_step_types', 'repassage',       'Repassage',              '{textile}', '{}', '{}'),
  ('production_step_types', 'terrassement',    'Terrassement',           '{btp}', '{}', '{}'),
  ('production_step_types', 'fondations',      'Fondations',             '{btp}', '{}', '{}'),
  ('production_step_types', 'structure',       'Structure / élévation',  '{btp}', '{}', '{}'),
  ('production_step_types', 'reception_travaux','Réception des travaux', '{btp}', '{}', '{}'),
  ('production_step_types', 'mise_en_place',   'Mise en place',          '{restauration}', '{}', '{}'),
  ('production_step_types', 'dressage',        'Dressage',               '{restauration}', '{}', '{}'),
  ('production_step_types', 'semis',           'Semis / plantation',     '{agriculture}', '{}', '{}'),
  ('production_step_types', 'recolte',         'Récolte',                '{agriculture}', '{}', '{}'),
  ('production_step_types', 'tri_calibrage',   'Tri & calibrage',        '{agriculture}', '{}', '{}'),

  -- Types d'activité des projets
  ('project_activity_types', 'etudes_metres',   'Études & métrés',        '{btp}', '{}', '{}'),
  ('project_activity_types', 'travaux_chantier','Travaux sur chantier',   '{btp}', '{}', '{}'),
  ('project_activity_types', 'suivi_chantier',  'Suivi & coordination de chantier', '{btp}', '{}', '{}'),
  ('project_activity_types', 'conseil',         'Conseil',                '{services}', '{}', '{}'),
  ('project_activity_types', 'intervention',    'Intervention sur site',  '{services}', '{maintenance_interventions}', '{}')
) v(t, c, l, s, sp, m)
WHERE EXISTS (SELECT 1 FROM ref_tables rt WHERE rt.id = v.t)
ON CONFLICT (table_id, code) DO UPDATE
  SET sectors = EXCLUDED.sectors, specializations = EXCLUDED.specializations,
      origin = 'system', system_label = EXCLUDED.system_label;

-- ─── 7. Première synchronisation ──────────────────────────────────────────────────────
-- Boulangerie : aucun changement (toutes ses valeurs restent applicables). Autre secteur :
-- les valeurs boulangères inutilisées se désactivent, celles du secteur s'activent.
SELECT fn_ref_sync_sectors('migration_698');
