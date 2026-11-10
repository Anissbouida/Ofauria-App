-- Migration 473 : code TVA par défaut sur l'article
--
-- Phase 3.6 (ERP multi-secteur) — chaque article porte son code TVA (N20, R10,
-- EXO_SDD…), référence vers le référentiel daté tax_codes (mig 331). La TVA
-- d'une ligne de vente découle alors de l'article plutôt que du « dernier taux
-- utilisé » (heuristique de delivery-note.repository.lineDefaults, qui notait
-- justement « taux n'est pas porté par la fiche produit »).
--
-- On stocke le CODE (texte), pas l'id d'une ligne tax_codes datée : ainsi un
-- changement de taux (nouvelle ligne datée du même code) s'applique
-- automatiquement, sans rien toucher sur les articles. La résolution code →
-- taux courant se fait à la lecture (lineDefaults), bornée au pays de la
-- société. Colonne nullable : un article sans code garde le comportement
-- antérieur (repli sur le dernier taux, ou saisie manuelle de la ligne).

ALTER TABLE products ADD COLUMN IF NOT EXISTS tax_code VARCHAR(20);
