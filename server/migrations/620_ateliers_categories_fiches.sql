-- 620 — Atelier d'une fiche technique (scénario 1, constat 106).
--
-- POURQUOI
--   Le droit « modifier une fiche » valait pour toutes les fiches : la cheffe beldi
--   modifiait une fiche de pâtisserie. Comme pour les ordres de fabrication (M2-06),
--   un chef ne modifie plus que les fiches de ses ateliers ; le droit
--   « production.all_workshops » (administrateur, gérant) lève la restriction.
--
-- ATELIER D'UNE FICHE
--   1. la catégorie du produit lié (production_workshop_categories, mig 511) ;
--   2. à défaut, la catégorie de production de la fiche (recipe_categories), reliée
--      ici à un atelier (nouvelle table, réglée dans Paramètres › Ateliers) ;
--   3. sinon aucune : fiche commune (préparations de base), modifiable par tout chef.
--
-- REPRISE
--   Chaque catégorie de fiche est reliée à l'atelier de même code, de code préfixe
--   (« sale_traiteur » → « sale ») ou de même libellé ; puis les correspondances des
--   catégories d'origine (mig 166) vers les ateliers repris des rôles (mig 511).
--   « base_production » reste sans atelier.
--
-- INVERSION
--   DROP TABLE production_workshop_recipe_categories.

CREATE TABLE IF NOT EXISTS production_workshop_recipe_categories (
  recipe_category_id  UUID PRIMARY KEY REFERENCES recipe_categories(id) ON DELETE CASCADE,
  workshop_code       VARCHAR(30) NOT NULL REFERENCES production_workshops(code) ON DELETE CASCADE ON UPDATE CASCADE
);

COMMENT ON TABLE production_workshop_recipe_categories IS
  'Catégorie de production des fiches → atelier (mig 620). Une catégorie relève d''un seul atelier ; sans ligne, la fiche est commune.';

-- Reprise 1 : même code, code préfixe, même libellé.
INSERT INTO production_workshop_recipe_categories (recipe_category_id, workshop_code)
SELECT DISTINCT ON (rc.id) rc.id, w.code
  FROM recipe_categories rc
  JOIN production_workshops w
    ON w.code = rc.code
    OR rc.code LIKE w.code || '\_%'
    OR lower(w.label) = lower(rc.label)
 WHERE rc.code <> 'base_production'
 ORDER BY rc.id, (w.code = rc.code) DESC, (lower(w.label) = lower(rc.label)) DESC, w.sort_order
ON CONFLICT (recipe_category_id) DO NOTHING;

-- Reprise 2 : catégories d'origine (mig 166) → ateliers repris des rôles (mig 511).
INSERT INTO production_workshop_recipe_categories (recipe_category_id, workshop_code)
SELECT rc.id, v.workshop
  FROM (VALUES ('boulangerie', 'baker'), ('viennoiserie', 'viennoiserie'), ('patisserie', 'pastry_chef'),
               ('sale_beldi', 'beldi_sale'), ('gateaux_marocains', 'beldi_sale')) AS v(code, workshop)
  JOIN recipe_categories rc ON rc.code = v.code
  JOIN production_workshops w ON w.code = v.workshop
ON CONFLICT (recipe_category_id) DO NOTHING;
