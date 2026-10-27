-- 369 — Champs personnalisés
--
-- Kalum vise toute industrie : chaque entreprise ajoute à ses fiches les informations
-- propres à son métier (n° d'immatriculation d'un transporteur, taille / couleur d'un
-- article textile, n° de lot client…), sans développement.
--
-- Définitions dans `custom_field_defs` (Paramètres › Champs personnalisés) ; valeurs dans
-- une colonne JSONB `custom_fields` de chaque fiche, clé = code du champ. Le JSONB évite
-- une table EAV et se lit avec la fiche (SELECT * l'inclut déjà dans les listes) ; un
-- index GIN permet la recherche. Le contrôle des valeurs (type, liste, obligatoire) est
-- fait par le serveur à l'enregistrement.
--
-- Rollback :
--   ALTER TABLE customers, suppliers, ingredients, packaging_items, products, orders,
--     maintenance_interventions, projects DROP COLUMN custom_fields (une par table) ;
--   DROP TABLE custom_field_defs.

CREATE TABLE IF NOT EXISTS custom_field_defs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity         VARCHAR(30) NOT NULL
                   CHECK (entity IN ('customer', 'supplier', 'ingredient', 'packaging_item', 'product', 'order', 'intervention', 'project')),
  code           VARCHAR(40) NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  label          VARCHAR(80) NOT NULL,
  field_type     VARCHAR(10) NOT NULL CHECK (field_type IN ('text', 'number', 'date', 'select', 'boolean')),
  options        JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(options) = 'array'),
  required       BOOLEAN NOT NULL DEFAULT false,
  show_in_list   BOOLEAN NOT NULL DEFAULT false,
  help           VARCHAR(200),
  display_order  SMALLINT NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity, code),
  CHECK (field_type <> 'select' OR jsonb_array_length(options) > 0)
);
CREATE INDEX IF NOT EXISTS idx_custom_field_defs ON custom_field_defs (entity, display_order) WHERE is_active;
COMMENT ON TABLE custom_field_defs IS 'Champs personnalisés par type de fiche (mig 369) ; valeurs dans <table>.custom_fields (JSONB).';

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers', 'suppliers', 'ingredients', 'packaging_items', 'products', 'orders', 'maintenance_interventions', 'projects'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT ''{}''::jsonb', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING gin (custom_fields)', 'idx_' || t || '_custom_fields', t);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS custom_field_defs_touch ON custom_field_defs;
CREATE OR REPLACE FUNCTION trg_custom_field_defs_touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER custom_field_defs_touch BEFORE UPDATE ON custom_field_defs FOR EACH ROW EXECUTE FUNCTION trg_custom_field_defs_touch();
