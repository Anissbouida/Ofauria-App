-- Migration 304 : Fournisseurs — identité légale, hygiène, auxiliaire, piste d'audit
-- (refonte Achats, domaine D1, lot L1 « Socle sûr » : G-D1-19, G-D1-01, G-D1-17, G-D1-04)
--
-- POURQUOI
--   Une facture fournisseur n'est « régulière et probante » (CGI art. 145/146)
--   que si le tiers porte ICE / IF / RC / TP. Aujourd'hui `suppliers` n'a qu'un
--   `ice varchar(30)` libre (13/40 renseignés, 4 chaînes vides, 2 fiches avec
--   le même ICE), aucune contrainte, aucune piste d'audit, et 5 fournisseurs
--   sans auxiliaire 4411. Le prix catalogue (`ingredients.unit_cost`) est
--   écrasé par quatre chemins sans journal.
--
--   Le système doit servir d'autres industries et d'autres pays : les
--   identifiants fiscaux ne sont donc PAS des colonnes marocaines en dur mais
--   des lignes typées (`identifier_types` fourni par le pack pays →
--   `supplier_identifiers`). La colonne historique `suppliers.ice` est
--   conservée en MIROIR (lecture seule, entretenue par trigger) pour ne pas
--   casser les lecteurs existants (PDF BC, imports, écrans).
--
-- PORTÉE
--   1. Hygiène : ice '' → NULL, trim(name), lot NaN corrigé, CHECK sur les coûts/prix,
--      entrée vide de ref_entries(payment_methods) retirée.
--   2. suppliers : legal_name, legal_form, vat_regime, parent_supplier_id,
--      created_by / updated_by / updated_at ; unicité insensible à la casse du nom.
--   3. identifier_types (pack pays, seed MA) + supplier_identifiers + miroir ice.
--   4. fn_ensure_supplier_auxiliary + triggers (création / renommage) + backfill.
--   5. purchasing_master_audit (append-only, diff JSONB) + triggers sur
--      suppliers, supplier_identifiers, et sur les changements de unit_cost
--      d'ingredients / packaging_items.
--   Aucune suppression de donnée métier.
--
-- INVERSION
--   DROP TRIGGER ... (voir noms ci-dessous) ; DROP FUNCTION log_purchasing_master_change,
--   fn_ensure_supplier_auxiliary, trg_supplier_identifiers_mirror_ice,
--   trg_supplier_identifiers_unique ; DROP TABLE purchasing_master_audit,
--   supplier_identifiers, identifier_types ; ALTER TABLE suppliers DROP COLUMN
--   legal_name, legal_form, vat_regime, parent_supplier_id, created_by, updated_by,
--   updated_at ; DROP INDEX uq_suppliers_name_ci ; DROP les CHECK chk_*_cost.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. HYGIÈNE (avant toute contrainte)
-- ═══════════════════════════════════════════════════════════════════════

UPDATE suppliers SET ice = NULL WHERE trim(coalesce(ice, '')) = '';
UPDATE suppliers SET name = trim(name) WHERE name <> trim(name);

-- Lot « Raisins secs golden » à unit_cost = NaN : toute agrégation qui l'inclut
-- renvoie NaN. On reprend le coût catalogue de l'ingrédient.
UPDATE ingredient_lots l
   SET unit_cost = i.unit_cost
  FROM ingredients i
 WHERE i.id = l.ingredient_id
   AND l.unit_cost = 'NaN'::numeric;

ALTER TABLE ingredients
  ADD CONSTRAINT chk_ingredients_cost CHECK (unit_cost IS NULL OR (unit_cost >= 0 AND unit_cost <> 'NaN'::numeric));
ALTER TABLE packaging_items
  ADD CONSTRAINT chk_packaging_items_cost CHECK (unit_cost IS NULL OR (unit_cost >= 0 AND unit_cost <> 'NaN'::numeric));
