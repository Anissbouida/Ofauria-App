-- G0-04 (plan d'action 2026-11) — stockage des fichiers hors du disque local.
--
-- Avant : factures fournisseurs, photos de pertes, de réclamations et de
-- produits étaient écrites sur le disque du serveur (vidé à chaque révision
-- Cloud Run) et servies par /uploads SANS authentification.
-- Désormais : chaque fichier est une ligne de `files`, son contenu vit dans un
-- stockage objet (local en développement, bucket privé en production) et il est
-- lu par GET /api/v1/files/:id, authentifié.
--
-- `files` sert aussi de socle aux pièces jointes génériques (G7).
CREATE TABLE IF NOT EXISTS files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_key    text NOT NULL UNIQUE,
  original_name text NOT NULL,
  mime          text NOT NULL,
  size          bigint NOT NULL CHECK (size >= 0),
  sha256        char(64) NOT NULL,
  -- Nature de l'objet propriétaire : invoice, product, loss, complaint,
  -- maintenance, payment, generic. Décide de qui peut lire le fichier.
  owner_type    text NOT NULL,
  owner_id      uuid,
  store_id      uuid REFERENCES stores(id),
  uploaded_by   uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_files_owner ON files (owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_files_sha ON files (sha256);

-- Colonnes file_id à côté des colonnes d'URL existantes (les URL restent : elles
-- valent /api/v1/files/<id> pour un nouveau fichier, /uploads/... pour l'ancien).
ALTER TABLE products                  ADD COLUMN IF NOT EXISTS image_file_id            uuid REFERENCES files(id) ON DELETE SET NULL;
ALTER TABLE product_losses            ADD COLUMN IF NOT EXISTS photo_file_id            uuid REFERENCES files(id) ON DELETE SET NULL;
ALTER TABLE complaints                ADD COLUMN IF NOT EXISTS photo_file_id            uuid REFERENCES files(id) ON DELETE SET NULL;
ALTER TABLE maintenance_interventions ADD COLUMN IF NOT EXISTS photo_file_id            uuid REFERENCES files(id) ON DELETE SET NULL;
ALTER TABLE invoices                  ADD COLUMN IF NOT EXISTS attachment_file_id       uuid REFERENCES files(id) ON DELETE SET NULL;
ALTER TABLE payments                  ADD COLUMN IF NOT EXISTS check_attachment_file_id uuid REFERENCES files(id) ON DELETE SET NULL;

-- Le lien file_id se déduit de l'URL à l'écriture : aucun appelant n'a à le
-- poser. TG_ARGV[0] = colonne d'URL, TG_ARGV[1] = colonne file_id. Le fichier
-- reçoit en retour l'identifiant de son propriétaire s'il ne l'avait pas.
CREATE OR REPLACE FUNCTION trg_fn_file_id_from_url() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_url  text := to_jsonb(NEW) ->> TG_ARGV[0];
  v_id   uuid;
BEGIN
  IF v_url ~ '^/api/v1/files/[0-9a-fA-F-]{36}$' THEN
    v_id := substring(v_url from '[0-9a-fA-F-]{36}$')::uuid;
    IF NOT EXISTS (SELECT 1 FROM files f WHERE f.id = v_id) THEN
      v_id := NULL;
    END IF;
  END IF;
  NEW := jsonb_populate_record(NEW, jsonb_build_object(TG_ARGV[1], v_id));
  IF v_id IS NOT NULL THEN
    UPDATE files SET owner_id = NEW.id WHERE id = v_id AND owner_id IS NULL;
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
      ('products', 'image_url', 'image_file_id'),
      ('product_losses', 'photo_url', 'photo_file_id'),
      ('complaints', 'photo_url', 'photo_file_id'),
      ('maintenance_interventions', 'photo_url', 'photo_file_id'),
      ('invoices', 'attachment_url', 'attachment_file_id'),
      ('payments', 'check_attachment_url', 'check_attachment_file_id')
    ) AS v(tbl, url_col, id_col)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_file_id ON %I', t.tbl, t.tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_file_id BEFORE INSERT OR UPDATE OF %I ON %I
         FOR EACH ROW EXECUTE FUNCTION trg_fn_file_id_from_url(%L, %L)',
      t.tbl, t.url_col, t.tbl, t.url_col, t.id_col);
  END LOOP;
END $$;
