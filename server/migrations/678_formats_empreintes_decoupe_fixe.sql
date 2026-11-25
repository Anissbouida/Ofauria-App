-- ═══════════════════════════════════════════════════════════════════════
-- 678 — Formats : empreintes, capacité, découpe calculée, composant fixe (audit C-15/16/17)
-- ═══════════════════════════════════════════════════════════════════════
-- POURQUOI
--   Les dimensions du contenant étaient saisies sans servir à rien ; aucun nombre d'empreintes
--   ni capacité ; tout composant était proportionnel (une gousse de vanille par cuve, un
--   décor par cadre se multipliaient avec la fraction de fournée).
--
-- QUOI
--   production_contenants : nb_empreintes (plaques à empreintes), capacite_qty + capacite_unit
--     (contenance d'un moule ou d'une cuve), portion_longueur_cm, portion_largeur_cm et
--     bordure_cm (découpe : nombre de portions proposé = (L − 2 bordures) ÷ portion ×
--     (l − 2 bordures) ÷ portion ; le rendement validé par le chef reste la référence).
--   recipe_format_components.quantite_fixe / recipe_components.quantite_fixe : quantité par
--     fournée entière, quel que soit le nombre de pièces (arrondie à la fournée supérieure).
--   fn_sync_recipe_mirror : recopie aussi quantite_fixe dans le miroir.
--
-- INVERSION
--   DROP COLUMN des colonnes ci-dessus ; recréer fn_sync_recipe_mirror sans quantite_fixe.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE production_contenants
  ADD COLUMN IF NOT EXISTS nb_empreintes integer CHECK (nb_empreintes IS NULL OR nb_empreintes > 0),
  ADD COLUMN IF NOT EXISTS capacite_qty numeric(12,3) CHECK (capacite_qty IS NULL OR capacite_qty > 0),
  ADD COLUMN IF NOT EXISTS capacite_unit varchar(10),
  ADD COLUMN IF NOT EXISTS portion_longueur_cm numeric(6,2) CHECK (portion_longueur_cm IS NULL OR portion_longueur_cm > 0),
  ADD COLUMN IF NOT EXISTS portion_largeur_cm numeric(6,2) CHECK (portion_largeur_cm IS NULL OR portion_largeur_cm > 0),
  ADD COLUMN IF NOT EXISTS bordure_cm numeric(6,2) CHECK (bordure_cm IS NULL OR bordure_cm >= 0);

ALTER TABLE recipe_format_components ADD COLUMN IF NOT EXISTS quantite_fixe boolean NOT NULL DEFAULT false;
ALTER TABLE recipe_components ADD COLUMN IF NOT EXISTS quantite_fixe boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN recipe_format_components.quantite_fixe IS 'Quantité par fournée entière, non proportionnelle au nombre de pièces (mig 678)';

CREATE OR REPLACE FUNCTION public.fn_sync_recipe_mirror(p_recipe_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  DELETE FROM recipe_components WHERE recipe_id = p_recipe_id;
  INSERT INTO recipe_components (recipe_id, role, source_recipe_id, source_ingredient_id, quantite, unite, ordre, perte_pct, pct, quantite_fixe)
  SELECT f.recipe_id, fc.role, fc.source_recipe_id, fc.source_ingredient_id, fc.quantite, fc.unite, fc.ordre, COALESCE(fc.perte_pct, 0), fc.pct, COALESCE(fc.quantite_fixe, false)
  FROM recipe_format_components fc
  JOIN recipe_formats f ON f.id = fc.format_id
  WHERE f.recipe_id = p_recipe_id AND f.is_default AND f.is_active
    AND fc.source_packaging_id IS NULL;
END;
$function$;
