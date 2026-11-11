-- Phase 11 (D3-22) — versions et révisions de devis.
--
-- Avant : « Dupliquer » posait revision_of, mais sans numéro de version, sans
-- instantané de la version envoyée, et l'original n'était pas remplacé. Désormais
-- une révision copie le devis, incrémente la version, et l'original est figé et
-- marqué « remplacé par » la nouvelle version (snapshot immuable). Additif :
-- colonnes neuves, les devis existants restent en version 1, non remplacés.

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES quotes(id);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_quotes_revision_of ON quotes (revision_of) WHERE revision_of IS NOT NULL;
