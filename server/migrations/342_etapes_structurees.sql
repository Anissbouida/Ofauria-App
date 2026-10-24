-- Migration 342 : etapes de fabrication structurees + parametres de pate
--
-- POURQUOI (audit Production & Fiches techniques 2026-10-23, §2.1 — P1)
--   Une fiche technique de boulanger se lit par ses parametres : temperature et
--   duree de cuisson, temperature de pate, taux d'hydratation, pointage/appret
--   (duree, T°, humidite). Jusqu'ici tout cela vivait en TEXTE LIBRE dans le nom
--   de l'etape (« Apprêt — armoire fermentation 26°C / 75% HR », « Cuisson 240°C
--   — 18 min ») : ni requetable, ni controlable, ni affichable sur un ecran four.
--
-- CE QUE CETTE MIGRATION AJOUTE
--   1. recipes.temperature_pate_cible_c : T° de pate en fin de petrissage (24-26 °C
--      en boulangerie). Pilote la fermentation ; sans elle un petrissage n'est pas
--      reproductible.
--   2. recipes.hydratation_pct : taux d'hydratation (pourcentage boulanger, eau /
--      farine × 100). Le langage universel du fournil ; permet de rescaler sans erreur.
--   3. Etapes (JSONB recipes.etapes, production_contenants.etapes_defaut,
--      produit_profil_production.etapes_surcharges) : trois cles structurees
--        type           petrissage | pointage | faconnage | tourage | appret |
--                       cuisson | refroidissement | montage | finition | autre
--        temperature_c  four, etuve, cellule, ambiante selon le type
--        humidite_pct   hygrometrie (etuve / pousse controlee)
--      La duree existe deja (duree_estimee_min) : on ne la duplique pas.
--   4. production_item_etapes : memes trois colonnes, copiees a l'instanciation
--      (startItems) pour que l'ecran de fabrication guide l'ouvrier.
--
-- RETRO-REMPLISSAGE
--   Les libelles existants sont riches : on en extrait, UNIQUEMENT quand la cle
--   est absente, le type (mots-cles metier), la temperature (« 240°C », « 26 °C »)
--   et l'humidite (« 75% HR »). Le nom n'est jamais modifie. Une etape dont le
--   libelle ne dit rien recoit type = 'autre' : le chef la requalifiera.
--
-- PORTEE
--   ALTER TABLE idempotents ; UPDATE JSONB rejouables (n'ecrasent jamais une cle
--   deja presente). Aucune vue touchee.
--
-- INVERSION
--   ALTER TABLE recipes DROP COLUMN temperature_pate_cible_c, DROP COLUMN hydratation_pct;
--   ALTER TABLE production_item_etapes DROP COLUMN type_etape, DROP COLUMN temperature_c,
--     DROP COLUMN humidite_pct;
--   Les cles JSONB ajoutees sont inoffensives et peuvent rester.

-- ─── 1-2. Parametres de pate sur la recette ───────────────────────────────
ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS temperature_pate_cible_c NUMERIC(4,1)
    CHECK (temperature_pate_cible_c IS NULL OR temperature_pate_cible_c BETWEEN -10 AND 60),
  ADD COLUMN IF NOT EXISTS hydratation_pct NUMERIC(5,2)
    CHECK (hydratation_pct IS NULL OR hydratation_pct BETWEEN 0 AND 200);

COMMENT ON COLUMN recipes.temperature_pate_cible_c IS
  'Temperature de pate cible en fin de petrissage (°C). Boulangerie : 24-26. NULL = non renseignee.';
COMMENT ON COLUMN recipes.hydratation_pct IS
  'Taux d''hydratation en pourcentage boulanger (eau / farine × 100). Baguette ~65-70, ciabatta ~80. NULL = non renseigne.';
COMMENT ON COLUMN recipes.etapes IS
  'Etapes de fabrication. Cles structurees (mig 342) : type (petrissage|pointage|faconnage|tourage|appret|cuisson|refroidissement|montage|finition|autre), temperature_c, humidite_pct, duree_estimee_min. Plus : ordre, nom, est_bloquante, timer_auto, controle_qualite, checklist_items, est_repetable, nb_repetitions, responsable_role.';

-- ─── 4. Colonnes miroir sur les etapes instanciees en production ───────────
ALTER TABLE production_item_etapes
  ADD COLUMN IF NOT EXISTS type_etape VARCHAR(30)
    CHECK (type_etape IS NULL OR type_etape IN ('petrissage','pointage','faconnage','tourage','appret','cuisson','refroidissement','montage','finition','autre')),
  ADD COLUMN IF NOT EXISTS temperature_c NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS humidite_pct NUMERIC(5,2);

