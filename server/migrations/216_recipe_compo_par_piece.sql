-- Migration 216 : Convention de saisie de la composition (pièce vs fournée)
--
-- POURQUOI
--   Les recettes composées mélangent deux conventions :
--     - PAR FOURNÉE : la compo = tout le cadre (ex. Amandine : 800 g de pâte
--       d'amande pour le cadre 40×60 découpé en 50). Coût/pièce = total ÷ rendement.
--     - PAR PIÈCE   : la compo = une pièce (ex. entremets individuel : 70 g de mousse).
--       Coût/pièce = total directement.
--   Sans drapeau, impossible de coûter juste les deux → coûts/prix incohérents.
--
-- PORTÉE
--   ALTER TABLE recipes ADD compo_par_piece BOOLEAN NOT NULL DEFAULT false.
--   DEFAULT false = PAR FOURNÉE : correspond aux données existantes (cadres découpés).
--   Une recette réellement saisie par pièce sera basculée à true via l'UI.
--
-- INVERSION : ALTER TABLE recipes DROP COLUMN compo_par_piece;

ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS compo_par_piece BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN recipes.compo_par_piece IS
  'true = composition saisie PAR PIÈCE (coût/pièce = total) ; false (défaut) = PAR FOURNÉE (coût/pièce = total ÷ rendement).';
