-- Migration 344 : referentiel ferme des 14 allergenes sur ingredients.allergens
--
-- POURQUOI
--   ingredients.allergens (TEXT[], mig 004) acceptait n'importe quelle chaine :
--   « Gluten », « gluten », « blé », « farine »... La vue v_recipe_allergens
--   (mig 343) dedoublonne la casse mais ne peut pas savoir que « blé » et
--   « gluten » sont le meme allergene. Pour une mention d'etiquetage, il faut
--   un vocabulaire ferme : les 14 allergenes a declaration obligatoire
--   (reglement UE 1169/2011 annexe II, repris au Maroc).
--
-- CODES (stockes en base, libelles cote application)
--   gluten, crustaces, oeufs, poissons, arachides, soja, lait, fruits_a_coque,
--   celeri, moutarde, sesame, sulfites, lupin, mollusques
--
-- CE QUE FAIT CETTE MIGRATION
--   1. Normalise les valeurs existantes : minuscules sans accents, synonymes
--      usuels (ble/farine -> gluten, amande/noisette/noix -> fruits_a_coque,
--      lactose/beurre/creme -> lait, cacahuete -> arachides...), dedoublonnage,
--      ordre du referentiel. Les valeurs NON reconnues sont CONSERVEES telles
--      quelles (jamais de perte d'information silencieuse) et listees dans un
--      WARNING nominatif pour que le chef les requalifie depuis la fiche.
--   2. Pose un CHECK « allergens <@ referentiel » en NOT VALID : les nouvelles
--      ecritures sont contraintes, les lignes historiques non reconnues ne
--      bloquent pas la migration. Une fois le referentiel propre :
--        ALTER TABLE ingredients VALIDATE CONSTRAINT chk_ingredients_allergens;
--
-- PORTEE
--   UPDATE sur ingredients.allergens (rejouable, idempotent) + 1 CHECK NOT VALID.
--
-- INVERSION
--   ALTER TABLE ingredients DROP CONSTRAINT IF EXISTS chk_ingredients_allergens;
--   (les valeurs normalisees restent, elles sont un sous-ensemble valide de l'ancien libre.)

CREATE OR REPLACE FUNCTION pg_temp.fn_allergen_code(p_raw text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  WITH k AS (
    -- La ligature œ vaut deux lettres : replace() avant translate(), qui ne fait que du 1 pour 1.
    SELECT btrim(regexp_replace(
             translate(replace(replace(lower(p_raw), 'œ', 'oe'), 'Œ', 'oe'),
                       'àáâäãåāçèéêëēìíîïīñòóôöõøōùúûüūýÿ',
                       'aaaaaaaceeeeeiiiiinoooooooouuuuuyy'),
             '[_[:space:]]+', ' ', 'g')) AS key
  )
  SELECT CASE
    WHEN key IN ('gluten','ble','ble tendre','farine','seigle','orge','avoine','epeautre','cereales','cereales contenant du gluten') THEN 'gluten'
    WHEN key IN ('crustaces','crustace','crevette','crevettes','crabe') THEN 'crustaces'
    WHEN key IN ('oeufs','oeuf','egg','eggs') THEN 'oeufs'
    WHEN key IN ('poissons','poisson','thon','saumon') THEN 'poissons'
    WHEN key IN ('arachides','arachide','cacahuete','cacahuetes','peanut') THEN 'arachides'
    WHEN key IN ('soja','soya','soy') THEN 'soja'
    WHEN key IN ('lait','lactose','laitier','produits laitiers','beurre','creme','fromage','milk') THEN 'lait'
    WHEN key IN ('fruits a coque','fruit a coque','fruits a coques','amande','amandes','noisette','noisettes','noix','pistache','pistaches','noix de cajou','noix de pecan','nuts') THEN 'fruits_a_coque'
    WHEN key IN ('celeri','celeri-rave') THEN 'celeri'
    WHEN key IN ('moutarde') THEN 'moutarde'
    WHEN key IN ('sesame','graines de sesame') THEN 'sesame'
    WHEN key IN ('sulfites','sulfite','anhydride sulfureux','so2') THEN 'sulfites'
    WHEN key IN ('lupin') THEN 'lupin'
    WHEN key IN ('mollusques','mollusque','calamar','moule','moules','escargot') THEN 'mollusques'
    ELSE NULL
  END FROM k
$$;

-- 1. Normalisation : codes reconnus (dedoublonnes, ordre du referentiel) + valeurs inconnues conservees.
UPDATE ingredients i
   SET allergens = n.normalized
  FROM (
    SELECT id,
           ARRAY(
             SELECT c FROM unnest(ARRAY['gluten','crustaces','oeufs','poissons','arachides','soja','lait','fruits_a_coque','celeri','moutarde','sesame','sulfites','lupin','mollusques']) WITH ORDINALITY AS ref(c, ord)
              WHERE c = ANY (SELECT pg_temp.fn_allergen_code(a) FROM unnest(allergens) a WHERE btrim(a) <> '')
              ORDER BY ord
           )
           || ARRAY(
             SELECT DISTINCT btrim(a) FROM unnest(allergens) a
              WHERE btrim(a) <> '' AND pg_temp.fn_allergen_code(a) IS NULL
           ) AS normalized
      FROM ingredients
     WHERE allergens IS NOT NULL AND cardinality(allergens) > 0
  ) n
 WHERE n.id = i.id AND i.allergens IS DISTINCT FROM n.normalized;

-- 2. Signalement nominatif des valeurs hors referentiel (conservees).
DO $$
DECLARE n INT; restants TEXT;
BEGIN
  SELECT count(*), string_agg(name || ' [' || array_to_string(bad, ', ') || ']', ' ; ' ORDER BY name)
    INTO n, restants
    FROM (
      SELECT i.name,
             ARRAY(SELECT a FROM unnest(i.allergens) a
                    WHERE a <> ALL (ARRAY['gluten','crustaces','oeufs','poissons','arachides','soja','lait','fruits_a_coque','celeri','moutarde','sesame','sulfites','lupin','mollusques'])) AS bad
        FROM ingredients i
       WHERE i.allergens IS NOT NULL
    ) s
   WHERE cardinality(bad) > 0;
  IF n > 0 THEN
    RAISE WARNING 'Allergenes hors referentiel conserves sur % ingredient(s), a requalifier depuis la fiche : %', n, restants;
  END IF;
END $$;

-- 3. Contrainte pour les nouvelles ecritures (NOT VALID : l'historique non reconnu ne bloque pas).
ALTER TABLE ingredients DROP CONSTRAINT IF EXISTS chk_ingredients_allergens;
ALTER TABLE ingredients
  ADD CONSTRAINT chk_ingredients_allergens
  CHECK (allergens IS NULL OR allergens <@ ARRAY['gluten','crustaces','oeufs','poissons','arachides','soja','lait','fruits_a_coque','celeri','moutarde','sesame','sulfites','lupin','mollusques']::text[])
  NOT VALID;

COMMENT ON COLUMN ingredients.allergens IS
  'Codes du referentiel des 14 allergenes (mig 344) : gluten, crustaces, oeufs, poissons, arachides, soja, lait, fruits_a_coque, celeri, moutarde, sesame, sulfites, lupin, mollusques. Agreges par v_recipe_allergens (mig 343).';

DROP FUNCTION IF EXISTS pg_temp.fn_allergen_code(text);