-- ─── 3. Retro-remplissage des JSONB a partir des libelles ──────────────────
-- Fonction utilitaire temporaire : enrichit un tableau d'etapes sans ecraser
-- les cles deja presentes. Supprimee en fin de migration.
CREATE OR REPLACE FUNCTION pg_temp.fn_etapes_structurer(p_etapes jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_agg(
    e
    || CASE WHEN e ? 'type' THEN '{}'::jsonb ELSE jsonb_build_object('type',
         CASE
           WHEN lower(e->>'nom') ~ 'p[ée]triss|frasage|autolyse|hydratation|m[ée]lange des (poudres|ingr)' THEN 'petrissage'
           WHEN lower(e->>'nom') ~ 'pointage|repos en masse|fermentation en masse|premi[èe]re pousse|1[èe]?re? pousse' THEN 'pointage'
           WHEN lower(e->>'nom') ~ 'tourage|laminage|tours? (simple|double)|d[ée]trempe|beurrage' THEN 'tourage'
           WHEN lower(e->>'nom') ~ 'appr[êe]t|pousse|[ée]tuve|fermentation finale|armoire' THEN 'appret'
           WHEN lower(e->>'nom') ~ 'cuisson|enfourn|cuire|au four' THEN 'cuisson'
           WHEN lower(e->>'nom') ~ 'refroid|ressuage|surg[ée]l|cong[ée]l|cellule|repos frigo|frigo' THEN 'refroidissement'
           WHEN lower(e->>'nom') ~ 'fa[çc]onn|division|d[ée]tente|boulage|pesage|p[âa]tons|d[ée]coupe|coupe|abaisse|d[ée]taill' THEN 'faconnage'
           WHEN lower(e->>'nom') ~ 'montage|dressage|garnissage|fourrage|assemblage|pochage|moulage' THEN 'montage'
           WHEN lower(e->>'nom') ~ 'finition|gla[çc]age|nappage|d[ée]cor|dorure|sucre glace|saupoudr|lustrage' THEN 'finition'
           ELSE 'autre'
         END) END
    || CASE WHEN e ? 'temperature_c' OR (e->>'nom') !~ '\d{2,3}\s*°' THEN '{}'::jsonb
            ELSE jsonb_build_object('temperature_c', (substring(e->>'nom' from '(\d{2,3})\s*°'))::numeric) END
    || CASE WHEN e ? 'humidite_pct' OR (e->>'nom') !~ '\d{1,3}\s*%\s*(HR|hr|Hr|d''humidit)' THEN '{}'::jsonb
            ELSE jsonb_build_object('humidite_pct', (substring(e->>'nom' from '(\d{1,3})\s*%\s*(?:HR|hr|Hr|d''humidit)'))::numeric) END
    ORDER BY COALESCE((e->>'ordre')::int, 0)
  ), '[]'::jsonb)
  FROM jsonb_array_elements(p_etapes) e
$$;

UPDATE recipes
   SET etapes = pg_temp.fn_etapes_structurer(etapes)
 WHERE jsonb_typeof(etapes) = 'array' AND jsonb_array_length(etapes) > 0;

UPDATE production_contenants
   SET etapes_defaut = pg_temp.fn_etapes_structurer(etapes_defaut)
 WHERE etapes_defaut IS NOT NULL AND jsonb_typeof(etapes_defaut) = 'array' AND jsonb_array_length(etapes_defaut) > 0;

UPDATE produit_profil_production
   SET etapes_surcharges = pg_temp.fn_etapes_structurer(etapes_surcharges)
 WHERE etapes_surcharges IS NOT NULL AND jsonb_typeof(etapes_surcharges) = 'array' AND jsonb_array_length(etapes_surcharges) > 0;

-- Etapes deja instanciees sur des plans en cours : on retro-remplit aussi, par
-- la meme regle, pour que l'ecran de fabrication soit coherent des l'application.
UPDATE production_item_etapes pie
   SET type_etape = s.e->>'type',
       temperature_c = NULLIF(s.e->>'temperature_c', '')::numeric,
       humidite_pct = NULLIF(s.e->>'humidite_pct', '')::numeric
  FROM (
    SELECT id, pg_temp.fn_etapes_structurer(jsonb_build_array(jsonb_build_object('nom', nom, 'ordre', ordre)))->0 AS e
      FROM production_item_etapes
     WHERE type_etape IS NULL
  ) s
 WHERE s.id = pie.id;

DROP FUNCTION IF EXISTS pg_temp.fn_etapes_structurer(jsonb);
