-- Migration 297 : ingrédients rattachés aux étapes de production
--
-- POURQUOI
--   Depuis la mig 296, l'assistant de lancement déroule les étapes d'une recette,
--   mais la liste d'ingrédients affichée est la même à chaque étape : la recette
--   ne sait pas quel ingrédient sert à quelle étape. Le pâtissier doit voir à
--   l'étape « Blanchir les jaunes avec le sucre » les jaunes et le sucre, pas
--   les 8 ingrédients.
--
-- QUOI
--   Nouvelle clé optionnelle sur chaque étape du JSONB `recipes.etapes` :
--     "ingredient_refs": ["<ingredient_id>", "<ingredient_id>#2", ...]
--   Une réf = l'UUID de l'ingrédient ; quand le même ingrédient apparaît
--   plusieurs fois dans la recette (ex. crème pour l'infusion + crème montée),
--   le suffixe « #n » désigne la n-ième occurrence dans l'ordre des lignes
--   (recipe_ingredients.id croissant — l'ordre de saisie).
--   Clé absente = l'étape n'a pas été affectée (l'assistant montre toute la
--   recette). Clé présente et vide = aucune pesée à cette étape.
--
--   Ici : affectation manuelle pour les 8 recettes converties par la mig 296,
--   résolue par NOM d'ingrédient (les UUID diffèrent entre environnements) et,
--   pour les doublons, par quantité.
--
-- IDEMPOTENT : réécrit les refs des étapes citées, ne touche pas aux autres clés.

DO $$
DECLARE
  -- recette | n° étape | ingrédient | quantité (NULL = toutes occurrences)
  mapping text[][] := ARRAY[
    ['Bavaroise vanille',         '1', 'Lait',                         NULL],
    ['Bavaroise vanille',         '1', 'Crème fraîche',                '200'],
    ['Bavaroise vanille',         '1', 'Arôme vanille intense 1022',   NULL],
    ['Bavaroise vanille',         '2', 'Oeufs Jaune',                  NULL],
    ['Bavaroise vanille',         '2', 'Sucre semoule',                NULL],
    ['Bavaroise vanille',         '4', 'Gélatine en feuille',          NULL],
    ['Bavaroise vanille',         '5', 'Crème fraîche',                '416'],
    ['Amandes caramélisées',      '1', 'Sucre semoule',                NULL],
    ['Amandes caramélisées',      '1', 'Eau',                          NULL],
    ['Amandes caramélisées',      '2', 'Amande concassée',             NULL],
    ['Biscuit génoise chocolat',  '1', 'Oeufs entiers liquides',       NULL],
    ['Biscuit génoise chocolat',  '1', 'Sucre semoule',                NULL],
    ['Biscuit génoise chocolat',  '2', 'Farine Fleur',                 NULL],
    ['Biscuit génoise chocolat',  '2', 'Cacao en poudre 10/12',        NULL],
    ['Biscuit génoise chocolat',  '2', 'Levure chimique',              NULL],
    ['Mousse chocolat noir',      '1', 'Eau',                          NULL],
    ['Mousse chocolat noir',      '1', 'Sucre semoule',                NULL],
    ['Mousse chocolat noir',      '2', 'Oeufs entiers liquides',       NULL],
    ['Mousse chocolat noir',      '2', 'Oeufs Jaune',                  NULL],
    ['Mousse chocolat noir',      '3', 'Chocolat de couverture Noir 55%', NULL],
    ['Mousse chocolat noir',      '4', 'Crème fraîche',                NULL],
    ['Mousse praliné amande',     '1', 'Beurre',                       NULL],
    ['Mousse praliné amande',     '1', 'Praliné amande 50%',           NULL],
    ['Mousse praliné amande',     '2', 'Crème fraîche',                NULL],
    ['Pâte d’amande',             '1', 'Pâte d''amande 50%',           NULL],
    ['Sirop',                     '1', 'Eau',                          NULL],
    ['Sirop',                     '1', 'Sucre semoule',                NULL],
    ['Sirop 30°',                 '1', 'Eau',                          NULL],
    ['Sirop 30°',                 '1', 'Sucre semoule',                NULL]
  ];
  i int;
  r_id uuid;
  r_name text;
  step_ordre int;
  refs jsonb;
  new_etapes jsonb;
  e jsonb;
BEGIN
  FOR r_name IN SELECT DISTINCT mapping[k][1] FROM generate_subscripts(mapping, 1) AS k
  LOOP
    SELECT id INTO r_id FROM recipes WHERE name = r_name AND jsonb_array_length(COALESCE(etapes, '[]'::jsonb)) > 0
      ORDER BY (archived_at IS NULL) DESC, updated_at DESC LIMIT 1;
    IF r_id IS NULL THEN
      RAISE NOTICE 'Recette introuvable ou sans étapes, ignorée : %', r_name;
      CONTINUE;
    END IF;

    -- 1. Clé présente sur toutes les étapes (= étape affectée, même sans pesée).
    SELECT jsonb_agg(el || jsonb_build_object('ingredient_refs', COALESCE(el->'ingredient_refs', '[]'::jsonb)) ORDER BY ord)
      INTO new_etapes
      FROM jsonb_array_elements((SELECT etapes FROM recipes WHERE id = r_id)) WITH ORDINALITY AS t(el, ord);

    -- 2. Refs par étape.
    FOR step_ordre IN SELECT DISTINCT (el->>'ordre')::int FROM jsonb_array_elements(new_etapes) el
    LOOP
      refs := '[]'::jsonb;
      FOR i IN 1 .. array_length(mapping, 1)
      LOOP
        IF mapping[i][1] = r_name AND mapping[i][2]::int = step_ordre THEN
          SELECT COALESCE(jsonb_agg(ref ORDER BY ref), '[]'::jsonb) INTO e
            FROM (
              SELECT ri.ingredient_id::text
                     || CASE WHEN COUNT(*) OVER (PARTITION BY ri.ingredient_id) > 1
                             THEN '#' || ROW_NUMBER() OVER (PARTITION BY ri.ingredient_id ORDER BY ri.id)
                             ELSE '' END AS ref,
                     ri.quantity
                FROM recipe_ingredients ri
                JOIN ingredients ing ON ing.id = ri.ingredient_id
               WHERE ri.recipe_id = r_id AND ing.name = mapping[i][3]
            ) q
           WHERE mapping[i][4] IS NULL OR q.quantity = mapping[i][4]::numeric;
          IF jsonb_array_length(e) = 0 THEN
            RAISE NOTICE '% / étape % : ingrédient « % » (qté %) introuvable', r_name, step_ordre, mapping[i][3], mapping[i][4];
          END IF;
          refs := refs || e;
        END IF;
      END LOOP;

      SELECT jsonb_agg(
               CASE WHEN (el->>'ordre')::int = step_ordre
                    THEN el || jsonb_build_object('ingredient_refs', refs)
                    ELSE el END
               ORDER BY ord)
        INTO new_etapes
        FROM jsonb_array_elements(new_etapes) WITH ORDINALITY AS t(el, ord);
    END LOOP;

    UPDATE recipes SET etapes = new_etapes, updated_at = NOW() WHERE id = r_id;
    RAISE NOTICE 'Refs affectées : %', r_name;
  END LOOP;
END $$;
