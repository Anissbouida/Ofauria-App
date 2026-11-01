-- 407 : corrige une temperature parasite introduite par la structuration
-- automatique des etapes (mig 342).
--
-- Le libelle « Beurre de tourage (test 90°) » designe l'ANGLE du test de pliage
-- du beurre de tourage, pas une temperature de cuisson. La regex de la mig 342 a
-- lu « 90° » comme temperature_c = 90, ce qui affiche au chef une consigne absurde
-- (beurre a 90 °C). On retire la cle temperature_c des etapes de tourage concernees.
--
-- Borne a dessein (type = tourage, temperature exactement 90, libelle contenant 90)
-- pour ne jamais toucher une vraie temperature. Idempotent : un second passage ne
-- trouve plus d'etape correspondante et ne fait rien.
UPDATE recipes r
SET etapes = sub.fixed, updated_at = NOW()
FROM (
  SELECT r2.id,
         jsonb_agg(
           CASE
             WHEN e->>'type' = 'tourage'
              AND (e->>'temperature_c') IS NOT NULL
              AND (e->>'temperature_c')::numeric = 90
              AND lower(e->>'nom') LIKE '%90%'
             THEN e - 'temperature_c'
             ELSE e
           END
           ORDER BY COALESCE((e->>'ordre')::int, 0)
         ) AS fixed
  FROM recipes r2, jsonb_array_elements(r2.etapes) e
  WHERE jsonb_typeof(r2.etapes) = 'array'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(r2.etapes) x
      WHERE x->>'type' = 'tourage'
        AND (x->>'temperature_c') IS NOT NULL
        AND (x->>'temperature_c')::numeric = 90
        AND lower(x->>'nom') LIKE '%90%'
    )
  GROUP BY r2.id
) sub
WHERE r.id = sub.id;
