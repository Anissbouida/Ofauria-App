-- Référentiels sectoriels, suite (reste à faire de la mig 698, § 5 de AUDIT_REFERENTIELS_SECTORIELS.md).
--
--  1. Exclusions : une valeur peut viser un profil parent tout en étant exclue d'un enfant
--     (« agroalimentaire, sauf boulangerie »). Le profil Agroalimentaire reçoit ainsi ses
--     propres valeurs sans changer les listes de la boulangerie.
--  2. Contenants et équipements livrés : rattachés au secteur, ils ne maintiennent plus actives,
--     hors boulangerie, les valeurs qu'ils utilisent.
--  3. Libellés par secteur des lignes livrées (catégorie « Ingrédients », rôles de base),
--     sans écraser un libellé modifié par la société ; catégories de dépenses du matériel.
--  4. Motifs de perte propres à la vente au comptoir rattachés à leurs secteurs.
--  5. Les contrôles CHECK qui figeaient des listes de valeurs (types de contrat, de congé,
--     d'emplacement) laissent place au référentiel : une valeur ajoutée est acceptée.
--  6. Rôles de base propres à la boulangerie masqués ailleurs (codes inchangés : les gardes
--     de routes ne bougent pas).

-- ─── 1. Exclusions ────────────────────────────────────────────────────────────────────
ALTER TABLE ref_entries ADD COLUMN IF NOT EXISTS excluded_sectors text[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN ref_entries.excluded_sectors IS
  'Profils exclus : une correspondance obtenue par un parent de ces profils ne compte pas pour eux.';

-- Règle d'applicabilité. Une correspondance par le profil s est annulée quand la société a un
-- profil exclu dont s est un ancêtre (ou lui-même) : « agroalimentaire sauf boulangerie » ne
-- s'applique pas à une boulangerie, mais s'applique à une boulangerie qui exerce aussi une
-- activité « fabrication » si la valeur vise aussi la fabrication.
CREATE OR REPLACE FUNCTION fn_ref_applicable(p_sectors text[], p_specs text[], p_excluded text[], p_lineage text[], p_active_specs text[])
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT (cardinality(p_sectors) = 0 AND cardinality(p_specs) = 0 AND NOT (p_excluded && p_lineage))
      OR p_specs && p_active_specs
      OR EXISTS (SELECT 1 FROM unnest(p_sectors) s
                  WHERE s = ANY(p_lineage)
                    AND NOT (p_excluded && p_lineage
                             AND s = ANY(fn_sector_lineage(ARRAY(SELECT unnest(p_excluded) INTERSECT SELECT unnest(p_lineage))))));
$$;

-- ─── 2. Contenants de production ──────────────────────────────────────────────────────
ALTER TABLE production_contenants
  ADD COLUMN IF NOT EXISTS sectors    text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS activation text   NOT NULL DEFAULT 'auto';
UPDATE production_contenants SET activation = 'forced_off' WHERE NOT is_active AND activation = 'auto';
-- Types 1 à 5 : moule/découpe, entremets, pièces, pétrissage, laminage (boulangerie).
UPDATE production_contenants SET sectors = '{boulangerie}' WHERE cardinality(sectors) = 0 AND type_production BETWEEN 1 AND 5;

-- Équipements livrés par la mig 090 pour toute société (fours, pétrin, laminoir…).
ALTER TABLE production_equipements
  ADD COLUMN IF NOT EXISTS sectors    text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS activation text   NOT NULL DEFAULT 'auto';
UPDATE production_equipements SET activation = 'forced_off' WHERE NOT is_active AND activation = 'auto';
UPDATE production_equipements SET sectors = '{boulangerie}'
 WHERE cardinality(sectors) = 0 AND type IN ('four', 'batteur', 'petrin', 'laminoir')
   AND nom IN ('Four patisserie 1', 'Four boulangerie 1', 'Batteur planetaire', 'Petrin spirale', 'Laminoir');
UPDATE production_equipements SET sectors = '{agroalimentaire,restauration}'
 WHERE cardinality(sectors) = 0 AND nom IN ('Frigo positif production', 'Cellule de surgelation');

-- Une ligne de données inactive (contenant retiré, article archivé) ne retient plus une
-- valeur de référentiel : elle reste lisible, elle n'a pas besoin d'être proposée.
CREATE OR REPLACE FUNCTION fn_ref_entries_in_use(p_ids uuid[]) RETURNS uuid[] LANGUAGE plpgsql AS $$
DECLARE
  r record;
  v_used uuid[];
  v_hit uuid[];
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN RETURN '{}'; END IF;
  v_used := fn_ref_fk_used_ids('ref_entries'::regclass, p_ids);
  FOR r IN
    SELECT s.table_id, s.source_table, s.source_column,
           EXISTS (SELECT 1 FROM information_schema.columns c
                    WHERE c.table_schema = 'public' AND c.table_name = s.source_table AND c.column_name = 'is_active') AS has_active
      FROM ref_usage_sources s
     WHERE EXISTS (SELECT 1 FROM ref_entries re WHERE re.id = ANY(p_ids) AND re.table_id = s.table_id)
       AND EXISTS (SELECT 1 FROM information_schema.columns c
                    WHERE c.table_schema = 'public' AND c.table_name = s.source_table AND c.column_name = s.source_column)
  LOOP
    EXECUTE format(
      'SELECT COALESCE(array_agg(re.id), ''{}'') FROM ref_entries re
        WHERE re.id = ANY($1) AND re.table_id = $2 AND re.code IS NOT NULL
          AND EXISTS (SELECT 1 FROM %I t WHERE t.%I::text = re.code %s)',
      r.source_table, r.source_column, CASE WHEN r.has_active THEN 'AND t.is_active IS NOT FALSE' ELSE '' END)
      INTO v_hit USING p_ids, r.table_id;
    v_used := v_used || v_hit;
  END LOOP;
  SELECT COALESCE(array_agg(re.id), '{}') INTO v_hit
    FROM ref_entries re
    JOIN expense_categories ec ON ec.ref_table_id = re.table_id AND ec.code = re.code
   WHERE re.id = ANY(p_ids)
     AND ec.id = ANY(fn_ref_fk_used_ids('expense_categories'::regclass,
           ARRAY(SELECT ec2.id FROM expense_categories ec2 JOIN ref_entries re2
                   ON ec2.ref_table_id = re2.table_id AND ec2.code = re2.code WHERE re2.id = ANY(p_ids))));
  RETURN v_used || v_hit;
END $$;

-- ─── 3. Libellés par secteur des lignes livrées ───────────────────────────────────────
-- Libellé du profil le plus spécifique (principal d'abord, de l'enfant vers le parent) ;
-- clé « * » = tout autre secteur ; NULL si rien ne correspond.
CREATE OR REPLACE FUNCTION fn_sector_text(p_names jsonb) RETURNS text LANGUAGE sql STABLE AS $$
  -- Même repli que fn_active_sector_lineage : pendant un changement de secteur, la ligne
  -- principale de company_sectors est brièvement absente ; le profil de company_settings vaut.
  WITH RECURSIVE base(code, prim) AS (
    SELECT sector_code::text, is_primary FROM company_sectors
    UNION ALL
    SELECT sector_pack::text, true FROM company_settings
     WHERE id = 1 AND sector_pack IS NOT NULL AND NOT EXISTS (SELECT 1 FROM company_sectors WHERE is_primary)),
  l(code, depth, prim) AS (
    SELECT code, 0, prim FROM base
    UNION ALL
    SELECT sp.base_sector::text, l.depth + 1, l.prim FROM l JOIN sector_packs sp ON sp.code = l.code
     WHERE sp.base_sector IS NOT NULL AND l.depth < 8)
  SELECT COALESCE(
    (SELECT p_names->>code FROM l WHERE p_names ? code ORDER BY prim DESC, depth LIMIT 1),
    CASE WHEN EXISTS (SELECT 1 FROM base) THEN p_names->>'*' END);
$$;

ALTER TABLE expense_categories
  ADD COLUMN IF NOT EXISTS system_name  text,
  ADD COLUMN IF NOT EXISTS sector_names jsonb NOT NULL DEFAULT '{}'::jsonb;
UPDATE expense_categories SET system_name = name WHERE system_name IS NULL;

UPDATE expense_categories SET sector_names =
  '{"agroalimentaire": "Ingrédients", "restauration": "Ingrédients", "btp": "Matériaux",
    "fabrication": "Matières et composants", "textile": "Matières et fournitures", "negoce": "Marchandises",
    "commerce_detail": "Marchandises", "ecommerce": "Marchandises", "services": "Fournitures",
    "transport": "Pièces et consommables", "sante": "Produits de santé", "agriculture": "Intrants",
    "*": "Matières et articles"}'::jsonb
 WHERE id = '20000000-0000-0000-0000-000000000004' AND sector_names = '{}'::jsonb;

-- Matériel de cuisine : métiers de bouche, commerce alimentaire, santé (froid).
UPDATE expense_categories SET sectors = '{agroalimentaire,restauration,commerce_detail,sante}'
 WHERE cardinality(sectors) = 0 AND ref_table_id IS NULL
   AND id IN ('30000000-0000-0000-0000-000000000032', '30000000-0000-0000-0000-000000000072');

-- Matériel des autres métiers, sous « Équipements & Matériel » (inactif, la synchronisation
-- active ce qui correspond au secteur).
INSERT INTO expense_categories (name, system_name, type, parent_id, level, display_order, is_active, requires_po, code, sectors)
SELECT 'Matériel de production', 'Matériel de production', 'expense', p.id, 2, 40, false, true, 'materiel_production',
       '{fabrication,textile,btp,agriculture,transport,services,negoce}'
  FROM expense_categories p WHERE p.id = '10000000-0000-0000-0000-000000000008'
ON CONFLICT (parent_id, code) WHERE code IS NOT NULL DO NOTHING;
INSERT INTO expense_categories (name, system_name, type, parent_id, level, display_order, is_active, requires_po, code, sectors)
SELECT v.n, v.n, 'expense', p.id, 3, v.o, false, true, v.c, v.s::text[]
  FROM expense_categories p,
       (VALUES ('Machines & outillage', 10, 'machines_outillage', '{fabrication,textile,btp,agriculture,services}'),
               ('Engins & matériel de chantier', 20, 'engins_chantier', '{btp}'),
               ('Véhicules & matériel roulant', 30, 'vehicules', '{transport,btp,agriculture,negoce}'),
               ('Matériel de manutention', 40, 'manutention', '{negoce,transport,fabrication}')) v(n, o, c, s)
 WHERE p.code = 'materiel_production' AND p.parent_id = '10000000-0000-0000-0000-000000000008'
ON CONFLICT (parent_id, code) WHERE code IS NOT NULL DO NOTHING;

-- Rôles de base : libellé et disponibilité par secteur (le code ne change pas).
ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS sectors      text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS system_label text,
  ADD COLUMN IF NOT EXISTS sector_labels jsonb NOT NULL DEFAULT '{}'::jsonb;
UPDATE roles SET system_label = label WHERE system_label IS NULL AND is_system;
UPDATE roles SET sector_labels = v.l::jsonb FROM (VALUES
  ('baker',       '{"boulangerie": "Boulanger", "*": "Opérateur de production"}'),
  ('pastry_chef', '{"boulangerie": "Pâtissier", "*": "Chef de production"}'),
  ('saleswoman',  '{"boulangerie": "Vendeuse", "*": "Vendeur"}')
) v(code, l) WHERE roles.code = v.code AND roles.is_system AND roles.sector_labels = '{}'::jsonb;
UPDATE roles SET sectors = '{boulangerie}' WHERE code IN ('viennoiserie', 'beldi_sale') AND is_system AND cardinality(sectors) = 0;

-- ─── 4. Motifs de perte de la vente au comptoir ───────────────────────────────────────
UPDATE ref_entries SET sectors = '{agroalimentaire,restauration}'
 WHERE cardinality(sectors) = 0 AND origin = 'system'
   AND ((table_id = 'scrap_reasons' AND code = 'brule') OR (table_id = 'production_loss_reasons' AND code = 'brule'));
UPDATE ref_entries SET sectors = '{agroalimentaire,restauration,commerce_detail}'
 WHERE cardinality(sectors) = 0 AND origin = 'system'
   AND ((table_id = 'scrap_reasons' AND code IN ('invendu_fin_journee', 'invendu_vitrine', 'dlv_expiree'))
     OR (table_id = 'loss_reasons' AND code IN ('unsold', 'invendu_fin_journee', 'dlv_expiree'))
     OR (table_id = 'loss_types' AND code = 'vitrine'));

-- ─── 5. Listes figées en base → référentiel ───────────────────────────────────────────
-- Contrôle commun : la valeur doit exister dans le référentiel (active ou non : une fiche
-- ancienne se modifie encore), ou figurer parmi les anciens codes donnés en arguments.
CREATE OR REPLACE FUNCTION fn_check_ref_code() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_code text := to_jsonb(NEW) ->> TG_ARGV[1];
BEGIN
  IF v_code IS NULL OR v_code = ANY(TG_ARGV[2:]) THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM ref_entries WHERE table_id = TG_ARGV[0] AND code = v_code) THEN
    RAISE EXCEPTION 'Valeur « % » absente du référentiel (Paramètres › Référentiel)', v_code
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_contract_type_check;
DROP TRIGGER IF EXISTS employees_contract_type_ref ON employees;
CREATE TRIGGER employees_contract_type_ref BEFORE INSERT OR UPDATE OF contract_type ON employees
  FOR EACH ROW EXECUTE FUNCTION fn_check_ref_code('contract_types', 'contract_type');

