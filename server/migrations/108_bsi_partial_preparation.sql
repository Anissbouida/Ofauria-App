-- Phase 1 BSI partiel : nouveau status 'preparation_partielle' pour BSI
-- ou la magasiniere a preleve ce qu'elle pouvait + lignes en attente
-- d'approvisionnement (status='rupture' ou 'en_attente').
ALTER TABLE production_bons_sortie DROP CONSTRAINT IF EXISTS production_bons_sortie_status_check;
ALTER TABLE production_bons_sortie ADD CONSTRAINT production_bons_sortie_status_check
  CHECK (status::text = ANY (ARRAY[
    'genere', 'preparation', 'preparation_partielle',
    'pret', 'prelevement', 'verifie', 'cloture', 'annule'
  ]::varchar[]));

-- Tracage des moments cles de la prep partielle
ALTER TABLE production_bons_sortie
  ADD COLUMN IF NOT EXISTS partial_committed_at timestamptz,
  ADD COLUMN IF NOT EXISTS partial_committed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS partial_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS partial_completed_by uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bons_sortie_partial
  ON production_bons_sortie (status) WHERE status = 'preparation_partielle';