ALTER TABLE ingredient_lots
  ADD CONSTRAINT chk_ingredient_lots_cost CHECK (unit_cost IS NULL OR (unit_cost >= 0 AND unit_cost <> 'NaN'::numeric));
ALTER TABLE purchase_order_items
  ADD CONSTRAINT chk_po_items_price CHECK (unit_price IS NULL OR (unit_price >= 0 AND unit_price <> 'NaN'::numeric));
ALTER TABLE reception_voucher_items
  ADD CONSTRAINT chk_rvi_price CHECK (unit_price IS NULL OR (unit_price >= 0 AND unit_price <> 'NaN'::numeric));

-- Entrée « code vide » du référentiel des modes de paiement (aucune FK : le code
-- est stocké en texte dans payments.payment_method, et aucun paiement ne porte '').
DELETE FROM ref_entries WHERE code = '' AND table_id = 'payment_methods';

-- ═══════════════════════════════════════════════════════════════════════
-- 2. SUPPLIERS : identité légale et traçabilité d'écriture
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS legal_name         VARCHAR(200),
  ADD COLUMN IF NOT EXISTS legal_form         VARCHAR(30),
  -- Régime TVA du tiers : assujetti (facture avec TVA), non_assujetti
  -- (personne physique, marché), exonere (vend des produits exonérés).
  ADD COLUMN IF NOT EXISTS vat_regime         VARCHAR(20) NOT NULL DEFAULT 'assujetti',
  -- Enseigne → entité juridique (Supeco et Carrefour partagent l'ICE Label'Vie).
  ADD COLUMN IF NOT EXISTS parent_supplier_id UUID REFERENCES suppliers(id),
  ADD COLUMN IF NOT EXISTS created_by         UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_by         UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE suppliers
  ADD CONSTRAINT chk_suppliers_vat_regime CHECK (vat_regime IN ('assujetti', 'non_assujetti', 'exonere')),
  ADD CONSTRAINT chk_suppliers_name_trim  CHECK (name = trim(name) AND length(name) >= 2),
  ADD CONSTRAINT chk_suppliers_parent_not_self CHECK (parent_supplier_id IS NULL OR parent_supplier_id <> id);

-- Un seul tiers par nom (insensible à la casse) : SONEPAL / SONEPALE restent deux
-- noms distincts (fusion = G-D1-16, lot 2).
--
-- La prod porte déjà des homonymes (« Légumes et fruits » en double) : l'index
-- ne peut pas se créer tant qu'ils coexistent. On ne fusionne rien ici (15
-- tables référencent suppliers : la fusion est le lot G-D1-16) : la fiche la
-- plus ancienne garde son nom, les suivantes reçoivent un suffixe « (2) »,
-- « (3) »… et restent intactes (FK, historique, activité). Le gérant les
-- fusionne ensuite depuis l'écran Fournisseurs. Idempotent.
DO $$
DECLARE z TEXT;
BEGIN
  WITH d AS (
    SELECT id, name,
           row_number() OVER (PARTITION BY lower(name) ORDER BY created_at, id) AS rn
      FROM suppliers
  ), u AS (
    UPDATE suppliers s
       SET name = d.name || ' (' || d.rn || ')'
      FROM d
     WHERE s.id = d.id AND d.rn > 1
    RETURNING s.name
  )
  SELECT string_agg(name, ', ' ORDER BY name) INTO z FROM u;
  IF z IS NOT NULL THEN
    RAISE NOTICE 'Mig 304 : fournisseurs homonymes renommés (à fusionner) -> %', z;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_suppliers_name_ci ON suppliers (lower(name));

COMMENT ON COLUMN suppliers.ice IS
  'MIROIR en lecture seule de supplier_identifiers (type MA_ICE), entretenu par trigger (mig 304). Écrire dans supplier_identifiers.';
COMMENT ON COLUMN suppliers.parent_supplier_id IS
  'Entité juridique porteuse des identifiants quand la fiche est une enseigne / un point de vente (mig 304).';

