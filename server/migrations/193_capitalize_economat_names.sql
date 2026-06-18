-- ═══════════════════════════════════════════════════════════════
-- 193: Noms Économat toujours capitalisés (1re lettre en majuscule)
-- ═══════════════════════════════════════════════════════════════
-- Regle metier : les noms d'ingredients et d'emballages de l'Economat
-- doivent toujours commencer par une majuscule. La normalisation est
-- appliquee a la creation/modification/import cote applicatif
-- (utils/text.ts -> capitalizeFirst). Cette migration corrige une fois
-- pour toutes les libelles deja en base.
--
-- On trim les espaces de bord puis on force la 1re lettre en majuscule
-- (upper gere les accents en UTF-8), en laissant le reste inchange pour
-- ne pas casser sigles/marques (AOP, BIO...). On ne met a jour que les
-- lignes effectivement modifiees pour eviter de toucher tout le monde.

UPDATE ingredients
SET name = upper(left(btrim(name), 1)) || substring(btrim(name) from 2)
WHERE name IS NOT NULL
  AND btrim(name) <> ''
  AND name <> upper(left(btrim(name), 1)) || substring(btrim(name) from 2);

UPDATE packaging_items
SET name = upper(left(btrim(name), 1)) || substring(btrim(name) from 2)
WHERE name IS NOT NULL
  AND btrim(name) <> ''
  AND name <> upper(left(btrim(name), 1)) || substring(btrim(name) from 2);
