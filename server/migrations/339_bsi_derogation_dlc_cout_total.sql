-- Migration 339 : derogation DLC tracee sur le BSI + cout_total coherent.
--
-- POURQUOI (audit Production & Fiches techniques 2026-10-23, §4.2 et §4.3)
--   1. L'allocation du bon de sortie prenait les lots `expired` (et les lots
--      `active` a DLC passee) avec un simple libelle « DLC depassee ». Un lot
--      perime ne doit plus etre alloue PAR DEFAUT ; il ne peut l'etre que sur
--      derogation explicite du chef, avec motif, auteur et horodatage traces
--      (exigence ONSSA / HACCP : la decision d'utiliser un lot hors DLC doit
--      etre attribuable).
--   2. production_cout_reel.cout_total (mig 090) additionnait cout_pertes aux
--      matieres : or les pertes sont VALORISEES au cout matiere deja compte
--      dans cout_matieres (double comptage), et cout_charges_fixes (mig 118)
--      n'y figurait pas. Le panneau front calculait deja son propre total.
--      cout_total = matieres + main d'oeuvre + energie + charges fixes ;
--      cout_pertes devient un « dont » informatif.
--
-- PORTEE
--   production_bons_sortie : 3 colonnes nullables (derogation).
--   production_bons_sortie_lignes : 1 booleen (ligne servie sur lot hors DLC).
--   production_cout_reel : colonne generee cout_total redefinie (DROP + ADD,
--   aucune vue ne la reference).
--
-- INVERSION
--   ALTER TABLE production_bons_sortie DROP COLUMN derogation_dlc_motif,
--     DROP COLUMN derogation_dlc_by, DROP COLUMN derogation_dlc_at;
--   ALTER TABLE production_bons_sortie_lignes DROP COLUMN derogation_dlc;
--   ALTER TABLE production_cout_reel DROP COLUMN cout_total;
--   ALTER TABLE production_cout_reel ADD COLUMN cout_total DECIMAL(12,2)
--     GENERATED ALWAYS AS (cout_matieres + cout_main_oeuvre + cout_energie + cout_pertes) STORED;

ALTER TABLE production_bons_sortie
  ADD COLUMN IF NOT EXISTS derogation_dlc_motif TEXT,
  ADD COLUMN IF NOT EXISTS derogation_dlc_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS derogation_dlc_at TIMESTAMPTZ;

COMMENT ON COLUMN production_bons_sortie.derogation_dlc_motif IS
  'Motif de la derogation autorisant l''allocation de lots a DLC depassee. NULL = aucune derogation, les lots perimes sont exclus.';

ALTER TABLE production_bons_sortie_lignes
  ADD COLUMN IF NOT EXISTS derogation_dlc BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN production_bons_sortie_lignes.derogation_dlc IS
  'true = cette ligne est servie sur un lot hors DLC, sous derogation tracee sur l''en-tete.';

ALTER TABLE production_cout_reel DROP COLUMN IF EXISTS cout_total;
ALTER TABLE production_cout_reel
  ADD COLUMN cout_total DECIMAL(12,2)
  GENERATED ALWAYS AS (cout_matieres + cout_main_oeuvre + cout_energie + COALESCE(cout_charges_fixes, 0)) STORED;

COMMENT ON COLUMN production_cout_reel.cout_total IS
  'Cout de revient = matieres + main d''oeuvre + energie + charges fixes. cout_pertes est un « dont » (valorisation des pertes deja incluses dans les matieres), pas un terme additif.';
