-- Migration 265 : suppression douce des lignes (module Contrôle des ventes, ISOLE, TEMPORAIRE).
--
-- POURQUOI
--   Supprimer une ligne d'un produit à report (PÂTISSERIE CLASSIQUE / PREMIUM)
--   ne « tenait pas » : la synchro syncCarryOver / syncPassation, rejouée à
--   chaque ouverture de la journée, recréait la ligne à partir du reste de la
--   veille (ou du comptage de passation). Le front recharge la journée juste
--   après la suppression → la ligne réapparaissait aussitôt.
--
--   Correctif : suppression DOUCE. La ligne effacée est marquée hidden = true
--   (tombstone) au lieu d'être détruite. La synchro ne la ressuscite plus (elle
--   met à jour le report mais laisse hidden), la grille l'exclut, et ré-importer
--   ou ré-ajouter le produit la ré-affiche (hidden repassé à false côté appli).
--
-- DROP : ALTER TABLE recon_lines DROP COLUMN IF EXISTS hidden;

ALTER TABLE recon_lines ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false;

-- Filtre courant (grille, agrégats, report de période) : les lignes visibles.
CREATE INDEX IF NOT EXISTS idx_recon_lines_visible ON recon_lines(recon_shift_id) WHERE NOT hidden;
