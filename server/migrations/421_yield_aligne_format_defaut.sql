-- 421 — Rendement des recettes composées aligné sur le format par défaut (reste L1)
--
-- POURQUOI
--   Le besoin matière du MRP (mrp.repository.materialRequirements) explose la
--   demande en ingrédients via v_recipe_explosion (mig 400), puis ramène au
--   nombre de pièces en divisant par recipes.yield_quantity. Or, en mode
--   « compose », v_recipe_explosion est calé sur recipe_components — le MIROIR
--   du format par défaut (mig 411/412) : son total correspond à UNE fournée du
--   format par défaut, pas à une fournée « de base ». La production, elle, compte
--   déjà les pièces avec nb_par_defaut du format (findByFormat). Quand
--   yield_quantity diverge de ce nb_par_defaut, le MRP commande au mauvais ratio
--   (ex. Baguette normale : 1250 g de pâte, format = 10 pièces/125 g, mais
--   yield = 5 → le MRP comptait 250 g/pièce et commandait 2× trop ; Opéra :
--   format = 24 parts, yield = 30).
--
-- QUOI
--   Pour toute recette COMPOSÉE rendue à la pièce (yield_unit = 'unit') dotée d'un
--   format par défaut actif, on cale yield_quantity sur le nb_par_defaut de ce
--   format : l'invariant « le diviseur du MRP = la base de v_recipe_explosion »
--   redevient vrai, sans toucher au SQL du MRP. Les recettes non composées (base
--   = recipe_ingredients, pas le format) ne sont PAS touchées : leur diviseur
--   légitime reste yield_quantity.
--
-- IDEMPOTENT : ne modifie que les lignes où yield_quantity diffère déjà du
--   nb_par_defaut ; rejouable sans effet une fois alignées.
--
-- INVERSION : aucune (correction de donnée ; les anciennes valeurs étaient fausses).

DO $$
DECLARE
  r RECORD;
  n INT := 0;
BEGIN
  FOR r IN
    SELECT rec.id, rec.name, rec.yield_quantity AS old_yield, df.nb_par_defaut AS new_yield
      FROM recipes rec
      JOIN LATERAL (
        SELECT rf.nb_par_defaut
          FROM recipe_formats rf
         WHERE rf.recipe_id = rec.id AND rf.is_active AND rf.is_default
         ORDER BY rf.ordre
         LIMIT 1
      ) df ON true
     WHERE rec.mode_cout::text = 'compose'
       AND rec.yield_unit = 'unit'
       AND df.nb_par_defaut IS NOT NULL
       AND df.nb_par_defaut >= 1
       AND rec.yield_quantity IS DISTINCT FROM df.nb_par_defaut::numeric
  LOOP
    UPDATE recipes SET yield_quantity = r.new_yield, updated_at = NOW() WHERE id = r.id;
    RAISE NOTICE 'Recette % : yield_quantity % → % (format par défaut)', r.name, r.old_yield, r.new_yield;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Migration 421 : % recette(s) alignée(s) sur le format par défaut.', n;
END $$;