-- ═══════════════════════════════════════════════════════════════════════
-- 3. IDENTIFIANTS FISCAUX TYPÉS (pack pays)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS identifier_types (
  code          VARCHAR(20) PRIMARY KEY,          -- ex. MA_ICE, MA_IF, SN_NINEA
  country_code  CHAR(2) NOT NULL,                 -- ISO 3166-1 alpha-2
  label         VARCHAR(80) NOT NULL,
  description   TEXT,
  pattern       TEXT,                             -- regex POSIX de validation, NULL = libre
  is_unique     BOOLEAN NOT NULL DEFAULT false,   -- une valeur = une entité juridique
  required_for_vat_deduction BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true
);
COMMENT ON TABLE identifier_types IS
  'Types d''identifiants légaux des tiers, fournis par le pack pays (mig 304). Le noyau ne connaît aucun identifiant national.';

INSERT INTO identifier_types (code, country_code, label, description, pattern, is_unique, required_for_vat_deduction, display_order) VALUES
  ('MA_ICE',  'MA', 'ICE',  'Identifiant Commun de l''Entreprise (15 chiffres) — obligatoire sur la facture depuis 2016', '^[0-9]{15}$', true,  true,  10),
  ('MA_IF',   'MA', 'IF',   'Identifiant Fiscal (DGI)',                                                                 '^[0-9]{1,8}$',  true,  true,  20),
  ('MA_RC',   'MA', 'RC',   'Registre du Commerce (numéro, à compléter de la ville du tribunal)',                        '^[0-9A-Za-z/ -]{1,20}$', false, false, 30),
  ('MA_TP',   'MA', 'TP',   'Taxe Professionnelle (ex-patente)',                                                        '^[0-9]{1,12}$', false, false, 40),
  ('MA_CNSS', 'MA', 'CNSS', 'Affiliation CNSS',                                                                          '^[0-9]{1,10}$', false, false, 50)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS supplier_identifiers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id  UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  type_code    VARCHAR(20) NOT NULL REFERENCES identifier_types(code),
  value        VARCHAR(60) NOT NULL,
  -- Complément libre (ex. ville du tribunal pour le RC).
  qualifier    VARCHAR(60),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   UUID REFERENCES users(id),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   UUID REFERENCES users(id),
  CONSTRAINT chk_supplier_identifiers_value CHECK (value = trim(value) AND length(value) >= 1),
  CONSTRAINT uq_supplier_identifiers_type UNIQUE (supplier_id, type_code)
);
CREATE INDEX IF NOT EXISTS idx_supplier_identifiers_lookup ON supplier_identifiers (type_code, value);
COMMENT ON TABLE supplier_identifiers IS
  'Identifiants légaux du fournisseur, un par type (mig 304). Source de vérité ; suppliers.ice n''en est qu''un miroir.';

-- Validation de format + unicité par entité juridique (une enseigne partage les
-- identifiants de son parent). Fait en trigger car l''unicité dépend d''une autre table.
CREATE OR REPLACE FUNCTION trg_supplier_identifiers_validate()
RETURNS TRIGGER AS $$
DECLARE
  v_type   identifier_types%ROWTYPE;
  v_entity UUID;
  v_other  TEXT;
BEGIN
  SELECT * INTO v_type FROM identifier_types WHERE code = NEW.type_code;
  IF v_type.pattern IS NOT NULL AND NEW.value !~ v_type.pattern THEN
    RAISE EXCEPTION 'Identifiant % invalide : « % » ne respecte pas le format attendu', v_type.label, NEW.value
      USING ERRCODE = 'check_violation', CONSTRAINT = 'chk_supplier_identifier_format';
  END IF;
  IF v_type.is_unique THEN
    SELECT COALESCE(parent_supplier_id, id) INTO v_entity FROM suppliers WHERE id = NEW.supplier_id;
    SELECT s.name INTO v_other
      FROM supplier_identifiers si
      JOIN suppliers s ON s.id = si.supplier_id
     WHERE si.type_code = NEW.type_code
       AND si.value = NEW.value
       AND si.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
       AND COALESCE(s.parent_supplier_id, s.id) <> v_entity
     LIMIT 1;
    IF v_other IS NOT NULL THEN
      RAISE EXCEPTION '% « % » déjà utilisé par le fournisseur « % »', v_type.label, NEW.value, v_other
        USING ERRCODE = 'unique_violation', CONSTRAINT = 'uq_supplier_identifier_value';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS supplier_identifiers_validate ON supplier_identifiers;
