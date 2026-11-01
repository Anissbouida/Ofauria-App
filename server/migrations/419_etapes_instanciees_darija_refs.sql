-- 419 — Darija et ingrédients pesés sur les étapes instanciées en production (L4 procédé)
--
-- POURQUOI
--   La fiche technique (recipes.etapes JSONB) porte, depuis les mig 294/295 et 297,
--   trois informations d'exécution que l'écran d'atelier (production_item_etapes,
--   mig 089/342/399) n'affichait pas :
--     - nom_ar / checklist_items_ar : la consigne en darija, pour l'ouvrier ;
--     - ingredient_refs             : les ingrédients pesés à CETTE étape (mig 297).
--   initializeForItem (lancement d'une ligne de plan) copiait le type, la
--   température, l'humidité, la durée et la checklist FR, mais laissait tomber la
--   darija et les affectations d'ingrédients : seul l'assistant de lancement, qui
--   relit la recette, les montrait. Le tableau de bord atelier restait aveugle.
--
-- QUOI
--   Trois colonnes miroir sur l'étape instanciée, remplies à la copie (cf.
--   production-etapes.repository.initializeForItem) et affichées sur l'écran
--   d'atelier (EtapesPanel). Les refs restent l'UUID de l'ingrédient (+ « #n »
--   pour la n-ième occurrence) ; le nom est résolu à la lecture par jointure.
--
-- RÉTRO-REMPLISSAGE
--   Les étapes déjà instanciées et NON terminées des plans en cours sont
--   complétées depuis leur source (surcharges profil produit sinon recette),
--   appariées par `ordre`, uniquement quand les trois colonnes sont encore vides.
--   Rejouable, n'écrase jamais une valeur déjà posée ni une étape terminée.
--
-- INVERSION
--   ALTER TABLE production_item_etapes
--     DROP COLUMN IF EXISTS ingredient_refs,
--     DROP COLUMN IF EXISTS checklist_items_ar,
--     DROP COLUMN IF EXISTS nom_ar;

ALTER TABLE production_item_etapes
  ADD COLUMN IF NOT EXISTS nom_ar             VARCHAR(300),
  ADD COLUMN IF NOT EXISTS checklist_items_ar JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS ingredient_refs    JSONB NOT NULL DEFAULT '[]';

COMMENT ON COLUMN production_item_etapes.nom_ar IS
  'Libellé darija de l''étape (mig 294/295), copié de la fiche à l''instanciation (mig 419).';
COMMENT ON COLUMN production_item_etapes.checklist_items_ar IS
  'Points de contrôle en darija (mig 294/295), copiés de la fiche à l''instanciation (mig 419).';
COMMENT ON COLUMN production_item_etapes.ingredient_refs IS
  'Ingrédients pesés à cette étape (mig 297) : "<ingredient_id>" ou "<ingredient_id>#n". Copiés de la fiche à l''instanciation (mig 419).';

-- ─── Rétro-remplissage des étapes en cours ─────────────────────────────────
UPDATE production_item_etapes pie
SET nom_ar             = COALESCE(NULLIF(q.src->>'nom_ar', ''), pie.nom_ar),
    checklist_items_ar = CASE WHEN jsonb_typeof(q.src->'checklist_items_ar') = 'array'
                              THEN q.src->'checklist_items_ar' ELSE pie.checklist_items_ar END,
    ingredient_refs    = CASE WHEN jsonb_typeof(q.src->'ingredient_refs') = 'array'
                              THEN q.src->'ingredient_refs' ELSE pie.ingredient_refs END
FROM (
  SELECT pie0.id AS pie_id,
         (SELECT el
            FROM jsonb_array_elements(
                   CASE WHEN jsonb_array_length(COALESCE(ppp.etapes_surcharges, '[]'::jsonb)) > 0
                        THEN ppp.etapes_surcharges
                        ELSE COALESCE(r.etapes, '[]'::jsonb) END) el
           WHERE (el->>'ordre')::int = pie0.ordre
           LIMIT 1) AS src
    FROM production_item_etapes pie0
    JOIN production_plan_items ppi ON ppi.id = pie0.plan_item_id
    LEFT JOIN LATERAL (
      SELECT r0.etapes
        FROM recipes r0
       WHERE r0.id = ppi.base_recipe_id
          OR (ppi.base_recipe_id IS NULL AND ppi.product_id IS NOT NULL
              AND (r0.product_id = ppi.product_id
                   OR r0.id IN (SELECT rf.recipe_id FROM recipe_formats rf
                                 WHERE rf.product_id = ppi.product_id AND rf.is_active)))
       ORDER BY (r0.id = ppi.base_recipe_id) DESC NULLS LAST,
                (r0.product_id = ppi.product_id) DESC NULLS LAST
       LIMIT 1
    ) r ON true
    LEFT JOIN produit_profil_production ppp ON ppp.produit_id = ppi.product_id
   WHERE pie0.status <> 'completed'
) q
WHERE q.pie_id = pie.id
  AND q.src IS NOT NULL
  AND COALESCE(pie.nom_ar, '') = ''
  AND pie.checklist_items_ar = '[]'::jsonb
  AND pie.ingredient_refs = '[]'::jsonb;
