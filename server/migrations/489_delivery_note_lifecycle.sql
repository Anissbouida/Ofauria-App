-- Phase 7.1 — Cycle de vie du bon de livraison : brouillon, préparé, expédié, livré.
--
-- Jusqu'ici un BL naissait « livré » (stock sorti à la création). On ajoute un cycle
-- DIFFÉRÉ, additif : un BL peut être créé « préparé » (sans mouvement de stock), puis
-- « expédié » (le stock sort en FEFO à ce moment), puis « livré ». Le flux immédiat
-- existant (création = livré, stock sorti aussitôt) reste le défaut et ne change pas.

ALTER TABLE delivery_notes ADD COLUMN IF NOT EXISTS prepared_at TIMESTAMPTZ;
ALTER TABLE delivery_notes ADD COLUMN IF NOT EXISTS prepared_by UUID REFERENCES users(id);

-- Étend les statuts autorisés (draft/prepared/shipped en plus de delivered/invoiced/cancelled).
ALTER TABLE delivery_notes DROP CONSTRAINT IF EXISTS delivery_notes_status_check;
ALTER TABLE delivery_notes ADD CONSTRAINT delivery_notes_status_check
  CHECK (status::text = ANY (ARRAY['draft','prepared','shipped','delivered','invoiced','cancelled']::text[]));