CREATE TRIGGER supplier_identifiers_validate
  BEFORE INSERT OR UPDATE ON supplier_identifiers
  FOR EACH ROW EXECUTE FUNCTION trg_supplier_identifiers_validate();

-- Miroir : suppliers.ice suit l''identifiant MA_ICE.
CREATE OR REPLACE FUNCTION trg_supplier_identifiers_mirror_ice()
RETURNS TRIGGER AS $$
DECLARE
  v_supplier UUID := COALESCE(NEW.supplier_id, OLD.supplier_id);
BEGIN
  IF COALESCE(NEW.type_code, OLD.type_code) = 'MA_ICE' THEN
    UPDATE suppliers s
       SET ice = (SELECT value FROM supplier_identifiers WHERE supplier_id = v_supplier AND type_code = 'MA_ICE')
     WHERE s.id = v_supplier
       AND s.ice IS DISTINCT FROM (SELECT value FROM supplier_identifiers WHERE supplier_id = v_supplier AND type_code = 'MA_ICE');
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS supplier_identifiers_mirror_ice ON supplier_identifiers;
CREATE TRIGGER supplier_identifiers_mirror_ice
  AFTER INSERT OR UPDATE OR DELETE ON supplier_identifiers
  FOR EACH ROW EXECUTE FUNCTION trg_supplier_identifiers_mirror_ice();

