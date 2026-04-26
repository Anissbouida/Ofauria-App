-- =====================================================================
-- Migration 103: Role Magasinier + workflow BSI intermediaire
--
-- Objectif : inserer une etape de preparation physique des ingredients
-- par un magasinier entre la demande du chef et la validation de
-- reception.
--
-- Workflow BSI etendu (additif, non-breaking) :
--   genere (chef a demande)
--     -> preparation (magasinier a pris en charge)         [NOUVEAU]
--        -> pret (magasinier a fini, chef notifie)          [NOUVEAU]
--           -> prelevement (chef valide reception)          [INCHANGE]
--              -> verifie -> cloture (flux existant)
--   Refus chef : pret -> preparation (avec motif)           [NOUVEAU]
--
-- ADDITIVE ONLY : aucune ligne existante n'est modifiee.
-- Les BSI deja en base gardent leur statut actuel. Le nouveau flow
-- ne s'applique qu'aux BSI generes apres deploiement si un magasinier
-- existe dans le store.
-- =====================================================================

-- 1. Ajouter 'magasinier' a la liste des roles autorises dans users.role
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (
  'admin', 'manager', 'cashier', 'baker', 'pastry_chef',
  'viennoiserie', 'beldi_sale', 'saleswoman', 'magasinier'
));

-- 2. Etendre le CHECK sur production_bons_sortie.status avec les nouveaux statuts
ALTER TABLE production_bons_sortie DROP CONSTRAINT IF EXISTS production_bons_sortie_status_check;
ALTER TABLE production_bons_sortie ADD CONSTRAINT production_bons_sortie_status_check CHECK (status IN (
  'genere', 'preparation', 'pret', 'prelevement', 'verifie', 'cloture', 'annule'
));

-- 3. Colonnes d'audit pour les nouveaux statuts
ALTER TABLE production_bons_sortie
  ADD COLUMN IF NOT EXISTS preparation_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS preparation_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ready_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS chef_reject_reason TEXT,
  ADD COLUMN IF NOT EXISTS chef_reject_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS chef_reject_by UUID REFERENCES users(id);

-- 4. Index sur status pour les requetes de notifications
--    (le magasinier cherche tous les BSI en 'preparation' dans son store,
--     le chef cherche tous les BSI en 'pret' qu'il a genere).
CREATE INDEX IF NOT EXISTS idx_bons_sortie_preparation_by ON production_bons_sortie(preparation_by) WHERE preparation_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bons_sortie_ready_by ON production_bons_sortie(ready_by) WHERE ready_by IS NOT NULL;
