-- Migration 264 : Traçabilité complète de la nomenclature (audit A6a, P1)
--
-- POURQUOI
--   Aujourd'hui, changer une quantite de composant ou desactiver un format
--   modifie SILENCIEUSEMENT le cout theorique de tous les plans qui pointent
--   vers cette recette — y compris les plans CLOTURES. La memoire projet
--   [[project_traceability]] exige la traçabilite complete du cycle produit
--   pour les audits/normes. Un cout qui change doit etre explicable a posteriori.
--
--   Meme pattern que la mig 239 (employee_salary_history) : trigger AFTER sur
--   les 2 tables source de verite de la BOM, journal separe, changed_by
--   alimente par la colonne `updated_by` (nouvelle) que le repo positionne
--   a chaque ecriture. Le trigger loggue les 3 operations, avec la ligne
--   avant/apres en JSONB (permet un diff cote applicatif sans etre couple
--   au schema, resistant aux futurs ajouts de colonnes).
--
--   Ce n'est PAS un audit d'application : c'est un journal SGBD. Il capture
--   aussi les modifications faites via psql en prod, un script de migration
--   bugue, ou un chef qui edite via un outil externe.
--
-- PORTEE
--   + updated_by UUID sur recipe_formats et recipe_format_components
--   + table recipe_bom_audit (append-only)
--   + fonction log_recipe_bom_change() + 2 triggers AFTER
--   Aucune donnee existante modifiee.
--
-- INVERSION
--   DROP TRIGGER recipe_formats_bom_audit ON recipe_formats;
--   DROP TRIGGER recipe_format_components_bom_audit ON recipe_format_components;
--   DROP FUNCTION log_recipe_bom_change();
--   DROP TABLE recipe_bom_audit;
--   ALTER TABLE recipe_formats DROP COLUMN updated_by;
--   ALTER TABLE recipe_format_components DROP COLUMN updated_by;

-- 1. Champ updated_by (source du changed_by dans le trigger)
ALTER TABLE recipe_formats
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id);
ALTER TABLE recipe_format_components
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id);

-- 2. Journal (append-only : pas d'UPDATE ni DELETE prevus)
CREATE TABLE IF NOT EXISTS recipe_bom_audit (
  id           BIGSERIAL PRIMARY KEY,
  table_name   VARCHAR(60) NOT NULL,
  operation    VARCHAR(10) NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
  record_id    UUID NOT NULL,
  format_id    UUID,
  recipe_id    UUID,
  changed_by   UUID REFERENCES users(id),
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  old_row      JSONB,
  new_row      JSONB
);

-- Deux acces principaux : "qui a touche a ce format / cette recette" +
-- "toutes les modifs d'un jour donne pour le controle".
CREATE INDEX IF NOT EXISTS idx_bom_audit_format ON recipe_bom_audit(format_id, changed_at DESC) WHERE format_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bom_audit_recipe ON recipe_bom_audit(recipe_id, changed_at DESC) WHERE recipe_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bom_audit_date   ON recipe_bom_audit(changed_at DESC);

COMMENT ON TABLE recipe_bom_audit IS
  'Journal SGBD de toutes les modifications de recipe_formats et recipe_format_components (mig 264). Append-only. old_row / new_row en JSONB pour rester decouple du schema.';

-- 3. Fonction generique : marche pour recipe_formats ET recipe_format_components,
--    extrait le format_id/recipe_id du bon champ selon TG_TABLE_NAME.
CREATE OR REPLACE FUNCTION log_recipe_bom_change()
RETURNS TRIGGER AS $$
DECLARE
  v_record_id UUID;
  v_format_id UUID;
  v_recipe_id UUID;
  v_changed_by UUID;
  v_old JSONB;
  v_new JSONB;
BEGIN
  -- to_jsonb() capture la ligne complete, resistant aux ajouts de colonnes.
  IF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_new := NULL;
    v_record_id := OLD.id;
    v_changed_by := OLD.updated_by;
  ELSIF TG_OP = 'INSERT' THEN
    v_old := NULL;
    v_new := to_jsonb(NEW);
    v_record_id := NEW.id;
    v_changed_by := NEW.updated_by;
  ELSE  -- UPDATE
    -- Rien logger si la ligne n'a pas change (touch updated_at seul = bruit).
    IF to_jsonb(OLD) - 'updated_at' - 'updated_by' = to_jsonb(NEW) - 'updated_at' - 'updated_by' THEN
      RETURN NEW;
    END IF;
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_record_id := NEW.id;
    v_changed_by := NEW.updated_by;
  END IF;

  IF TG_TABLE_NAME = 'recipe_formats' THEN
    v_format_id := v_record_id;
    v_recipe_id := COALESCE((v_new->>'recipe_id')::uuid, (v_old->>'recipe_id')::uuid);
  ELSIF TG_TABLE_NAME = 'recipe_format_components' THEN
    v_format_id := COALESCE((v_new->>'format_id')::uuid, (v_old->>'format_id')::uuid);
    -- Resolution differee : le recipe_id est sur le format parent. On evite
    -- une jointure ici (couteux dans un trigger) — la relecture cote appli
    -- rejoint recipe_formats pour presenter le contexte.
    v_recipe_id := NULL;
  END IF;

  INSERT INTO recipe_bom_audit
    (table_name, operation, record_id, format_id, recipe_id, changed_by, old_row, new_row)
  VALUES
    (TG_TABLE_NAME, TG_OP, v_record_id, v_format_id, v_recipe_id, v_changed_by, v_old, v_new);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS recipe_formats_bom_audit ON recipe_formats;
CREATE TRIGGER recipe_formats_bom_audit
  AFTER INSERT OR UPDATE OR DELETE ON recipe_formats
  FOR EACH ROW EXECUTE FUNCTION log_recipe_bom_change();

DROP TRIGGER IF EXISTS recipe_format_components_bom_audit ON recipe_format_components;
CREATE TRIGGER recipe_format_components_bom_audit
  AFTER INSERT OR UPDATE OR DELETE ON recipe_format_components
  FOR EACH ROW EXECUTE FUNCTION log_recipe_bom_change();