ALTER TABLE employee_contracts DROP CONSTRAINT IF EXISTS employee_contracts_contract_type_check;
DROP TRIGGER IF EXISTS employee_contracts_contract_type_ref ON employee_contracts;
CREATE TRIGGER employee_contracts_contract_type_ref BEFORE INSERT OR UPDATE OF contract_type ON employee_contracts
  FOR EACH ROW EXECUTE FUNCTION fn_check_ref_code('contract_types', 'contract_type');

-- « paid » : ancien code de congé payé, encore présent dans des historiques.
ALTER TABLE leaves DROP CONSTRAINT IF EXISTS leaves_type_check;
DROP TRIGGER IF EXISTS leaves_type_ref ON leaves;
CREATE TRIGGER leaves_type_ref BEFORE INSERT OR UPDATE OF type ON leaves
  FOR EACH ROW EXECUTE FUNCTION fn_check_ref_code('leave_types', 'type', 'paid');

-- Types d'emplacement de stock : nouveau référentiel.
INSERT INTO ref_tables (id, label, description, icon, source, editable, display_order, module, label_overrides)
VALUES ('stock_location_types', 'Types d''emplacement', 'Nature des zones de stockage (sec, froid, quai…)', 'Warehouse',
        'ref_entries', true, 15, 'stock',
        '{"boulangerie": {"description": "Sec, froid positif, froid négatif, pesage, vitrine, labo…"}}'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO ref_entries (table_id, code, label, display_order, sectors, origin, system_label, is_active)
SELECT 'stock_location_types', v.c, v.l, v.o, v.s::text[], 'system', v.l, cardinality(v.s::text[]) = 0
  FROM (VALUES ('sec', 'Sec', 10, '{}'), ('positif', 'Froid positif', 20, '{}'), ('negatif', 'Froid négatif', 30, '{}'),
               ('pesage', 'Pesage', 40, '{agroalimentaire,restauration}'),
               ('vitrine', 'Vitrine', 50, '{agroalimentaire,restauration,commerce_detail}'),
               ('labo', 'Labo', 60, '{boulangerie}'),
               ('quai', 'Quai de réception', 70, '{negoce,transport,fabrication,ecommerce}'),
               ('depot_chantier', 'Dépôt de chantier', 80, '{btp}'),
               ('magasin_atelier', 'Magasin d''atelier', 90, '{fabrication,textile}'),
               ('rayon', 'Rayon / surface de vente', 100, '{commerce_detail,sante}')) v(c, l, o, s)
ON CONFLICT (table_id, code) DO NOTHING;
INSERT INTO ref_usage_sources (table_id, source_table, source_column) VALUES ('stock_location_types', 'stock_locations', 'type')
ON CONFLICT DO NOTHING;
ALTER TABLE stock_locations DROP CONSTRAINT IF EXISTS stock_locations_type_check;
DROP TRIGGER IF EXISTS stock_locations_type_ref ON stock_locations;
CREATE TRIGGER stock_locations_type_ref BEFORE INSERT OR UPDATE OF type ON stock_locations
  FOR EACH ROW EXECUTE FUNCTION fn_check_ref_code('stock_location_types', 'type');

-- ─── 1 bis. Valeurs propres à l'agroalimentaire (exclues de la boulangerie) ───────────
UPDATE ref_entries SET sectors = (SELECT array_agg(DISTINCT s) FROM unnest(sectors || '{agroalimentaire}'::text[]) s),
                       excluded_sectors = '{boulangerie}'
 WHERE origin = 'system' AND NOT ('agroalimentaire' = ANY(sectors)) AND (
   (table_id = 'employee_roles' AND code IN ('operateur', 'controleur_qualite', 'technicien_maintenance', 'chauffeur_livreur', 'magasinier'))
   OR (table_id = 'production_equipment_types' AND code = 'machine')
   OR (table_id = 'production_step_types' AND code IN ('controle', 'conditionnement', 'preparation'))
   OR (table_id = 'ingredient_categories' AND code IN ('hygiene_entretien', 'boissons'))
   OR (table_id = 'units' AND code IN ('t', 'carton', 'palette')));
INSERT INTO ref_entries (table_id, code, label, display_order, sectors, excluded_sectors, origin, system_label, is_active)
SELECT v.t, v.c, v.l, 600 + v.o, '{agroalimentaire}', '{boulangerie}', 'system', v.l, false
  FROM (VALUES ('employee_roles', 'responsable_haccp', 'Responsable qualité / HACCP', 1),
               ('employee_roles', 'conducteur_ligne', 'Conducteur de ligne', 2),
               ('employee_roles', 'agent_conditionnement', 'Agent de conditionnement', 3),
               ('ingredient_categories', 'additifs', 'Additifs & auxiliaires technologiques', 1),
               ('ingredient_categories', 'emballages_primaires', 'Emballages primaires (contact alimentaire)', 2),
               ('production_equipment_types', 'ligne_conditionnement', 'Ligne de conditionnement', 1),
               ('production_equipment_types', 'autoclave', 'Autoclave / pasteurisateur', 2),
               ('production_step_types', 'pasteurisation', 'Pasteurisation / stérilisation', 1)) v(t, c, l, o)
ON CONFLICT (table_id, code) DO NOTHING;
UPDATE ref_entries SET metadata = metadata || '{"ccp": true, "default_param": "temp_coeur"}'::jsonb
 WHERE table_id = 'production_step_types' AND code = 'pasteurisation' AND NOT (metadata ? 'ccp');

-- ─── Synchronisation (remplace celle de la mig 698) ───────────────────────────────────
DROP FUNCTION IF EXISTS fn_ref_applicable(text[], text[], text[], text[]);

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
  v_tbl     text;
BEGIN
  IF cardinality(v_lineage) = 0 THEN
    RETURN jsonb_build_object('activated', 0, 'deactivated', 0, 'kept_in_use', 0, 'skipped', true);
  END IF;

  -- 0) données livrées rattachées à un secteur (contenants, équipements), avant les valeurs
  --    qu'elles retiennent. Une ligne utilisée (clé étrangère) n'est pas désactivée.
  FOREACH v_tbl IN ARRAY ARRAY['production_contenants', 'production_equipements'] LOOP
    EXECUTE format('SELECT COALESCE(array_agg(id), ''{}'') FROM %I
                     WHERE activation = ''auto'' AND is_active AND cardinality(sectors) > 0 AND NOT (sectors && $1)', v_tbl)
      INTO v_cand USING v_lineage;
    v_used := fn_ref_fk_used_ids(v_tbl::regclass, v_cand);
    EXECUTE format('UPDATE %I SET is_active = false WHERE id = ANY($1) AND NOT (id = ANY($2))', v_tbl) USING v_cand, v_used;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_native := v_native + v_n;
    EXECUTE format('UPDATE %I SET is_active = true
                     WHERE activation = ''auto'' AND NOT is_active AND cardinality(sectors) > 0 AND sectors && $1', v_tbl) USING v_lineage;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_native := v_native + v_n;
  END LOOP;

  -- a) valeurs : désactivation de ce qui ne s'applique plus, sauf valeurs utilisées.
  SELECT COALESCE(array_agg(id), '{}') INTO v_cand FROM ref_entries
   WHERE activation = 'auto' AND is_active AND NOT fn_ref_applicable(sectors, specializations, excluded_sectors, v_lineage, v_specs);
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
     WHERE activation = 'auto' AND NOT is_active AND fn_ref_applicable(sectors, specializations, excluded_sectors, v_lineage, v_specs)
     RETURNING table_id, code, id)
  SELECT COALESCE(jsonb_agg(table_id || ':' || COALESCE(code, id::text) ORDER BY table_id, code), '[]'::jsonb) INTO v_on FROM u;

  -- c) tables natives rattachées à des profils.
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

  -- d) libellés par secteur (seulement s'ils n'ont pas été modifiés par la société).
  UPDATE expense_categories ec SET name = n.target
    FROM (SELECT id, COALESCE(fn_sector_text(sector_names), system_name) AS target FROM expense_categories
           WHERE sector_names <> '{}'::jsonb) n
   WHERE ec.id = n.id AND ec.name IS DISTINCT FROM n.target
     AND (ec.name = ec.system_name OR ec.name IN (SELECT jsonb_each_text.value FROM jsonb_each_text(ec.sector_names)));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_native := v_native + v_n;
  UPDATE roles r SET label = n.target, updated_at = now()
    FROM (SELECT code, COALESCE(fn_sector_text(sector_labels), system_label) AS target FROM roles
           WHERE sector_labels <> '{}'::jsonb AND system_label IS NOT NULL) n
   WHERE r.code = n.code AND r.label IS DISTINCT FROM n.target
     AND (r.label = r.system_label OR r.label IN (SELECT jsonb_each_text.value FROM jsonb_each_text(r.sector_labels)));
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

SELECT fn_ref_sync_sectors('migration_699');
