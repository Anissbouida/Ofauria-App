-- Migration 159 : Frais indirects au niveau recette
--
-- Probleme : aujourd'hui le cout d'un format n'inclut que la matiere (ingredients
-- + sous-recettes + emballages). Il manque :
--   - main d'oeuvre (temps des etapes × taux horaire)
--   - energie (cout estimatif de la fournee : four, batteur, etc.)
--   - frais de structure (overhead %, ex: 15% pour amortissement, loyer, etc.)
--
-- Solution : ajouter 3 colonnes a recipes (parametrables par recette) +
-- 2 defauts dans company_settings (initialisation lors de la creation d'une
-- recette).
--
-- Le calcul de l'agregation par format reste dans la vue
-- v_recipe_format_cost (mise a jour en migration 160), avec la meme regle de
-- proration au poids que pour la matiere.

ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS taux_main_oeuvre_dh_h DECIMAL(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cout_energie_fournee DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taux_frais_structure_pct DECIMAL(5,2) NOT NULL DEFAULT 0
    CHECK (taux_frais_structure_pct >= 0 AND taux_frais_structure_pct <= 100);

COMMENT ON COLUMN recipes.taux_main_oeuvre_dh_h IS
  'Taux horaire (DH/h) pour le calcul du cout main d''oeuvre. Multiplie par la duree totale des etapes (recipes.etapes[*].duree_estimee_min).';
COMMENT ON COLUMN recipes.cout_energie_fournee IS
  'Cout energie forfaitaire estime pour une fournee de cette recette (DH). Reparti ensuite par format au prorata du poids.';
COMMENT ON COLUMN recipes.taux_frais_structure_pct IS
  'Pourcentage de frais de structure (overhead) applique sur le cout direct (matiere + MO + energie). 0-100.';

-- Defaults d'entreprise pour pre-remplir les nouvelles recettes
ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS taux_main_oeuvre_defaut_dh_h DECIMAL(8,2) NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS taux_frais_structure_defaut_pct DECIMAL(5,2) NOT NULL DEFAULT 15;

COMMENT ON COLUMN company_settings.taux_main_oeuvre_defaut_dh_h IS
  'Taux horaire main d''oeuvre par defaut (DH/h, base 30 = standard pousse-pousse Maroc). Pre-rempli sur les nouvelles recettes.';
COMMENT ON COLUMN company_settings.taux_frais_structure_defaut_pct IS
  'Pourcentage frais de structure par defaut (15% = standard PME). Pre-rempli sur les nouvelles recettes.';

-- Backfill : on ne touche pas aux recettes existantes (gardent 0 pour ne pas
-- changer leur cout). Le chef peut ensuite les editer une par une, ou utiliser
-- un seul UPDATE de masse via l'UI Administration.
