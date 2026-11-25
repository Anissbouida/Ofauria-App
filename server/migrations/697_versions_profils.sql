-- Lot 14 (assistant multisectoriel) : versions des profils industriels.
-- Chaque changement effectif d'un profil (définition ou vocabulaire), quel que soit le
-- chemin (migration, profil personnalisé, import), crée une version. Les versions ne
-- se modifient pas ; elles servent à comparer et à tracer l'évolution d'un profil.
CREATE TABLE IF NOT EXISTS sector_pack_versions (
  id          serial PRIMARY KEY,
  sector_code varchar(40) NOT NULL,
  version     integer NOT NULL,
  content     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  UNIQUE (sector_code, version)
);

CREATE OR REPLACE FUNCTION fn_capture_sector_pack_version(p_code varchar) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_content jsonb;
  v_last    jsonb;
  v_next    integer;
BEGIN
  SELECT (to_jsonb(p) - 'created_at' - 'created_by' - 'sort_order' - 'in_wizard')
         || jsonb_build_object('labels', COALESCE((SELECT jsonb_object_agg(l.label_key, l.label_value ORDER BY l.label_key)
                                                  FROM sector_labels l WHERE l.sector_pack = p.code), '{}'::jsonb))
    INTO v_content FROM sector_packs p WHERE p.code = p_code;
  IF v_content IS NULL THEN RETURN; END IF;
  SELECT content, version INTO v_last, v_next FROM sector_pack_versions WHERE sector_code = p_code ORDER BY version DESC LIMIT 1;
  IF v_last IS NOT NULL AND v_last = v_content THEN RETURN; END IF;
  INSERT INTO sector_pack_versions (sector_code, version, content, created_by)
  VALUES (p_code, COALESCE(v_next, 0) + 1, v_content, NULLIF(current_setting('app.user_id', true), '')::uuid);
END $$;

CREATE OR REPLACE FUNCTION fn_sector_pack_version_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'sector_packs' THEN
    IF TG_OP <> 'DELETE' THEN PERFORM fn_capture_sector_pack_version(NEW.code); END IF;
  ELSE
    IF TG_OP <> 'DELETE' THEN PERFORM fn_capture_sector_pack_version(NEW.sector_pack); END IF;
    IF TG_OP <> 'INSERT' THEN PERFORM fn_capture_sector_pack_version(OLD.sector_pack); END IF;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_sector_pack_version ON sector_packs;
CREATE TRIGGER trg_sector_pack_version AFTER INSERT OR UPDATE ON sector_packs
  FOR EACH ROW EXECUTE FUNCTION fn_sector_pack_version_trg();
DROP TRIGGER IF EXISTS trg_sector_label_version ON sector_labels;
CREATE TRIGGER trg_sector_label_version AFTER INSERT OR UPDATE OR DELETE ON sector_labels
  FOR EACH ROW EXECUTE FUNCTION fn_sector_pack_version_trg();

-- Version 1 de chaque profil existant.
SELECT fn_capture_sector_pack_version(code) FROM sector_packs;
