-- G6-03 (plan d'action 2026-11) — multi-société, phase 1 : le socle des entités juridiques.
--
-- 1. Table legal_entities : une ligne par société (raison sociale, identifiants légaux
--    marocains ICE / IF / RC / patente / CNSS, adresse, devise, pays, logo facultatif).
--    Une seule entité « par défaut » (index unique partiel uq_legal_entities_default).
--
-- 2. Une installation existante obtient EXACTEMENT UNE entité, créée à partir de
--    company_settings (identité légale, mig 326/331/433) et du n° CNSS employeur
--    (payroll_settings, mig 318). Le logo n'est pas copié : logo_url NULL = logo de la
--    société (company_settings.logo_url), pour ne pas dupliquer un data URI de 3 Mo.
--
-- 3. stores.legal_entity_id : chaque établissement appartient à une entité. Rempli avec
--    l'entité par défaut, puis NOT NULL. Un établissement créé sans entité est rattaché à
--    l'entité par défaut (déclencheur BEFORE INSERT) : le code existant qui insère des
--    établissements ne change pas.
--
-- 4. Sort de company_settings : il RESTE la source des paramètres applicatifs (thème,
--    ticket, production, sécurité…). Ses champs d'identité légale (legal_*, company_name)
--    deviennent le MIROIR de l'entité par défaut, tenu par une synchronisation dans les
--    deux sens le temps de la transition :
--      - company_settings modifié (écran Paramètres › Entreprise, centre de paramètres,
--        import) → l'entité par défaut est mise à jour ;
--      - entité par défaut modifiée (nouvel écran des entités) ou changement d'entité par
--        défaut → company_settings est mis à jour ;
--      - même chose pour le n° CNSS employeur (payroll_settings.employer_cnss_number).
--    Choix d'une synchronisation plutôt qu'une vue : les colonnes legal_* sont écrites et
--    lues à de nombreux endroits (PUT /settings, centre de paramètres, export/import des
--    données, état de la configuration, client) ; les remplacer par une vue imposerait de
--    supprimer les colonnes, donc de réécrire tous ces chemins d'un coup. La boucle de
--    synchronisation s'arrête d'elle-même : chaque côté ne met à jour l'autre que si une
--    valeur diffère (UPDATE … WHERE … IS DISTINCT FROM …). En phase 2, quand plus aucun
--    code ne lira company_settings.legal_*, on supprimera les colonnes et les déclencheurs.
--
-- Comportement mono-société inchangé : l'unique entité porte exactement l'identité qui
-- figurait dans company_settings ; toutes les pièces la lisent via l'entité.
--
-- Fonctions et déclencheurs NOUVEAUX (aucune version antérieure en prod).
--
-- INVERSION :
--   DROP TRIGGER IF EXISTS trg_payroll_settings_sync_entity ON payroll_settings;
--   DROP TRIGGER IF EXISTS trg_company_settings_sync_entity ON company_settings;
--   DROP TRIGGER IF EXISTS trg_legal_entities_sync_company ON legal_entities;
--   DROP TRIGGER IF EXISTS trg_stores_default_entity ON stores;
--   DROP FUNCTION IF EXISTS fn_payroll_settings_sync_entity();
--   DROP FUNCTION IF EXISTS fn_company_settings_sync_entity();
--   DROP FUNCTION IF EXISTS fn_legal_entities_sync_company();
--   DROP FUNCTION IF EXISTS fn_stores_default_entity();
--   ALTER TABLE stores DROP COLUMN IF EXISTS legal_entity_id;
--   DROP FUNCTION IF EXISTS fn_default_legal_entity();
--   DROP TABLE IF EXISTS legal_entities;

CREATE TABLE IF NOT EXISTS legal_entities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          varchar(12)  NOT NULL,
  legal_name    varchar(120) NOT NULL,              -- raison sociale
  trade_name    varchar(100),                       -- nom commercial (company_name)
  legal_form    varchar(30),
  capital       numeric(14,2),
  ice           varchar(15),
  if_number     varchar(30),                        -- identifiant fiscal
  rc            varchar(30),
  patente       varchar(30),
  cnss          varchar(30),                        -- n° d'affiliation CNSS employeur
  address       text,
  city          varchar(80),
  commune_code  varchar(12),                        -- code commune DGI (EDI)
  phone         varchar(40),
  email         varchar(120),
  website       varchar(120),
  currency_code varchar(3)   NOT NULL,
  country_code  varchar(2)   NOT NULL DEFAULT 'MA',
  logo_url      text,                               -- NULL = logo de la société
  is_default    boolean      NOT NULL DEFAULT false,
  is_active     boolean      NOT NULL DEFAULT true,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT legal_entities_code_format CHECK (code ~ '^[A-Z0-9]{2,12}$'),
  CONSTRAINT legal_entities_name_not_blank CHECK (btrim(legal_name) <> ''),
  CONSTRAINT legal_entities_capital_check CHECK (capital IS NULL OR capital >= 0),
  CONSTRAINT legal_entities_ice_format CHECK (ice IS NULL OR ice ~ '^[0-9]{15}$'),
  CONSTRAINT legal_entities_commune_code_format CHECK (commune_code IS NULL OR commune_code ~ '^[0-9]{3}\.[0-9]{2}\.[0-9]{2}$'),
  CONSTRAINT legal_entities_currency_format CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT legal_entities_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT legal_entities_default_active CHECK (NOT is_default OR is_active)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_entities_code ON legal_entities (code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_entities_default ON legal_entities ((true)) WHERE is_default;

COMMENT ON TABLE legal_entities IS
  'G6-03 (mig 608) : entités juridiques (sociétés). Un établissement (stores) appartient à une entité ; l''entité par défaut est le miroir de company_settings.legal_*.';

-- Entité par défaut, depuis company_settings (une seule, jamais deux à la ré-exécution).
DO $$
DECLARE
  v_cs      company_settings;
  v_cnss    text;
  v_country text := 'MA';
BEGIN
  IF EXISTS (SELECT 1 FROM legal_entities) THEN RETURN; END IF;
  SELECT * INTO v_cs FROM company_settings WHERE id = 1;
  IF to_regclass('public.payroll_settings') IS NOT NULL THEN
    EXECUTE 'SELECT employer_cnss_number FROM payroll_settings WHERE id = 1' INTO v_cnss;
  END IF;
  -- Pack pays (travail parallèle, mig 606-607) : si company_settings.country_code existe, on le reprend.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'company_settings' AND column_name = 'country_code') THEN
    EXECUTE 'SELECT upper(country_code::text) FROM company_settings WHERE id = 1' INTO v_country;
    IF v_country IS NULL OR v_country !~ '^[A-Z]{2}$' THEN v_country := 'MA'; END IF;
  END IF;
  INSERT INTO legal_entities (code, legal_name, trade_name, legal_form, capital, ice, if_number, rc, patente, cnss,
                              address, city, commune_code, phone, email, website, currency_code, country_code, is_default)
  VALUES ('PRINCIPALE',
          COALESCE(NULLIF(btrim(v_cs.legal_name), ''), NULLIF(btrim(v_cs.company_name), ''), 'Société'),
          v_cs.company_name, v_cs.legal_form, v_cs.legal_capital, v_cs.legal_ice, v_cs.legal_if, v_cs.legal_rc,
          v_cs.legal_patente, v_cnss, v_cs.legal_address, v_cs.legal_city, v_cs.legal_commune_code,
          v_cs.legal_phone, v_cs.legal_email, v_cs.legal_website, fn_base_currency(), v_country, true);
END $$;

CREATE FUNCTION fn_default_legal_entity() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT id FROM legal_entities WHERE is_default LIMIT 1
$$;
COMMENT ON FUNCTION fn_default_legal_entity() IS 'G6-03 : identifiant de l''entité juridique par défaut.';

-- Rattachement des établissements.
ALTER TABLE stores ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES legal_entities(id) ON DELETE RESTRICT;
UPDATE stores SET legal_entity_id = fn_default_legal_entity() WHERE legal_entity_id IS NULL;
ALTER TABLE stores ALTER COLUMN legal_entity_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stores_legal_entity ON stores (legal_entity_id);
COMMENT ON COLUMN stores.legal_entity_id IS 'G6-03 (mig 608) : entité juridique de l''établissement (défaut : entité par défaut).';

CREATE FUNCTION fn_stores_default_entity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.legal_entity_id IS NULL THEN
    NEW.legal_entity_id := fn_default_legal_entity();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_stores_default_entity BEFORE INSERT OR UPDATE OF legal_entity_id ON stores
  FOR EACH ROW EXECUTE FUNCTION fn_stores_default_entity();

-- Synchronisation company_settings → entité par défaut.
CREATE FUNCTION fn_company_settings_sync_entity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE legal_entities e
     SET legal_name   = COALESCE(NULLIF(btrim(NEW.legal_name), ''), NULLIF(btrim(NEW.company_name), ''), e.legal_name),
         trade_name   = NEW.company_name,
         legal_form   = NEW.legal_form,     capital  = NEW.legal_capital,
         ice          = NEW.legal_ice,      if_number = NEW.legal_if,
         rc           = NEW.legal_rc,       patente  = NEW.legal_patente,
         address      = NEW.legal_address,  city     = NEW.legal_city,
         commune_code = NEW.legal_commune_code,
         phone        = NEW.legal_phone,    email    = NEW.legal_email,
         website      = NEW.legal_website,  updated_at = now()
   WHERE e.is_default
     AND (e.legal_name::text, e.trade_name::text, e.legal_form::text, e.capital, e.ice::text, e.if_number::text,
          e.rc::text, e.patente::text, e.address, e.city::text, e.commune_code::text, e.phone::text, e.email::text,
          e.website::text)
         IS DISTINCT FROM
         (COALESCE(NULLIF(btrim(NEW.legal_name), ''), NULLIF(btrim(NEW.company_name), ''), e.legal_name)::text,
          NEW.company_name::text, NEW.legal_form::text, NEW.legal_capital, NEW.legal_ice::text, NEW.legal_if::text,
          NEW.legal_rc::text, NEW.legal_patente::text, NEW.legal_address, NEW.legal_city::text,
          NEW.legal_commune_code::text, NEW.legal_phone::text, NEW.legal_email::text, NEW.legal_website::text);
  RETURN NULL;
END $$;
CREATE TRIGGER trg_company_settings_sync_entity
  AFTER UPDATE OF company_name, legal_name, legal_form, legal_capital, legal_ice, legal_if, legal_rc, legal_patente,
                  legal_address, legal_city, legal_commune_code, legal_phone, legal_email, legal_website
  ON company_settings FOR EACH ROW WHEN (NEW.id = 1)
  EXECUTE FUNCTION fn_company_settings_sync_entity();

-- Synchronisation entité par défaut → company_settings (et CNSS → paie).
-- company_settings.legal_name reste vide quand la raison sociale n'y était que le repli
-- sur le nom commercial (même repli que companyLegalFromRow côté serveur).
CREATE FUNCTION fn_legal_entities_sync_company() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_legal_name text;
  v_company    text;
BEGIN
  IF NOT NEW.is_default THEN RETURN NULL; END IF;
  SELECT CASE WHEN NULLIF(btrim(cs.legal_name), '') IS NULL AND NEW.legal_name = cs.company_name
              THEN cs.legal_name ELSE NEW.legal_name END,
         COALESCE(NULLIF(btrim(NEW.trade_name), ''), cs.company_name)
    INTO v_legal_name, v_company FROM company_settings cs WHERE cs.id = 1;
  UPDATE company_settings cs
     SET legal_name = v_legal_name,      company_name = v_company,
         legal_form = NEW.legal_form,     legal_capital = NEW.capital,
         legal_ice  = NEW.ice,            legal_if = NEW.if_number,
         legal_rc   = NEW.rc,             legal_patente = NEW.patente,
         legal_address = NEW.address,     legal_city = NEW.city,
         legal_commune_code = NEW.commune_code,
         legal_phone = NEW.phone,         legal_email = NEW.email,
         legal_website = NEW.website,     updated_at = now()
   WHERE cs.id = 1
     AND (cs.legal_name::text, cs.company_name::text, cs.legal_form::text, cs.legal_capital, cs.legal_ice::text,
          cs.legal_if::text, cs.legal_rc::text, cs.legal_patente::text, cs.legal_address, cs.legal_city::text,
          cs.legal_commune_code::text, cs.legal_phone::text, cs.legal_email::text, cs.legal_website::text)
         IS DISTINCT FROM
         (v_legal_name, v_company, NEW.legal_form::text, NEW.capital, NEW.ice::text, NEW.if_number::text,
          NEW.rc::text, NEW.patente::text, NEW.address, NEW.city::text, NEW.commune_code::text, NEW.phone::text,
          NEW.email::text, NEW.website::text);
  IF to_regclass('public.payroll_settings') IS NOT NULL THEN
    EXECUTE 'UPDATE payroll_settings SET employer_cnss_number = $1 WHERE id = 1 AND employer_cnss_number IS DISTINCT FROM $1'
      USING NEW.cnss;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_legal_entities_sync_company AFTER INSERT OR UPDATE ON legal_entities
  FOR EACH ROW EXECUTE FUNCTION fn_legal_entities_sync_company();

CREATE FUNCTION fn_payroll_settings_sync_entity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE legal_entities SET cnss = NEW.employer_cnss_number, updated_at = now()
   WHERE is_default AND cnss IS DISTINCT FROM NEW.employer_cnss_number;
  RETURN NULL;
END $$;
DO $$
BEGIN
  IF to_regclass('public.payroll_settings') IS NOT NULL THEN
    CREATE TRIGGER trg_payroll_settings_sync_entity AFTER UPDATE OF employer_cnss_number ON payroll_settings
      FOR EACH ROW WHEN (NEW.id = 1) EXECUTE FUNCTION fn_payroll_settings_sync_entity();
  END IF;
END $$;

-- Journal du paramétrage (mig 328) et piste d'audit générique (mig 578).
DO $$
BEGIN
  IF to_regprocedure('log_config_change()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS legal_entities_config_audit ON legal_entities;
    CREATE TRIGGER legal_entities_config_audit AFTER INSERT OR UPDATE OR DELETE ON legal_entities
      FOR EACH ROW EXECUTE FUNCTION log_config_change('id', '');
  END IF;
  IF to_regprocedure('fn_audit_trail_row()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_trail ON legal_entities;
    CREATE TRIGGER trg_audit_trail AFTER UPDATE OR DELETE ON legal_entities
      FOR EACH ROW EXECUTE FUNCTION fn_audit_trail_row();
  END IF;
END $$;
