-- Migration 296 : étapes de production générées depuis le « Procédé » numéroté
--
-- POURQUOI
--   L'assistant de lancement (ProductionLaunchModal) n'affiche les étapes de
--   production (minuteur, checklist, blocage) que si la recette a des étapes
--   STRUCTURÉES dans `recipes.etapes`. Sinon il retombe sur le parcours générique
--   Lancement → Recette → Enregistrement et montre le texte libre des
--   instructions. Les bases importées avec un « Procédé : 1. … 2. … » dans
--   `instructions` (bavaroise, génoise, mousses, sirops…) n'avaient donc aucune
--   étape dans le processus.
--
-- QUOI
--   Pour chaque recette SANS étape dont les instructions contiennent des lignes
--   numérotées (`1. …`, `2) …`), chaque ligne devient une étape simple, dans
--   l'ordre : pas de minuteur, pas de checklist, non bloquante, sans rôle.
--   Le texte des instructions reste intact. Les minuteurs / contrôles qualité
--   s'affinent ensuite dans l'éditeur de recette.
--
--   Schéma d'étape = celui des fiches masterclass (migs 291-295), darija dans
--   des champs séparés laissés vides (`nom_ar`, `checklist_items_ar`).
--
-- IDEMPOTENT : ne touche que les recettes dont `etapes` est vide.

WITH src AS (
  SELECT r.id, l.line, l.pos
  FROM recipes r
  CROSS JOIN LATERAL regexp_split_to_table(r.instructions, E'\n') WITH ORDINALITY AS l(line, pos)
  WHERE jsonb_array_length(COALESCE(r.etapes, '[]'::jsonb)) = 0
    AND r.instructions ~ '(^|\n)\s*\d+[\.\)]\s'
),
steps AS (
  SELECT id, pos,
         btrim((regexp_match(line, '^\s*\d+[\.\)]\s*(.+?)\s*$'))[1]) AS nom
  FROM src
  WHERE line ~ '^\s*\d+[\.\)]\s'
),
numbered AS (
  SELECT id, pos, nom,
         row_number() OVER (PARTITION BY id ORDER BY pos) AS ordre
  FROM steps
  WHERE nom IS NOT NULL AND nom <> ''
),
agg AS (
  SELECT id,
         jsonb_agg(
           jsonb_build_object(
             'nom', nom,
             'nom_ar', '',
             'ordre', ordre,
             'timer_auto', false,
             'duree_estimee_min', NULL,
             'est_bloquante', false,
             'est_repetable', false,
             'nb_repetitions', 1,
             'controle_qualite', false,
             'checklist_items', '[]'::jsonb,
             'checklist_items_ar', '[]'::jsonb,
             'responsable_role', NULL
           )
           ORDER BY pos
         ) AS etapes
  FROM numbered
  GROUP BY id
)
UPDATE recipes r
   SET etapes = agg.etapes,
       updated_at = NOW()
  FROM agg
 WHERE r.id = agg.id;