-- Reprise : Carrefour et Supeco partagent l''ICE 000078523000008 (Label'Vie).
-- On rattache Supeco à Carrefour comme enseigne de la même entité pour que la
-- reprise des ICE passe l''unicité ; la fiche « Label'Vie » proprement dite reste
-- une décision du propriétaire (question ouverte 2 de l''audit).
UPDATE suppliers SET parent_supplier_id = (SELECT id FROM suppliers WHERE name = 'Carrefour')
 WHERE name = 'Supeco' AND parent_supplier_id IS NULL
   AND EXISTS (SELECT 1 FROM suppliers WHERE name = 'Carrefour');

INSERT INTO supplier_identifiers (supplier_id, type_code, value)
SELECT id, 'MA_ICE', ice FROM suppliers WHERE ice IS NOT NULL AND ice ~ '^[0-9]{15}$'
ON CONFLICT (supplier_id, type_code) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. AUXILIAIRE 4411 CRÉÉ AVEC LA FICHE, LIBELLÉ SYNCHRONISÉ
-- ═══════════════════════════════════════════════════════════════════════

-- Même convention que le seed 179 et journal-generator (4411-FOUR-<6>-<4>).
-- Le compte collectif est résolu par son code : il reste à sortir dans le pack
-- pays (account_roles) lors du lot comptable ; ici une seule constante, nommée.
CREATE OR REPLACE FUNCTION fn_ensure_supplier_auxiliary(p_supplier_id UUID)
RETURNS UUID AS $$
DECLARE
  v_account UUID;
  v_aux     UUID;
  v_name    TEXT;
BEGIN
  SELECT id INTO v_aux FROM account_auxiliaries WHERE supplier_id = p_supplier_id;
  IF v_aux IS NOT NULL THEN RETURN v_aux; END IF;

  SELECT id INTO v_account FROM accounts WHERE code = '4411';
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Compte collectif fournisseurs 4411 absent du plan comptable : impossible de créer l''auxiliaire';
  END IF;
  SELECT name INTO v_name FROM suppliers WHERE id = p_supplier_id;

  INSERT INTO account_auxiliaries (account_id, supplier_id, code, label)
  VALUES (v_account, p_supplier_id,
          '4411-FOUR-' || UPPER(SUBSTR(REGEXP_REPLACE(v_name, '[^A-Za-z0-9]', '', 'g'), 1, 6)) || '-' || SUBSTR(p_supplier_id::TEXT, 1, 4),
          v_name)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_aux;

  IF v_aux IS NULL THEN
    SELECT id INTO v_aux FROM account_auxiliaries WHERE supplier_id = p_supplier_id;
  END IF;
  RETURN v_aux;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_suppliers_auxiliary()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM fn_ensure_supplier_auxiliary(NEW.id);
  ELSIF NEW.name <> OLD.name THEN
    UPDATE account_auxiliaries SET label = NEW.name WHERE supplier_id = NEW.id AND label <> NEW.name;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS suppliers_auxiliary ON suppliers;
CREATE TRIGGER suppliers_auxiliary
  AFTER INSERT OR UPDATE OF name ON suppliers
  FOR EACH ROW EXECUTE FUNCTION trg_suppliers_auxiliary();

-- Backfill : 5 fournisseurs sans auxiliaire ; libellés désynchronisés.
SELECT fn_ensure_supplier_auxiliary(id) FROM suppliers s
 WHERE NOT EXISTS (SELECT 1 FROM account_auxiliaries a WHERE a.supplier_id = s.id);
UPDATE account_auxiliaries a SET label = s.name
  FROM suppliers s WHERE s.id = a.supplier_id AND a.label <> s.name;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. PISTE D'AUDIT DU RÉFÉRENTIEL ACHATS (append-only)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS purchasing_master_audit (
  id          BIGSERIAL PRIMARY KEY,
  table_name  VARCHAR(60) NOT NULL,
  operation   VARCHAR(10) NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  record_id   UUID NOT NULL,
  supplier_id UUID,                                -- dénormalisé pour « historique du tiers »
  changed_by  UUID REFERENCES users(id),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  diff        JSONB,                               -- {champ: {old, new}} — champs modifiés seulement
  old_row     JSONB,
  new_row     JSONB
);
CREATE INDEX IF NOT EXISTS idx_pma_supplier ON purchasing_master_audit (supplier_id, changed_at DESC) WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pma_record   ON purchasing_master_audit (table_name, record_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pma_date     ON purchasing_master_audit (changed_at DESC);
COMMENT ON TABLE purchasing_master_audit IS
  'Journal SGBD append-only du référentiel achats : fournisseurs, identifiants, coûts catalogue (mig 304). changed_by = updated_by de la ligne ou current_setting(app.user_id).';

-- Pas d''UPDATE/DELETE applicatif sur le journal (le rôle applicatif est le
-- propriétaire des tables : on protège par trigger plutôt que par GRANT).
CREATE OR REPLACE FUNCTION trg_audit_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'purchasing_master_audit est en ajout seul (append-only)';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS purchasing_master_audit_append_only ON purchasing_master_audit;
CREATE TRIGGER purchasing_master_audit_append_only
  BEFORE UPDATE OR DELETE ON purchasing_master_audit
  FOR EACH ROW EXECUTE FUNCTION trg_audit_append_only();

CREATE OR REPLACE FUNCTION log_purchasing_master_change()
RETURNS TRIGGER AS $$
DECLARE
  v_old   JSONB;
  v_new   JSONB;
  v_diff  JSONB := '{}'::jsonb;
  v_key   TEXT;
  v_rec   UUID;
  v_sup   UUID;
  v_by    UUID;
  v_ctx   TEXT;
  v_noise TEXT[] := ARRAY['updated_at', 'updated_by'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
  ELSIF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW);
  ELSE
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    -- Diff champ par champ, en ignorant le bruit technique.
    FOR v_key IN SELECT jsonb_object_keys(v_old || v_new) LOOP
      IF NOT (v_key = ANY (v_noise)) AND (v_old -> v_key) IS DISTINCT FROM (v_new -> v_key) THEN
        v_diff := v_diff || jsonb_build_object(v_key, jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key));
      END IF;
    END LOOP;
    IF v_diff = '{}'::jsonb THEN RETURN NULL; END IF;   -- rien de métier n'a changé
  END IF;

  v_rec := COALESCE((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid);
  v_sup := CASE TG_TABLE_NAME
             WHEN 'suppliers' THEN v_rec
             ELSE COALESCE((v_new ->> 'supplier_id')::uuid, (v_old ->> 'supplier_id')::uuid)
           END;

  -- Auteur : colonne updated_by de la ligne, sinon contexte de session posé par l''API.
  v_by := COALESCE((v_new ->> 'updated_by')::uuid, (v_new ->> 'created_by')::uuid);
  IF v_by IS NULL THEN
    v_ctx := current_setting('app.user_id', true);
    IF v_ctx IS NOT NULL AND v_ctx <> '' THEN v_by := v_ctx::uuid; END IF;
  END IF;

  INSERT INTO purchasing_master_audit (table_name, operation, record_id, supplier_id, changed_by, diff, old_row, new_row)
  VALUES (TG_TABLE_NAME, TG_OP, v_rec, v_sup, v_by, NULLIF(v_diff, '{}'::jsonb), v_old, v_new);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS suppliers_master_audit ON suppliers;
CREATE TRIGGER suppliers_master_audit
  AFTER INSERT OR UPDATE OR DELETE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION log_purchasing_master_change();

DROP TRIGGER IF EXISTS supplier_identifiers_master_audit ON supplier_identifiers;
CREATE TRIGGER supplier_identifiers_master_audit
  AFTER INSERT OR UPDATE OR DELETE ON supplier_identifiers
  FOR EACH ROW EXECUTE FUNCTION log_purchasing_master_change();

-- Coût catalogue : seul le changement de unit_cost est journalisé (les autres
-- colonnes des articles relèvent du module Stock).
DROP TRIGGER IF EXISTS ingredients_cost_audit ON ingredients;
CREATE TRIGGER ingredients_cost_audit
  AFTER UPDATE OF unit_cost ON ingredients
  FOR EACH ROW WHEN (OLD.unit_cost IS DISTINCT FROM NEW.unit_cost)
  EXECUTE FUNCTION log_purchasing_master_change();

DROP TRIGGER IF EXISTS packaging_items_cost_audit ON packaging_items;
CREATE TRIGGER packaging_items_cost_audit
  AFTER UPDATE OF unit_cost ON packaging_items
  FOR EACH ROW WHEN (OLD.unit_cost IS DISTINCT FROM NEW.unit_cost)
  EXECUTE FUNCTION log_purchasing_master_change();

-- updated_at automatique sur suppliers (le trigger d''audit ignore ce bruit).
CREATE OR REPLACE FUNCTION trg_suppliers_touch()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS suppliers_touch ON suppliers;
CREATE TRIGGER suppliers_touch BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION trg_suppliers_touch();

-- ═══════════════════════════════════════════════════════════════════════
-- 6. CONTRÔLES DE FIN
-- ═══════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_missing INT; v_bad_ice INT;
BEGIN
  SELECT count(*) INTO v_missing FROM suppliers s
   WHERE NOT EXISTS (SELECT 1 FROM account_auxiliaries a WHERE a.supplier_id = s.id);
  IF v_missing > 0 THEN RAISE EXCEPTION 'mig 304 : % fournisseur(s) sans auxiliaire après backfill', v_missing; END IF;

  SELECT count(*) INTO v_bad_ice FROM suppliers s
   WHERE s.ice IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM supplier_identifiers i WHERE i.supplier_id = s.id AND i.type_code = 'MA_ICE' AND i.value = s.ice);
  IF v_bad_ice > 0 THEN RAISE EXCEPTION 'mig 304 : % ICE non repris dans supplier_identifiers', v_bad_ice; END IF;
END $$;
