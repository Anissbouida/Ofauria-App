-- ═══════════════════════════════════════════════════════════════════════
-- 662 — Règle de lot du format (fabrication par fournées entières)
-- ═══════════════════════════════════════════════════════════════════════
-- POURQUOI (audit production pâtissière 2026-11, C-04 / C-05)
--   Le calcul des besoins était une règle de trois : 130 tranches d'opéra pour un cadre de 48
--   donnaient 2,708 cadres. Un cadre, une plaque ou une cuve ne se fabrique pas en fraction :
--   il faut 3 cadres, 144 tranches prévues et 14 d'excédent. Le seul arrondi au contenant
--   existant (plans issus d'une commande) lisait recipes.contenant_id, que plus aucune fiche
--   ne renseigne.
--
-- QUOI
--   recipe_formats.lot_rule : 'partiel' (défaut, comportement inchangé : toute quantité)
--                             'entier'  (la quantité planifiée est arrondie à la fournée supérieure)
--   recipe_formats.lot_min / lot_max : nombre de fournées minimal / maximal par ordre.
--     lot_min relève la quantité ; lot_max ne l'écrête jamais, il déclenche un avertissement.
--   production_plan_items.requested_quantity : quantité demandée avant arrondi (NULL si la
--     quantité planifiée est la quantité demandée). L'excédent prévu = planned − requested.
--   production_plan_items.nb_contenants (existant, jamais rempli) reçoit le nombre de fournées.
--
--   Valeur par défaut 'partiel' : aucun ordre existant ni aucune fiche ne change de quantité
--   tant que le chef n'a pas choisi « fournées entières » sur le format.
--
-- INVERSION
--   ALTER TABLE recipe_formats DROP COLUMN lot_rule, DROP COLUMN lot_min, DROP COLUMN lot_max ;
--   ALTER TABLE production_plan_items DROP COLUMN requested_quantity.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE recipe_formats
  ADD COLUMN IF NOT EXISTS lot_rule varchar(10) NOT NULL DEFAULT 'partiel',
  ADD COLUMN IF NOT EXISTS lot_min  numeric(8,2),
  ADD COLUMN IF NOT EXISTS lot_max  numeric(8,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_recipe_formats_lot_rule') THEN
    ALTER TABLE recipe_formats ADD CONSTRAINT chk_recipe_formats_lot_rule
      CHECK (lot_rule IN ('partiel', 'entier'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_recipe_formats_lot_bounds') THEN
    ALTER TABLE recipe_formats ADD CONSTRAINT chk_recipe_formats_lot_bounds
      CHECK ((lot_min IS NULL OR lot_min > 0)
         AND (lot_max IS NULL OR lot_max > 0)
         AND (lot_min IS NULL OR lot_max IS NULL OR lot_max >= lot_min));
  END IF;
END $$;

COMMENT ON COLUMN recipe_formats.lot_rule IS
  'Règle de lot : partiel = toute quantité ; entier = arrondi à la fournée supérieure (mig 662)';
COMMENT ON COLUMN recipe_formats.lot_min IS 'Nombre minimal de fournées par ordre (mig 662)';
COMMENT ON COLUMN recipe_formats.lot_max IS 'Nombre maximal de fournées par ordre : avertissement au-delà (mig 662)';

ALTER TABLE production_plan_items
  ADD COLUMN IF NOT EXISTS requested_quantity double precision;

COMMENT ON COLUMN production_plan_items.requested_quantity IS
  'Quantité demandée avant arrondi à la fournée ; NULL si planned_quantity est la demande (mig 662)';
