-- Migration 284 : Fiches techniques de la famille SALE (61 produits vendus)
--
-- POURQUOI
--   Le catalogue « SALE » d'Ofauria (61 references) n'avait aucune fiche
--   technique : ni pesee, ni rendement, ni cout de revient. Cette migration
--   monte la famille entiere sur le modele de l'Opera (mig 273/276) :
--   des PREPARATIONS DE BASE partagees, puis des PRODUITS FINIS composes qui
--   declinent chaque base en formats de vente.
--
--   Structure produite :
--     22 bases familiales (pates beldi, farces, appareils, sauces)
--     22 fiches produit fini (mode_cout = compose)
--     62 formats, dont 61 portent le product_id d'un produit vendu
--        (+ 1 format « grande quiche Ø28 » de reference traiteur, sans produit)
--
--   Le decoupage recette/format suit le contrat : un meme produit decline en
--   taille, en conditionnement ou en garniture = UNE recette + PLUSIEURS
--   formats. C'est pour cela qu'il n'y a que 22 fiches pour 61 references :
--     Msemen        -> 6 formats (khlii, olive, prestige, mini x2, bebe farci)
--     Harcha        -> 8 formats (nature x2, packs, fromage, olive, raisin, chocolat)
--     Baghrir       -> 4 formats (sachets de 5, 6, 8 et 10 pieces)
--     Quiche        -> 7 formats (5 garnitures + mini saumon + grande Ø28)
--     Pizza         -> 4 formats (thon, thon carre, poulet, viande hachee)
--   Chaque format porte SA propre nomenclature : c'est ce qui permet a une
--   seule pate de msemen de servir six references sans dupliquer la fiche.
--
-- ─── CONVENTION RENDEMENT (identique mig 273/276) ───
--   recipes.yield_quantity      = pesee CRUE de la fournee
--   recipes.perte_standard_pct  = perte de transformation (cuisson, reduction)
--   recipe_format_components.quantite = poids NET mis en oeuvre pour TOUT le
--   contenant. Les quantites ci-dessous sont ecrites PAR PIECE puis
--   multipliees par nb_par_defaut a l'insertion (etape 6) : le controle
--   « somme des composants = nb_par_defaut x quantite_par_format » est alors
--   exact par construction, et quantite_par_format est recalcule a l'etape 7.
--
-- ─── PRIX MATIERE : DEUX ANOMALIES DU REFERENTIEL, ASSUMEES ───
--   1. « Viande hachee » est a 30 DH/kg et « Blanc de poulet » a 15 DH/kg,
--      soit le tiers du prix marche 2026. On ne les corrige PAS ici (ce serait
--      repricer tout le referentiel sans mandat), mais on utilise « Filet de
--      poulet » (45 DH/kg, coherent) partout ou le poulet est la matiere
--      dominante. Les fiches a la viande hachee (briouat, pizza viande, mini
--      hamburger) sont donc sous-evaluees tant que ce prix n'est pas corrige.
--   2. « Raisins secs golden » est a 300 DH/kg (prix d'un fruit sec de luxe,
--      pas d'un raisin de boulangerie) et « Saumon fume » a 0,00 DH. Un
--      ingredient a 0 DH rendrait le cout de la fiche silencieusement faux :
--      on cree donc deux references propres plutot que d'utiliser celles-la.
--
-- ─── COUT MATIERE : 58 REFERENCES SUR 61 ENTRE 20 ET 40 % DU PRIX ───
--   Les trois exceptions sont les batbouts NATURE : mini (10 %), bebe a la
--   piece et sachet de 10 (13 %). Ce n'est pas une erreur de pesee : un
--   batbout, c'est de la semoule, de la farine et de l'eau, soit 5,13 DH le
--   kilo de pate. Un mini de 60 g revient a 0,31 DH et se vend 3 DH. Pour
--   entrer dans le couloir il faudrait une piece de 117 g, qui ne serait plus
--   un mini. Le batbout nature est simplement le produit le plus rentable de
--   la carte ; la version farcie (fromage + viande), elle, ressort a 32 %.
--
-- ─── PIEGE POIDS/VOLUME (cf. mig 273 et 288) ───
--   Les liquides stockes en litres et peses en grammes passent par
--   fn_unit_conv(g -> l, densite). Sans densite le facteur retombe a 1 et
--   20 g de mayonnaise couteraient 20 L. Les densites manquantes utiles a
--   cette famille sont posees a l'etape 2 (garde-fou : IS NULL).
--
-- PORTEE
--   + 9 ingredients crees (prix marche marocain 2026, A VALIDER)
--   + 2 densites posees si absentes
--   + 22 recettes de base + leurs recipe_ingredients
--   + 22 recettes composees + 62 recipe_formats + leurs nomenclatures
--   + miroir recipe_components des 22 formats par defaut
--   + etapes de production sur 4 fiches phares (msemen, pastilla, quiche, pizza)
--   Idempotent : ON CONFLICT DO NOTHING sur les UUID fixes,
--   DELETE+INSERT sur toutes les compositions.
--
-- INVERSION
--   DELETE FROM recipes WHERE id::text LIKE 'fab28400-0000-4000-8000-%';
--     (cascade : recipe_ingredients, recipe_formats, recipe_format_components,
--      recipe_components)
--   DELETE FROM ingredients WHERE name IN ('Khlii','Gruyère râpé',
--     'Pain de mie tranché','Miel liquide','Confiture de framboise',
--     'Champignons de Paris','Épinards frais','Saumon fumé en tranches',
--     'Raisins secs blonds');

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Ingredients manquants au referentiel.
--    Prix marche Casablanca 2026, en DH/kg. -- PRIX A VALIDER sur chaque ligne.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO ingredients (name, unit, unit_cost, category)
SELECT v.nom, 'kg', v.prix, v.cat
FROM (VALUES
  -- Viande sechee du pays : c'est elle qui fait le msemen au khlii.
  ('Khlii',                    180.00::numeric, 'viandes'),                 -- PRIX A VALIDER
  -- Fromage rape de cuisson (gouda/gruyere labo). « Fromage Edam » du
  -- referentiel est a 170 DH/kg : trop cher pour une harcha a 4 DH.
  ('Gruyère râpé',              95.00,          'fromages'),                -- PRIX A VALIDER
  -- Achete tranche : le croque-monsieur n'est pas panifie au labo.
  ('Pain de mie tranché',       14.00,          'preparations'),            -- PRIX A VALIDER
  -- « Miel » existe en unit (5 DH) : inutilisable pese en grammes.
  ('Miel liquide',              75.00,          'sucres'),                  -- PRIX A VALIDER
  ('Confiture de framboise',    45.00,          'conserves'),               -- PRIX A VALIDER
  ('Champignons de Paris',      28.00,          'legumes'),                 -- PRIX A VALIDER
  ('Épinards frais',            12.00,          'legumes'),                 -- PRIX A VALIDER
  -- « Saumon fume » existe a 0,00 DH : un cout nul fausse toute la fiche.
  ('Saumon fumé en tranches',  190.00,          'poissons_fruits_de_mer'),  -- PRIX A VALIDER
  -- « Raisins secs golden » est a 300 DH/kg (fruit sec de luxe).
  ('Raisins secs blonds',       38.00,          'fruits_secs')              -- PRIX A VALIDER
) AS v (nom, prix, cat)
WHERE NOT EXISTS (SELECT 1 FROM ingredients i WHERE lower(i.name) = lower(v.nom));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Densites des liquides peses en grammes (piege fn_unit_conv).
--    Sans elles, 20 g de mayonnaise = 20 L = 220 DH sur un sandwich a 12,50 DH.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE ingredients SET densite_kg_l = 0.950
 WHERE name = 'Mayonnaise bidon' AND densite_kg_l IS NULL;
UPDATE ingredients SET densite_kg_l = 1.100
 WHERE name = 'Sauce soja supérieure light' AND densite_kg_l IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Resolution des ingredients.
--    Le referentiel contient des doublons de nom (« Beurre » x3, « Sucre
--    semoule » x2, « Olives noires » x2 dont une a 0 DH). On retient :
--      1) l'unite attendue (evite « Konafa » unit vs kg),
--      2) le plus utilise par les recettes existantes,
--      3) a egalite, le prix NON NUL le plus eleve (« Olives noires » a 0 DH
--         donnerait un cout silencieusement faux).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _sale_ing ON COMMIT DROP AS
SELECT DISTINCT ON (i.name) i.name, i.id
FROM ingredients i
JOIN (VALUES
  ('Farine Fleur','kg'), ('Farine boulangerie','kg'), ('Farine Complète','kg'),
  ('Farine d''orge','kg'), ('Semoule fine','kg'), ('Eau','l'),
  ('Sel de table fin','kg'), ('Sucre semoule','kg'), ('Sucre glace','kg'),
  ('Beurre','kg'), ('Huile de table','l'), ('Huile d''olive','l'),
  ('Levure fraîche','kg'), ('Levure chimique','kg'), ('Oeufs entiers liquides','kg'),
  ('Lait','l'), ('Crème fraîche','kg'), ('Filet de poulet','kg'),
  ('Viande hachée','kg'), ('Thon Tam','kg'), ('Calamar','kg'), ('Crevettes','kg'),
  ('Mozzarella','kg'), ('Olives noires','kg'), ('Feuilles de pastilla','kg'),
  ('Oignon','kg'), ('Tomate','kg'), ('Carotte','kg'), ('Poireau','kg'),
  ('Poivrons','kg'), ('Ail','g'), ('Cannelle moulue','kg'), ('Gingembre moulu','kg'),
  ('Curcuma moulu','kg'), ('Poivre noir moulu','kg'), ('Cumin moulu','kg'),
  ('Paprika fumée','kg'), ('Piment doux','kg'), ('Grains de sésame','kg'),
  ('Amande concassée','kg'), ('Pistache décortiquée','kg'), ('Konafa','kg'),
  ('Filet de dinde fume','kg'), ('Vermicelle de riz','kg'), ('Champignons noirs','kg'),
  ('Sauce soja supérieure light','l'), ('Mayonnaise bidon','l'), ('Ketchup','kg'),
  ('Gouttes Drops 44%','kg'),
  -- les 9 crees a l'etape 1
  ('Khlii','kg'), ('Gruyère râpé','kg'), ('Pain de mie tranché','kg'),
  ('Miel liquide','kg'), ('Confiture de framboise','kg'), ('Champignons de Paris','kg'),
  ('Épinards frais','kg'), ('Saumon fumé en tranches','kg'), ('Raisins secs blonds','kg')
) AS v (nm, un) ON v.nm = i.name AND v.un = i.unit
ORDER BY i.name,
         (SELECT count(*) FROM recipe_ingredients ri WHERE ri.ingredient_id = i.id) DESC,
         COALESCE(i.unit_cost, 0) DESC,
         i.created_at;

-- Garde-fou : plutot echouer ici que d'inserer une fiche amputee dont le cout
-- serait silencieusement faux (mig 273).
DO $$
DECLARE n INT; manquants TEXT;
BEGIN
  SELECT count(*) INTO n FROM _sale_ing;
  IF n <> 58 THEN
    SELECT string_agg(x.nm, ', ') INTO manquants
    FROM (VALUES
      ('Farine Fleur'),('Farine boulangerie'),('Farine Complète'),('Farine d''orge'),
      ('Semoule fine'),('Eau'),('Sel de table fin'),('Sucre semoule'),('Sucre glace'),
      ('Beurre'),('Huile de table'),('Huile d''olive'),('Levure fraîche'),
      ('Levure chimique'),('Oeufs entiers liquides'),('Lait'),('Crème fraîche'),
      ('Filet de poulet'),('Viande hachée'),('Thon Tam'),('Calamar'),('Crevettes'),
      ('Mozzarella'),('Olives noires'),('Feuilles de pastilla'),('Oignon'),('Tomate'),
      ('Carotte'),('Poireau'),('Poivrons'),('Ail'),('Cannelle moulue'),
      ('Gingembre moulu'),('Curcuma moulu'),('Poivre noir moulu'),('Cumin moulu'),
      ('Paprika fumée'),('Piment doux'),('Grains de sésame'),('Amande concassée'),
      ('Pistache décortiquée'),('Konafa'),('Filet de dinde fume'),('Vermicelle de riz'),
      ('Champignons noirs'),('Sauce soja supérieure light'),('Mayonnaise bidon'),
      ('Ketchup'),('Gouttes Drops 44%'),('Khlii'),('Gruyère râpé'),
      ('Pain de mie tranché'),('Miel liquide'),('Confiture de framboise'),
      ('Champignons de Paris'),('Épinards frais'),('Saumon fumé en tranches'),
      ('Raisins secs blonds')
    ) AS x(nm)
    WHERE NOT EXISTS (SELECT 1 FROM _sale_ing s WHERE s.name = x.nm);
    RAISE EXCEPTION 'Ingredients introuvables : % trouve(s) sur 58. Manquants : %', n, manquants;
  END IF;
END $$;

-- Bases transversales de la mig 280, reutilisees telles quelles (jamais recreees).
CREATE TEMP TABLE _sale_base ON COMMIT DROP AS
SELECT DISTINCT ON (r.name) r.name, r.id
FROM recipes r
WHERE r.archived_at IS NULL
  AND r.name IN ('Pâte levée feuilletée', 'Pâte sucrée', 'Crème pâtissière',
                 'Sirop à 30°B', 'Dorure')
ORDER BY r.name, r.created_at DESC;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM _sale_base;
  IF n <> 5 THEN
    RAISE EXCEPTION 'Bases transversales introuvables : % sur 5 (mig 280 appliquee ?)', n;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Les 22 preparations de base de la famille salee.
--
--    ─── DEUX BASES SONT DEJA CREEES AILLEURS ───
--    « Pâte à pain sandwich » appartient a la mig 281 (boulangerie) et
--    « Pâte à batbout » a la mig 283 (beldi). Les recreer donnerait deux fiches
--    actives du meme nom : la resolution par nom deviendrait ambigue et le
--    controle « 0 doublon de base active » tomberait. On les cree donc
--    SEULEMENT si le nom est libre (WHERE NOT EXISTS), et toute la suite de
--    cette migration resout ses preparations PAR NOM (_sale_rec) et non par
--    UUID : selon l'ordre d'application des migrations, la fiche utilisee est
--    la mienne ou celle de la famille voisine, sans que la nomenclature change.
--
--    Pertes retenues :
--      pates beldi detaillees a la main   2-5 %  (parures, farine de fleurage)
--      appareil baghrir                   8 %    (evaporation a la plancha)
--      farces de viande / poulet         25-28 % (rendu d'eau et de gras)
--      farce fruits de mer               18 %    (vermicelle deja hydrate)
--      sauce tomate                      30 %    (reduction)
--      pain sandwich                     18 %    (cuisson + ressuage)
--      appareil a quiche                  0 %    (verse cru, cuit dans le fond)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipes (id, name, is_base, mode_cout, yield_quantity, yield_unit,
                     perte_standard_pct, category_id, instructions)
SELECT v.id, v.nom, true, 'ratio_poids', v.yield, 'g', v.perte,
       (SELECT id FROM recipe_categories WHERE code = v.cat), v.notes
FROM (VALUES
  ('fab28400-0000-4000-8000-000000000101'::uuid, 'Pâte à msemen',                2000::numeric,  3::numeric, 'sale_beldi',
   'Petrissage 15 min jusqu''au voile. Repos boules huilees 30 min minimum : sans repos la pate ne s''etire pas en feuille transparente. DLC pate crue 24 h a +4 °C.'),
  ('fab28400-0000-4000-8000-000000000102', 'Beurre de tourage msemen',            800,  0, 'sale_beldi',
   'Melange beurre/huile/semoule du feuilletage. La semoule est ce qui separe les feuilles a la cuisson. Tenir a 20 °C : trop froid il dechire la pate.'),
  ('fab28400-0000-4000-8000-000000000103', 'Pâte à harcha',                      1702,  2, 'sale_beldi',
   'Sabler la semoule au beurre 10 min puis mouiller. Repos 15 min pour que la semoule boive. Ne jamais petrir apres mouillage : la harcha doit rester sableuse.'),
  ('fab28400-0000-4000-8000-000000000104', 'Pâte à harcha à l''orge',            1702,  2, 'sale_beldi',
   'Variante orge (40 % de la farine). Boit plus que la semoule seule : ajuster le lait de 10 a 20 g selon la mouture.'),
  ('fab28400-0000-4000-8000-000000000105', 'Pâte à harcha complète',             1732,  2, 'sale_beldi',
   'Variante complete au son et au sesame. Repos 20 min : le son a besoin de plus de temps pour s''hydrater.'),
  ('fab28400-0000-4000-8000-000000000106', 'Pâte à batbout',                     1789,  5, 'sale_beldi',
   'Pate lisse et souple, pointage 1 h a 28 °C, apprets 30 min sur toile farinee. Cuisson plancha seche, 2 min par face : le batbout doit gonfler en ballon.'),
  ('fab28400-0000-4000-8000-000000000107', 'Appareil à baghrir',                 2263,  8, 'sale_beldi',
   'Mixer 3 min pour developper le reseau, repos 45 min a 28 °C. Appareil tres liquide (nappe la louche a peine). Cuisson UNE seule face : les mille trous doivent s''ouvrir et secher.'),
  ('fab28400-0000-4000-8000-000000000108', 'Farce poulet pastilla',              2568, 25, 'base_production',
   'Oignons fondus 40 min a couvert, poulet effiloche a la main (jamais au robot), oeufs brouilles hors du feu en fin de cuisson. Farce refroidie a +4 °C AVANT montage, sinon la feuille se detrempe.'),
  ('fab28400-0000-4000-8000-000000000109', 'Farce fruits de mer',                1638, 18, 'base_production',
   'Calamars et crevettes saisis vivement puis egouttes : toute eau residuelle perce la feuille. Vermicelle trempe 8 min a l''eau tiede, egoutte, coupe aux ciseaux.'),
  ('fab28400-0000-4000-8000-000000000110', 'Farce viande hachée épicée',         1728, 25, 'base_production',
   'Viande saisie a feu vif puis mijotee 20 min avec oignon et tomate jusqu''a evaporation complete. Refroidissement rapide obligatoire (cellule) : farce a risque.'),
  ('fab28400-0000-4000-8000-000000000111', 'Farce poulet marinée',               1365, 28, 'base_production',
   'Marinade 2 h minimum au frais. Cuisson a la plancha en deux fois : une poele surchargee bout au lieu de saisir. Refroidir a coeur avant garnissage.'),
  ('fab28400-0000-4000-8000-000000000112', 'Appareil à quiche',                  1010,  0, 'base_production',
   'Migaine classique 1 oeuf pour 150 g de liquide. Ne pas fouetter : melanger sans incorporer d''air, sinon l''appareil souffle puis retombe. A utiliser dans les 12 h.'),
  ('fab28400-0000-4000-8000-000000000113', 'Pâte brisée salée',                  1718,  5, 'base_production',
   'Sablage beurre froid, fraisage une seule fois, repos 2 h au froid. Abaisse a 2,5 mm. Cuisson a blanc obligatoire pour les quiches (voir fiche Quiche).'),
  ('fab28400-0000-4000-8000-000000000114', 'Pâte à pizza',                       1705,  4, 'base_production',
   'Hydratation 62 %. Pointage 24 h a +4 °C : c''est la maturation au froid qui donne l''alveolage et la digestibilite. Bouler 2 h avant faconnage.'),
  ('fab28400-0000-4000-8000-000000000115', 'Sauce tomate pizza',                 1298, 30, 'base_production',
   'Reduction lente 45 min a decouvert jusqu''a la nappe. Une sauce trop liquide detrempe la pate et fait decoller le fromage.'),
  ('fab28400-0000-4000-8000-000000000116', 'Garniture pizza thon',               1100,  5, 'base_production',
   'Thon egoutte presse, oignon emince fin, olives et poivrons tailles regulierement. Se garde 48 h a +4 °C en bac ferme.'),
  ('fab28400-0000-4000-8000-000000000117', 'Garniture pizza poulet',             1375, 25, 'base_production',
   'Poulet saisi et taille en des de 1 cm, poivrons et oignons sues separement pour garder leur tenue.'),
  ('fab28400-0000-4000-8000-000000000118', 'Béchamel',                           1190,  8, 'base_production',
   'Roux blanc cuit 2 min, lait chaud verse en trois fois. Cuisson 8 min a fremissement : une bechamel non cuite garde le gout de farine.'),
  ('fab28400-0000-4000-8000-000000000119', 'Pâte à pain sandwich',               1728, 18, 'boulangerie',
   'Petrissage ameliore 8 min, pointage 45 min, apprets 1 h. Cuisson 220 °C avec vapeur 8 min puis 180 °C. Perte 18 % cuisson + ressuage.'),
  ('fab28400-0000-4000-8000-000000000120', 'Farce nems poulet',                  1420, 12, 'base_production',
   'Champignons noirs rehydrates 20 min et essores, vermicelle trempe puis coupe. Farce FROIDE au roulage : chaude, elle ramollit la feuille.'),
  ('fab28400-0000-4000-8000-000000000121', 'Farce nems légumes',                 1420, 12, 'base_production',
   'Legumes tailles en julienne fine et sautes vivement pour garder du croquant. Egoutter 20 min sur grille avant roulage.'),
  ('fab28400-0000-4000-8000-000000000122', 'Appareil à basbousa',                1712, 10, 'gateaux_marocains',
   'Semoule et yaourt melanges puis repos 30 min. Couler sur 2 cm, precouper AVANT cuisson. Sirop froid sur gateau chaud (jamais l''inverse).')
) AS v (id, nom, yield, perte, cat, notes)
WHERE NOT EXISTS (SELECT 1 FROM recipes r
                   WHERE r.name = v.nom AND r.archived_at IS NULL)
ON CONFLICT (id) DO NOTHING;

-- Compositions des bases : DELETE puis INSERT pour que la migration soit rejouable.
-- Le JOIN sur recipes filtre les bases qui n'ont PAS ete creees ici (nom deja
-- pris par 281/283) : leur composition appartient a leur migration d'origine.
DELETE FROM recipe_ingredients
 WHERE recipe_id::text LIKE 'fab28400-0000-4000-8000-0000000001%';

INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit)
SELECT v.recette_id, ing.id, v.qte, 'g'
FROM (VALUES
  -- ── Pâte à msemen — pesee 2000 g, 3 % de parures au detaillage
  ('fab28400-0000-4000-8000-000000000101'::uuid, 'Farine Fleur',            700::numeric),
  ('fab28400-0000-4000-8000-000000000101', 'Semoule fine',                  300),
  ('fab28400-0000-4000-8000-000000000101', 'Eau',                           950),
  ('fab28400-0000-4000-8000-000000000101', 'Sel de table fin',               20),
  ('fab28400-0000-4000-8000-000000000101', 'Levure fraîche',                 10),
  ('fab28400-0000-4000-8000-000000000101', 'Sucre semoule',                  20),
  -- ── Beurre de tourage msemen — 800 g, aucune transformation
  ('fab28400-0000-4000-8000-000000000102', 'Beurre',                        300),
  ('fab28400-0000-4000-8000-000000000102', 'Huile de table',                300),
  ('fab28400-0000-4000-8000-000000000102', 'Semoule fine',                  200),
  -- ── Pâte à harcha — 1702 g. 200 g de beurre par kilo de semoule : ratio
  --    bas de la fourchette beldi (200-300 g), cale sur le prix de vente.
  ('fab28400-0000-4000-8000-000000000103', 'Semoule fine',                 1000),
  ('fab28400-0000-4000-8000-000000000103', 'Beurre',                        200),
  ('fab28400-0000-4000-8000-000000000103', 'Sucre semoule',                  80),
  ('fab28400-0000-4000-8000-000000000103', 'Sel de table fin',               10),
  ('fab28400-0000-4000-8000-000000000103', 'Levure chimique',                12),
  ('fab28400-0000-4000-8000-000000000103', 'Lait',                          250),
  ('fab28400-0000-4000-8000-000000000103', 'Eau',                           150),
  -- ── Pâte à harcha à l'orge — 1702 g
  ('fab28400-0000-4000-8000-000000000104', 'Semoule fine',                  600),
  ('fab28400-0000-4000-8000-000000000104', 'Farine d''orge',                400),
  ('fab28400-0000-4000-8000-000000000104', 'Beurre',                        200),
  ('fab28400-0000-4000-8000-000000000104', 'Sucre semoule',                  80),
  ('fab28400-0000-4000-8000-000000000104', 'Sel de table fin',               10),
  ('fab28400-0000-4000-8000-000000000104', 'Levure chimique',                12),
  ('fab28400-0000-4000-8000-000000000104', 'Lait',                          250),
  ('fab28400-0000-4000-8000-000000000104', 'Eau',                           150),
  -- ── Pâte à harcha complète — 1732 g
  ('fab28400-0000-4000-8000-000000000105', 'Semoule fine',                  600),
  ('fab28400-0000-4000-8000-000000000105', 'Farine Complète',               400),
  ('fab28400-0000-4000-8000-000000000105', 'Beurre',                        200),
  ('fab28400-0000-4000-8000-000000000105', 'Sucre semoule',                  80),
  ('fab28400-0000-4000-8000-000000000105', 'Sel de table fin',               10),
  ('fab28400-0000-4000-8000-000000000105', 'Levure chimique',                12),
  ('fab28400-0000-4000-8000-000000000105', 'Lait',                          250),
  ('fab28400-0000-4000-8000-000000000105', 'Eau',                           150),
  ('fab28400-0000-4000-8000-000000000105', 'Grains de sésame',               30),
  -- ── Pâte à batbout — 1789 g. Lait et huile : batbout de qualite, moelleux
  --    a froid ; la version eau seule durcit en 2 h.
  ('fab28400-0000-4000-8000-000000000106', 'Semoule fine',                  500),
  ('fab28400-0000-4000-8000-000000000106', 'Farine boulangerie',            500),
  ('fab28400-0000-4000-8000-000000000106', 'Lait',                          300),
  ('fab28400-0000-4000-8000-000000000106', 'Eau',                           380),
  ('fab28400-0000-4000-8000-000000000106', 'Huile de table',                 60),
  ('fab28400-0000-4000-8000-000000000106', 'Levure fraîche',                 15),
  ('fab28400-0000-4000-8000-000000000106', 'Sel de table fin',               14),
  ('fab28400-0000-4000-8000-000000000106', 'Sucre semoule',                  20),
  -- ── Appareil à baghrir — 2263 g, 8 % d'evaporation
  ('fab28400-0000-4000-8000-000000000107', 'Semoule fine',                  500),
  ('fab28400-0000-4000-8000-000000000107', 'Farine Fleur',                  200),
  ('fab28400-0000-4000-8000-000000000107', 'Oeufs entiers liquides',        100),
  ('fab28400-0000-4000-8000-000000000107', 'Lait',                          300),
  ('fab28400-0000-4000-8000-000000000107', 'Eau',                          1100),
  ('fab28400-0000-4000-8000-000000000107', 'Levure fraîche',                 15),
  ('fab28400-0000-4000-8000-000000000107', 'Levure chimique',                 8),
  ('fab28400-0000-4000-8000-000000000107', 'Sel de table fin',                8),
  ('fab28400-0000-4000-8000-000000000107', 'Sucre semoule',                  32),
  -- ── Farce poulet pastilla — 2568 g, 25 % de perte (eau des oignons)
  ('fab28400-0000-4000-8000-000000000108', 'Filet de poulet',              1000),
  ('fab28400-0000-4000-8000-000000000108', 'Oignon',                        900),
  ('fab28400-0000-4000-8000-000000000108', 'Huile de table',                120),
  ('fab28400-0000-4000-8000-000000000108', 'Oeufs entiers liquides',        300),
  ('fab28400-0000-4000-8000-000000000108', 'Amande concassée',              150),
  ('fab28400-0000-4000-8000-000000000108', 'Sucre semoule',                  60),
  ('fab28400-0000-4000-8000-000000000108', 'Cannelle moulue',                 8),
  ('fab28400-0000-4000-8000-000000000108', 'Gingembre moulu',                 6),
  ('fab28400-0000-4000-8000-000000000108', 'Curcuma moulu',                   6),
  ('fab28400-0000-4000-8000-000000000108', 'Poivre noir moulu',               3),
  ('fab28400-0000-4000-8000-000000000108', 'Sel de table fin',               15),
  -- ── Farce fruits de mer — 1638 g, 18 %
  ('fab28400-0000-4000-8000-000000000109', 'Calamar',                       250),
  ('fab28400-0000-4000-8000-000000000109', 'Crevettes',                     150),
  ('fab28400-0000-4000-8000-000000000109', 'Vermicelle de riz',             400),
  ('fab28400-0000-4000-8000-000000000109', 'Oignon',                        500),
  ('fab28400-0000-4000-8000-000000000109', 'Crème fraîche',                 200),
  ('fab28400-0000-4000-8000-000000000109', 'Huile de table',                100),
  ('fab28400-0000-4000-8000-000000000109', 'Ail',                            12),
  ('fab28400-0000-4000-8000-000000000109', 'Poivre noir moulu',               3),
  ('fab28400-0000-4000-8000-000000000109', 'Sel de table fin',               14),
  ('fab28400-0000-4000-8000-000000000109', 'Piment doux',                     5),
  ('fab28400-0000-4000-8000-000000000109', 'Curcuma moulu',                   4),
  -- ── Farce viande hachée épicée — 1728 g, 25 %
  ('fab28400-0000-4000-8000-000000000110', 'Viande hachée',                1000),
  ('fab28400-0000-4000-8000-000000000110', 'Oignon',                        400),
  ('fab28400-0000-4000-8000-000000000110', 'Tomate',                        200),
  ('fab28400-0000-4000-8000-000000000110', 'Huile de table',                 80),
  ('fab28400-0000-4000-8000-000000000110', 'Ail',                            12),
  ('fab28400-0000-4000-8000-000000000110', 'Cumin moulu',                     8),
  ('fab28400-0000-4000-8000-000000000110', 'Paprika fumée',                   6),
  ('fab28400-0000-4000-8000-000000000110', 'Poivre noir moulu',               3),
  ('fab28400-0000-4000-8000-000000000110', 'Sel de table fin',               14),
  ('fab28400-0000-4000-8000-000000000110', 'Piment doux',                     5),
  -- ── Farce poulet marinée — 1365 g, 28 %
  ('fab28400-0000-4000-8000-000000000111', 'Filet de poulet',              1000),
  ('fab28400-0000-4000-8000-000000000111', 'Oignon',                        250),
  ('fab28400-0000-4000-8000-000000000111', 'Huile de table',                 80),
  ('fab28400-0000-4000-8000-000000000111', 'Ail',                            10),
  ('fab28400-0000-4000-8000-000000000111', 'Poivre noir moulu',               3),
  ('fab28400-0000-4000-8000-000000000111', 'Curcuma moulu',                   5),
  ('fab28400-0000-4000-8000-000000000111', 'Paprika fumée',                   5),
  ('fab28400-0000-4000-8000-000000000111', 'Sel de table fin',               12),
  -- ── Appareil à quiche — 1010 g, verse cru
  ('fab28400-0000-4000-8000-000000000112', 'Oeufs entiers liquides',        400),
  ('fab28400-0000-4000-8000-000000000112', 'Crème fraîche',                 300),
  ('fab28400-0000-4000-8000-000000000112', 'Lait',                          300),
  ('fab28400-0000-4000-8000-000000000112', 'Sel de table fin',                8),
  ('fab28400-0000-4000-8000-000000000112', 'Poivre noir moulu',               2),
  -- ── Pâte brisée salée — 1718 g, 5 % (chutes d'abaisse)
  ('fab28400-0000-4000-8000-000000000113', 'Farine Fleur',                 1000),
  ('fab28400-0000-4000-8000-000000000113', 'Beurre',                        400),
  ('fab28400-0000-4000-8000-000000000113', 'Eau',                           200),
  ('fab28400-0000-4000-8000-000000000113', 'Oeufs entiers liquides',        100),
  ('fab28400-0000-4000-8000-000000000113', 'Sel de table fin',               18),
  -- ── Pâte à pizza — 1705 g, 4 %
  ('fab28400-0000-4000-8000-000000000114', 'Farine boulangerie',           1000),
  ('fab28400-0000-4000-8000-000000000114', 'Eau',                           620),
  ('fab28400-0000-4000-8000-000000000114', 'Huile d''olive',                 40),
  ('fab28400-0000-4000-8000-000000000114', 'Levure fraîche',                 15),
  ('fab28400-0000-4000-8000-000000000114', 'Sel de table fin',               20),
  ('fab28400-0000-4000-8000-000000000114', 'Sucre semoule',                  10),
  -- ── Sauce tomate pizza — 1298 g, 30 % de reduction
  ('fab28400-0000-4000-8000-000000000115', 'Tomate',                       1000),
  ('fab28400-0000-4000-8000-000000000115', 'Oignon',                        200),
  ('fab28400-0000-4000-8000-000000000115', 'Huile d''olive',                 60),
  ('fab28400-0000-4000-8000-000000000115', 'Ail',                            12),
  ('fab28400-0000-4000-8000-000000000115', 'Sel de table fin',               12),
  ('fab28400-0000-4000-8000-000000000115', 'Sucre semoule',                  10),
  ('fab28400-0000-4000-8000-000000000115', 'Piment doux',                     4),
  -- ── Garniture pizza thon — 1100 g
  ('fab28400-0000-4000-8000-000000000116', 'Thon Tam',                      400),
  ('fab28400-0000-4000-8000-000000000116', 'Oignon',                        300),
  ('fab28400-0000-4000-8000-000000000116', 'Olives noires',                 150),
  ('fab28400-0000-4000-8000-000000000116', 'Poivrons',                      250),
  -- ── Garniture pizza poulet — 1375 g
  ('fab28400-0000-4000-8000-000000000117', 'Filet de poulet',               800),
  ('fab28400-0000-4000-8000-000000000117', 'Oignon',                        300),
  ('fab28400-0000-4000-8000-000000000117', 'Poivrons',                      200),
  ('fab28400-0000-4000-8000-000000000117', 'Huile de table',                 60),
  ('fab28400-0000-4000-8000-000000000117', 'Paprika fumée',                   5),
  ('fab28400-0000-4000-8000-000000000117', 'Poivre noir moulu',               3),
  ('fab28400-0000-4000-8000-000000000117', 'Curcuma moulu',                   3),
  ('fab28400-0000-4000-8000-000000000117', 'Sel de table fin',                4),
  -- ── Béchamel — 1190 g, 8 % d'evaporation
  ('fab28400-0000-4000-8000-000000000118', 'Lait',                         1000),
  ('fab28400-0000-4000-8000-000000000118', 'Beurre',                         90),
  ('fab28400-0000-4000-8000-000000000118', 'Farine Fleur',                   90),
  ('fab28400-0000-4000-8000-000000000118', 'Sel de table fin',                8),
  ('fab28400-0000-4000-8000-000000000118', 'Poivre noir moulu',               2),
  -- ── Pâte à pain sandwich — 1728 g, 18 % cuisson + ressuage
  ('fab28400-0000-4000-8000-000000000119', 'Farine boulangerie',           1000),
  ('fab28400-0000-4000-8000-000000000119', 'Eau',                           600),
  ('fab28400-0000-4000-8000-000000000119', 'Huile de table',                 50),
  ('fab28400-0000-4000-8000-000000000119', 'Levure fraîche',                 20),
  ('fab28400-0000-4000-8000-000000000119', 'Sel de table fin',               18),
  ('fab28400-0000-4000-8000-000000000119', 'Sucre semoule',                  40),
  -- ── Farce nems poulet — 1420 g, 12 %
  ('fab28400-0000-4000-8000-000000000120', 'Filet de poulet',               500),
  ('fab28400-0000-4000-8000-000000000120', 'Vermicelle de riz',             250),
  ('fab28400-0000-4000-8000-000000000120', 'Carotte',                       300),
  ('fab28400-0000-4000-8000-000000000120', 'Oignon',                        200),
  ('fab28400-0000-4000-8000-000000000120', 'Champignons noirs',              60),
  ('fab28400-0000-4000-8000-000000000120', 'Sauce soja supérieure light',    40),
  ('fab28400-0000-4000-8000-000000000120', 'Huile de table',                 50),
  ('fab28400-0000-4000-8000-000000000120', 'Ail',                            10),
  ('fab28400-0000-4000-8000-000000000120', 'Poivre noir moulu',               2),
  ('fab28400-0000-4000-8000-000000000120', 'Sel de table fin',                8),
  -- ── Farce nems légumes — 1420 g, 12 %
  ('fab28400-0000-4000-8000-000000000121', 'Carotte',                       500),
  ('fab28400-0000-4000-8000-000000000121', 'Vermicelle de riz',             300),
  ('fab28400-0000-4000-8000-000000000121', 'Oignon',                        250),
  ('fab28400-0000-4000-8000-000000000121', 'Poireau',                       200),
  ('fab28400-0000-4000-8000-000000000121', 'Champignons noirs',              60),
  ('fab28400-0000-4000-8000-000000000121', 'Sauce soja supérieure light',    40),
  ('fab28400-0000-4000-8000-000000000121', 'Huile de table',                 50),
  ('fab28400-0000-4000-8000-000000000121', 'Ail',                            10),
  ('fab28400-0000-4000-8000-000000000121', 'Poivre noir moulu',               2),
  ('fab28400-0000-4000-8000-000000000121', 'Sel de table fin',                8),
  -- ── Appareil à basbousa — 1712 g, 10 % cuisson
  ('fab28400-0000-4000-8000-000000000122', 'Semoule fine',                  800),
  ('fab28400-0000-4000-8000-000000000122', 'Sucre semoule',                 250),
  ('fab28400-0000-4000-8000-000000000122', 'Beurre',                        200),
  ('fab28400-0000-4000-8000-000000000122', 'Lait',                          300),
  ('fab28400-0000-4000-8000-000000000122', 'Oeufs entiers liquides',        150),
  ('fab28400-0000-4000-8000-000000000122', 'Levure chimique',                12)
) AS v (recette_id, ingredient, qte)
JOIN recipes r      ON r.id   = v.recette_id
JOIN _sale_ing ing  ON ing.name = v.ingredient;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Table de resolution des PREPARATIONS par nom : mes 22 bases (ou celles de
--    281/283 quand le nom etait deja pris) + les 5 bases transversales de la
--    mig 280. `archived_at IS NULL` est obligatoire : d'anciennes fiches
--    archivees portent les memes noms (« Crème pâtissière »), et un JOIN sans
--    ce filtre irait chercher la mauvaise fournee.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _sale_rec ON COMMIT DROP AS
SELECT DISTINCT ON (r.name) r.name, r.id
FROM recipes r
WHERE r.archived_at IS NULL
  AND r.is_base
  AND r.name IN (
    'Pâte à msemen', 'Beurre de tourage msemen', 'Pâte à harcha',
    'Pâte à harcha à l''orge', 'Pâte à harcha complète', 'Pâte à batbout',
    'Appareil à baghrir', 'Farce poulet pastilla', 'Farce fruits de mer',
    'Farce viande hachée épicée', 'Farce poulet marinée', 'Appareil à quiche',
    'Pâte brisée salée', 'Pâte à pizza', 'Sauce tomate pizza',
    'Garniture pizza thon', 'Garniture pizza poulet', 'Béchamel',
    'Pâte à pain sandwich', 'Farce nems poulet', 'Farce nems légumes',
    'Appareil à basbousa',
    -- bases transversales mig 280
    'Pâte levée feuilletée', 'Pâte sucrée', 'Crème pâtissière', 'Sirop à 30°B', 'Dorure')
ORDER BY r.name, (r.id::text LIKE 'fab28400%') DESC, r.created_at;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM _sale_rec;
  IF n <> 27 THEN
    RAISE EXCEPTION 'Preparations introuvables : % sur 27 attendues', n;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Les 22 fiches PRODUIT FINI (mode_cout = compose).
--    yield_quantity = nombre de pieces du format PAR DEFAUT : c'est le
--    diviseur qui ramene le cout de la fournee a une piece vendable.
--    product_id n'est pose que sur les fiches mono-produit ; partout ailleurs
--    le lien au produit vendu passe par les formats (etape 7).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipes (id, name, is_base, mode_cout, yield_quantity, yield_unit,
                     perte_standard_pct, category_id, product_id, instructions)
SELECT v.id, v.nom, false, 'compose', v.yield, 'unit', 0,
       (SELECT id FROM recipe_categories WHERE code = v.cat), v.produit, v.notes
FROM (VALUES
  ('fab28400-0000-4000-8000-000000000130'::uuid, 'Msemen',                 40::numeric, 'sale_beldi', NULL::uuid,
   'Feuilletage a l''huile, cuisson plancha. 6 declinaisons (khlii, olive, prestige, mini nature, mini khlii, bebe farci viande).
Conservation : 24 h a temperature ambiante en sachet, 3 jours a +4 °C, 1 mois a -18 °C (feuilleter cru, congeler a plat).
Rechauffe : plancha 30 s par face, JAMAIS au micro-ondes (il devient caoutchouteux).
Allergenes : gluten. Prestige : lait (fromage). Khlii : aucun ajout.'),
  ('fab28400-0000-4000-8000-000000000131', 'Harcha',                       40, 'sale_beldi', NULL,
   'Galette de semoule sablee au beurre, cuisson plancha a feu doux 6-7 min par face.
8 declinaisons : nature (2 references), pack de 3, fromage, olive, pack olive, raisin, chocolat.
Conservation : 24 h. Se rechauffe tres bien a la plancha. Allergenes : gluten, lait.'),
  ('fab28400-0000-4000-8000-000000000132', 'Harcha à l''orge',             40, 'sale_beldi', NULL,
   'Variante 40 % farine d''orge : gout beldi plus marque, mie plus dense. Vendue a l''unite et en pack de 3.
Conservation : 24 h. Allergenes : gluten (orge), lait.'),
  ('fab28400-0000-4000-8000-000000000133', 'Harcha complète',              40, 'sale_beldi', '163d60e0-e72d-4d11-99ce-eaa24eecd318',
   'Harcha a la farine complete et au sesame, format 100 g. Conservation 24 h. Allergenes : gluten, lait, sesame.'),
  ('fab28400-0000-4000-8000-000000000134', 'Batbout',                      40, 'sale_beldi', NULL,
   'Pain vapeur cuit a la plancha seche. 4 declinaisons : mini, bebe a la piece, sachet de 10 bebes, mini farci viande.
Le batbout doit gonfler en ballon : plancha a 200 °C, 2 min par face, ne jamais ecraser.
Conservation : 24 h en sachet ferme (il seche tres vite a l''air). Allergenes : gluten, lait.'),
  ('fab28400-0000-4000-8000-000000000135', 'Baghrir',                       6, 'sale_beldi', NULL,
   'Crepe mille trous, cuisson sur UNE face uniquement. Vendu en sachets de 5, 6, 8 et 10 pieces (65 g/piece).
Point de controle : si les trous ne s''ouvrent pas, l''appareil est trop epais ou la plancha trop froide (viser 180 °C).
Conservation : 24 h, empiles avec un papier entre chaque. Allergenes : gluten, oeuf, lait.'),
  ('fab28400-0000-4000-8000-000000000136', 'Pastilla au poulet',           20, 'sale_beldi', NULL,
   'Trois formats : individuelle 16 DH, mini bouchee, et grande 8 personnes (2,4 kg, Ø32).
Conservation : 48 h a +4 °C montee crue, 2 mois a -18 °C. Cuire directement congelee (+5 min).
Allergenes : gluten (feuille), oeuf, amande. Contient du sucre et de la cannelle (recette sucre-sale).'),
  ('fab28400-0000-4000-8000-000000000137', 'Pastilla aux fruits de mer',   20, 'sale_beldi', NULL,
   'Deux formats : individuelle et mini. Farce IMPERATIVEMENT froide et bien egouttee au montage.
Produit sensible : chaine du froid stricte, DLC 24 h a +4 °C. Allergenes : gluten, crustaces, mollusques, lait.'),
  ('fab28400-0000-4000-8000-000000000138', 'Briouat',                      60, 'sale_beldi', NULL,
   'Triangles en feuille de pastilla, pliage en drapeau, friture 170 °C 3 min.
Deux declinaisons : viande hachee et poulet-fromage. Conservation crue 48 h a +4 °C, 2 mois a -18 °C.
Allergenes : gluten. Version poulet : lait.'),
  ('fab28400-0000-4000-8000-000000000139', 'Nems',                         40, 'sale_beldi', NULL,
   'Rouleaux fritures 170 °C 4 min, egouttes sur grille (jamais sur papier : ils ramollissent).
Deux declinaisons : poulet et legumes. Allergenes : gluten, soja.'),
  ('fab28400-0000-4000-8000-000000000140', 'Quiche',                       15, 'sale_beldi', NULL,
   'Fond de pate brisee cuit a blanc, migaine 1 oeuf pour 150 g de liquide.
7 formats : jambon de dinde, champignons-oignon caramelise, epinard-fromage, saumon, mini saumon,
viande hachee, et une grande Ø28 de 8 parts (reference traiteur, sans produit associe).
Conservation : 48 h a +4 °C. Rechauffe 160 °C 8 min. Allergenes : gluten, oeuf, lait ; saumon : poisson.'),
  ('fab28400-0000-4000-8000-000000000141', 'Pizza',                        12, 'sale_beldi', NULL,
   'Pate maturee 24 h au froid, 4 garnitures : thon, thon carre, poulet, viande hachee.
Cuisson sole 280 °C 6-8 min. Conservation : consommation dans la journee. Allergenes : gluten, lait, poisson (thon).'),
  ('fab28400-0000-4000-8000-000000000142', 'Croque-monsieur',              12, 'sale_beldi', NULL,
   'Pain de mie, bechamel, dinde fumee, fromage rape. Deux tailles (entier et mini).
Cuisson four 200 °C 10 min ou grill. Conservation : 24 h a +4 °C avant cuisson. Allergenes : gluten, lait.'),
  ('fab28400-0000-4000-8000-000000000143', 'Sandwich garni',                6, 'sale_beldi', NULL,
   'Pain sandwich maison. 4 formats : poulet, thon, bebe sandwich, bebe complet.
Monte a la commande. Si prepare a l''avance : beurrer le pain pour l''impermeabiliser, DLC 12 h a +4 °C.
Allergenes : gluten, oeuf (mayonnaise), poisson (thon), lait (bebe complet).'),
  ('fab28400-0000-4000-8000-000000000144', 'Mini hamburger',               24, 'sale_beldi', 'b4a5e9b9-533d-4391-8042-cf2b133b4fd9',
   'Bun maison 60 g, steak de farce epicee, fromage rape, sauces. Allergenes : gluten, oeuf, lait, moutarde.'),
  ('fab28400-0000-4000-8000-000000000145', 'Mini tacos',                   24, 'sale_beldi', '4537898b-eb4c-4efa-b4aa-443c9a070b95',
   'Galette de pate a msemen etalee fine, poulet marine, fromage, sauces, refermee et pressee au grill.
Allergenes : gluten, oeuf, lait, moutarde.'),
  ('fab28400-0000-4000-8000-000000000146', 'Croissant salé',               18, 'viennoiserie', '6670c239-2620-4c61-991e-f5f546f86fa7',
   'Croissant en pate levee feuilletee garni bechamel, dinde fumee et fromage, dore avant cuisson.
Cuisson 175 °C 16 min. Allergenes : gluten, oeuf, lait.'),
  ('fab28400-0000-4000-8000-000000000147', 'Kounafa',                      30, 'gateaux_marocains', NULL,
   'Cheveux d''ange beurres, garnis amande ou pistache, cuits 170 °C 25 min puis nappes de miel a chaud.
Deux declinaisons. Conservation : 5 jours a temperature ambiante. Allergenes : gluten, lait, fruits a coque.'),
  ('fab28400-0000-4000-8000-000000000148', 'Basbousa',                     30, 'gateaux_marocains', NULL,
   'Gateau de semoule imbibe. Trois formats : part, plat 10 personnes, part a la creme.
Sirop FROID sur gateau CHAUD, sinon le gateau reste sec au coeur.
Conservation : 5 jours. Allergenes : gluten, oeuf, lait, amande.'),
  ('fab28400-0000-4000-8000-000000000149', 'Chahda',                       30, 'gateaux_marocains', 'ffa579be-9d27-4a64-aa82-a7592c0d3402',
   'Feuillete beldi a l''amande nappe de miel et sesame, servi tiede.
Conservation : 3 jours a temperature ambiante. Allergenes : gluten, fruits a coque, sesame.'),
  ('fab28400-0000-4000-8000-000000000150', 'Sablé framboise',              60, 'patisserie', 'ecfebd1b-3d5c-4b6f-87ca-b0f4ef44b6c6',
   'Sable en pate sucree, coeur confiture de framboise, sucre glace. Conservation 10 jours en boite hermetique.
Allergenes : gluten, oeuf, lait.'),
  ('fab28400-0000-4000-8000-000000000151', 'Mini plateau salé',             1, 'sale_beldi', '5ce2a13b-e651-486d-8024-b957454bc0da',
   'Plateau traiteur de 18 pieces monte a partir des fiches de la maison :
3 msemen au khlii, 2 pastillas au poulet, 6 briouats viande, 4 mini quiches, 3 nems poulet.
Les composants sont exprimes en PIECES (unite « unit ») et non en grammes : chaque ligne consomme
une fraction de la fournee de la fiche source, exactement comme une sous-recette pesee.
Montage a J-0, DLC 24 h a +4 °C. Allergenes : gluten, oeuf, lait, fruits a coque, soja.')
) AS v (id, nom, yield, cat, produit, notes)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Les 62 formats.
--
--    CONTRAINTE recipe_formats_recipe_id_contenant_id_key : une recette ne peut
--    porter qu'UNE fois le meme contenant. Les declinaisons d'une meme fiche
--    (les 8 harchas, les 4 baghrirs) sont donc a contenant_id NULL sauf une :
--    elles sortent physiquement de la meme plaque, la ligne par defaut porte le
--    contenant reel et les autres heritent du meme process. Seule la Quiche a
--    deux contenants distincts (plaque a tartelettes / cercle Ø28) parce que
--    ce sont deux mises en oeuvre differentes.
--
--    quantite_par_format est pose a 1 ici puis RECALCULE a l'etape 9 comme
--    (somme des composants) / nb_par_defaut : impossible de le desynchroniser.
--
--    nb_par_defaut = pieces vendables par contenant. Pour les conditionnements
--    multiples (sachet de 3 harchas, sachet de 10 baghrirs), la « piece » est
--    LE SACHET : nb_par_defaut = nombre de sachets tires de la fournee.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipe_formats (id, recipe_id, contenant_id, quantite_par_format,
                            quantite_par_format_unite, nb_par_defaut, is_default,
                            ordre, product_id)
SELECT v.id, v.recette_id, c.id, 1, 'g', v.nb, v.defaut, v.ordre, v.produit
FROM (VALUES
  -- ── Msemen ───────────────────────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000201'::uuid, 'fab28400-0000-4000-8000-000000000130'::uuid, 'Plaque de cuisson plate 60x40', 40, true,  1, '00030781-db31-44fc-88bb-97f0b83d021c'::uuid),  -- MSEMMEN AU KHLII
  ('fab28400-0000-4000-8000-000000000202', 'fab28400-0000-4000-8000-000000000130', NULL, 40, false, 2, 'c4c3c23e-6118-4df4-92ee-ef4d1a6a034f'),  -- MSEMMEN AU OLIVE
  ('fab28400-0000-4000-8000-000000000203', 'fab28400-0000-4000-8000-000000000130', NULL, 40, false, 3, '5baf8227-72fc-4dda-9043-332a31c03496'),  -- Msemen prestige
  ('fab28400-0000-4000-8000-000000000204', 'fab28400-0000-4000-8000-000000000130', NULL, 15, false, 4, 'e3520730-6458-47a9-8921-3340cf8376ad'),  -- MINI MSEMMEN NATURE (sachet de 4)
  ('fab28400-0000-4000-8000-000000000205', 'fab28400-0000-4000-8000-000000000130', NULL, 60, false, 5, '4ab5db48-7c58-4c37-bc3e-86373e41277c'),  -- MINI MSEMMEN AU KHLII
  ('fab28400-0000-4000-8000-000000000206', 'fab28400-0000-4000-8000-000000000130', NULL, 15, false, 6, '356f7f23-87ba-41ef-989a-3ad18f30dcfe'),  -- Bebe msemen farce viande (sachet de 4)
  -- ── Harcha ───────────────────────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000207', 'fab28400-0000-4000-8000-000000000131', 'Plaque de cuisson plate 60x40', 40, true,  1, 'ab034010-747f-4c7a-a2df-119b49fd6660'),  -- HARSHA
  ('fab28400-0000-4000-8000-000000000208', 'fab28400-0000-4000-8000-000000000131', NULL, 40, false, 2, '39857121-fdae-48f4-9477-2f477e719ee1'),  -- Harcha nature (doublon catalogue)
  ('fab28400-0000-4000-8000-000000000209', 'fab28400-0000-4000-8000-000000000131', NULL, 14, false, 3, '954ecd44-31e8-4b80-994d-6d4289c1f840'),  -- Pack harcha nature (3 pieces)
  ('fab28400-0000-4000-8000-000000000210', 'fab28400-0000-4000-8000-000000000131', NULL, 40, false, 4, 'd45c3cfb-3cf8-4a65-95f1-b59e788fd191'),  -- HARSHA FROMAGE
  ('fab28400-0000-4000-8000-000000000211', 'fab28400-0000-4000-8000-000000000131', NULL, 40, false, 5, '217aa96a-3255-4821-97db-85f16dc5695e'),  -- HARSHA OLIVE
  ('fab28400-0000-4000-8000-000000000212', 'fab28400-0000-4000-8000-000000000131', NULL, 14, false, 6, '5a1dfc77-c550-480f-bd1c-345faad66dff'),  -- Pack harcha olive (3 pieces)
  ('fab28400-0000-4000-8000-000000000213', 'fab28400-0000-4000-8000-000000000131', NULL, 40, false, 7, '594b2e29-8547-4476-a6e7-cdd5f56df5f2'),  -- Harcha raisin
  ('fab28400-0000-4000-8000-000000000214', 'fab28400-0000-4000-8000-000000000131', NULL, 40, false, 8, '63479a98-8a2b-46ee-96b5-e634f0f700d1'),  -- Harcha chocolat
  ('fab28400-0000-4000-8000-000000000215', 'fab28400-0000-4000-8000-000000000132', 'Plaque de cuisson plate 60x40', 40, true,  1, 'eafcdd2c-0320-4e6b-8426-311bbdf8d063'),  -- Harcha orge
  ('fab28400-0000-4000-8000-000000000216', 'fab28400-0000-4000-8000-000000000132', NULL, 14, false, 2, '294ba55e-4a81-4fa5-843a-04e9147a4eb8'),  -- Pach harcha orge (3 pieces)
  ('fab28400-0000-4000-8000-000000000217', 'fab28400-0000-4000-8000-000000000133', 'Plaque de cuisson plate 60x40', 40, true,  1, '163d60e0-e72d-4d11-99ce-eaa24eecd318'),  -- Harcha complet
  -- ── Batbout ──────────────────────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000218', 'fab28400-0000-4000-8000-000000000134', 'Plaque de cuisson plate 60x40', 40, true,  1, 'd267b6f5-d161-45bf-abde-bb9ddfbb765d'),  -- Batbout mini
  ('fab28400-0000-4000-8000-000000000219', 'fab28400-0000-4000-8000-000000000134', NULL, 60, false, 2, '74e1ed09-85ce-42a6-9a3e-ace770baf48b'),  -- Bebe batbout 1 piece
  ('fab28400-0000-4000-8000-000000000220', 'fab28400-0000-4000-8000-000000000134', NULL,  6, false, 3, '53085f48-4421-42cc-a6ff-979c47d07b05'),  -- BEBE BATBOUT 10 P
  ('fab28400-0000-4000-8000-000000000221', 'fab28400-0000-4000-8000-000000000134', NULL, 40, false, 4, '175a22dc-3c9d-4cf1-b76d-aa971f12e3e0'),  -- MINI BATBOUT FARCE
  -- ── Baghrir (cuisson plancha : aucun contenant labo) ─────────────────────
  ('fab28400-0000-4000-8000-000000000222', 'fab28400-0000-4000-8000-000000000135', NULL,  6, true,  1, 'fd46d541-7d57-45ee-b62f-bc02d08ca987'),  -- BAGHRIR 10P
  ('fab28400-0000-4000-8000-000000000223', 'fab28400-0000-4000-8000-000000000135', NULL, 12, false, 2, '37d6d692-7872-4f35-a047-6e3b2d1addfc'),  -- Baghrir 5pcs
  ('fab28400-0000-4000-8000-000000000224', 'fab28400-0000-4000-8000-000000000135', NULL, 10, false, 3, '05988341-8e6f-4b33-8cf2-c33a7e323271'),  -- Baghrir 6pcs
  ('fab28400-0000-4000-8000-000000000225', 'fab28400-0000-4000-8000-000000000135', NULL,  8, false, 4, 'ea2670b6-8a00-402f-ba25-640c820088b4'),  -- Baghrir 8pcs
  -- ── Pastilla poulet ──────────────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000226', 'fab28400-0000-4000-8000-000000000136', 'Plaque de cuisson plate 60x40', 20, true,  1, '7f8c89bc-3d49-4a75-ada9-75dc48310f38'),  -- PASTILLA AU POULET
  ('fab28400-0000-4000-8000-000000000227', 'fab28400-0000-4000-8000-000000000136', NULL, 40, false, 2, 'f111870c-c35e-481d-aa78-a100966a90da'),  -- MINI PASTILLA AU POULET
  ('fab28400-0000-4000-8000-000000000228', 'fab28400-0000-4000-8000-000000000136', 'Cercle à tarte Ø32 cm',  1, false, 3, '7f3b52ca-eb0d-42ad-bd3f-f1631c7a577e'),  -- Bastila Poulet 8 pers
  -- ── Pastilla fruits de mer ───────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000229', 'fab28400-0000-4000-8000-000000000137', 'Plaque de cuisson plate 60x40', 20, true,  1, '53b70260-ef7e-4a86-ba8c-6a920996ca59'),  -- PASTILLA FRUITS DE MER
  ('fab28400-0000-4000-8000-000000000230', 'fab28400-0000-4000-8000-000000000137', NULL, 40, false, 2, '7c304e82-6ac3-4870-8d9b-dfb8682524c2'),  -- MINI PASTILLA FRUITS DE MER
  -- ── Briouat ──────────────────────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000231', 'fab28400-0000-4000-8000-000000000138', 'Plaque de cuisson plate 60x40', 60, true,  1, '1955ffc9-bb39-4ba5-a93d-69ac5c0c28cf'),  -- BRIOUAT VIANDE HACHEE
  ('fab28400-0000-4000-8000-000000000232', 'fab28400-0000-4000-8000-000000000138', NULL, 60, false, 2, '987fbed5-1d18-462c-b0cd-6649d7f58c62'),  -- Brioute poulet
  -- ── Nems ─────────────────────────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000233', 'fab28400-0000-4000-8000-000000000139', 'Plaque de cuisson plate 60x40', 40, true,  1, '6ca59b8f-de70-4897-a870-be9d5e59ae84'),  -- NEMS AU POULET
  ('fab28400-0000-4000-8000-000000000234', 'fab28400-0000-4000-8000-000000000139', NULL, 40, false, 2, 'a13433ad-483d-4c0f-8e28-7421ecc74d83'),  -- NEMS AUX LEGUMES
  -- ── Quiche ───────────────────────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000235', 'fab28400-0000-4000-8000-000000000140', 'Plaque à tartelettes silicone (15)', 15, true, 1, 'c6234cae-357b-4a62-9c08-9af5ef93e492'),  -- QUICHE AU JAMBON
  ('fab28400-0000-4000-8000-000000000236', 'fab28400-0000-4000-8000-000000000140', NULL, 15, false, 2, '56a0dbf0-ed25-446c-a393-286855167491'),  -- QUICHE CHAMPIGNONS
  ('fab28400-0000-4000-8000-000000000237', 'fab28400-0000-4000-8000-000000000140', NULL, 15, false, 3, 'b9dbc0fa-0620-4cf9-b494-ded9bc323348'),  -- QUICHE EPINARD FROMAGE
  ('fab28400-0000-4000-8000-000000000238', 'fab28400-0000-4000-8000-000000000140', NULL, 15, false, 4, 'd57039cd-244a-4828-863f-78f64cf5de42'),  -- Quiche saumon
  ('fab28400-0000-4000-8000-000000000239', 'fab28400-0000-4000-8000-000000000140', NULL, 30, false, 5, '4e2ababb-6d48-4c84-bb29-03380bd0699f'),  -- Quiche saumon mini
  ('fab28400-0000-4000-8000-000000000240', 'fab28400-0000-4000-8000-000000000140', NULL, 15, false, 6, '1b830d2f-8bf9-41bf-b720-48bfa6010a33'),  -- Quiche viande hachee
  ('fab28400-0000-4000-8000-000000000241', 'fab28400-0000-4000-8000-000000000140', 'Cercle à tarte Ø28 cm', 1, false, 7, NULL),                    -- Grande quiche 8 parts (traiteur)
  -- ── Pizza ────────────────────────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000242', 'fab28400-0000-4000-8000-000000000141', 'Plaque perforée 60x40', 12, true,  1, '86ea3403-fc5f-4fb5-9e2d-97f77f5ed243'),  -- PIZZA THON
  ('fab28400-0000-4000-8000-000000000243', 'fab28400-0000-4000-8000-000000000141', NULL, 12, false, 2, '6998fbc9-d705-4b85-851a-898b077c73c1'),  -- PIZZA CARRE AU THON
  ('fab28400-0000-4000-8000-000000000244', 'fab28400-0000-4000-8000-000000000141', NULL, 12, false, 3, 'b9c8a6ff-ddee-495e-b45d-ef03b532641f'),  -- PIZZA POULET
  ('fab28400-0000-4000-8000-000000000245', 'fab28400-0000-4000-8000-000000000141', NULL, 12, false, 4, '5428b02b-69e0-4bc9-8fb9-18421731ef76'),  -- PIZZA VIANDE HACHEE
  -- ── Croque-monsieur ──────────────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000246', 'fab28400-0000-4000-8000-000000000142', 'Plaque de cuisson plate 60x40', 12, true,  1, 'a9ba30d5-cd90-4b79-990c-e8ea5db45cca'),  -- CROC MONSIEUR
  ('fab28400-0000-4000-8000-000000000247', 'fab28400-0000-4000-8000-000000000142', NULL, 24, false, 2, '34942173-d8c6-4f11-b4f2-79d28e64c0e3'),  -- CROC MONSIEUR MINI
  -- ── Sandwich garni ───────────────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000248', 'fab28400-0000-4000-8000-000000000143', 'Filet de cuisson pains sandwich (6)', 6, true, 1, '4e18e683-0dd6-484a-b8af-7552b44a0041'),  -- Sandwich poulet
  ('fab28400-0000-4000-8000-000000000249', 'fab28400-0000-4000-8000-000000000143', NULL,  6, false, 2, '5572da45-64b7-4be8-919c-29934c337715'),  -- SANDWICH THON
  ('fab28400-0000-4000-8000-000000000250', 'fab28400-0000-4000-8000-000000000143', NULL, 20, false, 3, 'af2fe321-5510-489a-a28f-ed8bd3c31bd9'),  -- Bebe sandwich
  ('fab28400-0000-4000-8000-000000000251', 'fab28400-0000-4000-8000-000000000143', NULL, 20, false, 4, '69ac7bc8-3807-4188-9d83-d77591ee5c5f'),  -- BEBE SANDWICH COMPLET
  -- ── Fiches mono-produit ──────────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000252', 'fab28400-0000-4000-8000-000000000144', 'Plaque de cuisson plate 60x40', 24, true, 1, 'b4a5e9b9-533d-4391-8042-cf2b133b4fd9'),  -- Hamburger mini
  ('fab28400-0000-4000-8000-000000000253', 'fab28400-0000-4000-8000-000000000145', 'Plaque de cuisson plate 60x40', 24, true, 1, '4537898b-eb4c-4efa-b4aa-443c9a070b95'),  -- MINI TACOS
  ('fab28400-0000-4000-8000-000000000254', 'fab28400-0000-4000-8000-000000000146', 'Plaque 60x40 viennoiseries (18)', 18, true, 1, '6670c239-2620-4c61-991e-f5f546f86fa7'),  -- CROISSANT SALE
  -- ── Kounafa ──────────────────────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000255', 'fab28400-0000-4000-8000-000000000147', 'Plaque de cuisson plate 40x30', 30, true,  1, '56267cb9-f1be-4c51-ac28-55d766b1cbb9'),  -- KOUNAFA AMANDE
  ('fab28400-0000-4000-8000-000000000256', 'fab28400-0000-4000-8000-000000000147', NULL, 30, false, 2, 'ca02177b-0aa8-4e5d-bc16-f900f5d9bab5'),  -- KOUNAFA PISTACHE
  -- ── Basbousa ─────────────────────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000257', 'fab28400-0000-4000-8000-000000000148', 'Plaque de cuisson plate 40x30', 30, true,  1, '2a74e08a-a53b-45ae-808f-6c221a9d4bcf'),  -- Basbousa (part)
  ('fab28400-0000-4000-8000-000000000258', 'fab28400-0000-4000-8000-000000000148', NULL,  3, false, 2, 'cfc8570b-7cbf-4e06-b240-3cf1be24d7f6'),  -- Basbousa 10 pers
  ('fab28400-0000-4000-8000-000000000259', 'fab28400-0000-4000-8000-000000000148', NULL, 30, false, 3, 'f422fd16-bc80-4cf8-9e28-84d8bccf575a'),  -- BASBOUSA CREME
  -- ── Chahda / Sablé / Plateau ─────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000260', 'fab28400-0000-4000-8000-000000000149', 'Plaque de cuisson plate 60x40', 30, true, 1, 'ffa579be-9d27-4a64-aa82-a7592c0d3402'),  -- Chahda
  ('fab28400-0000-4000-8000-000000000261', 'fab28400-0000-4000-8000-000000000150', 'Plaque perforée 60x40', 60, true, 1, 'ecfebd1b-3d5c-4b6f-87ca-b0f4ef44b6c6'),          -- Sable framboise
  ('fab28400-0000-4000-8000-000000000262', 'fab28400-0000-4000-8000-000000000151', NULL,  1, true,  1, '5ce2a13b-e651-486d-8024-b957454bc0da')   -- MINI PLATEAU SALEE
) AS v (id, recette_id, contenant, nb, defaut, ordre, produit)
LEFT JOIN production_contenants c ON c.nom = v.contenant
ON CONFLICT (id) DO NOTHING;

-- Garde-fou : un nom de contenant mal orthographie passerait en silence par le
-- LEFT JOIN et le format perdrait son contenant sans que rien ne le signale.
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM recipe_formats
   WHERE id::text LIKE 'fab28400%' AND contenant_id IS NOT NULL;
  IF n <> 22 THEN
    RAISE EXCEPTION 'Contenants non resolus : % formats en portent un sur 22 attendus', n;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Nomenclature de chaque format.
--
--    LES QUANTITES CI-DESSOUS SONT PAR PIECE VENDUE (ou par sachet pour les
--    conditionnements multiples). L'INSERT les multiplie par nb_par_defaut
--    pour obtenir le poids NET mis en oeuvre dans TOUT le contenant, comme
--    l'exige recipe_format_components. C'est le seul endroit ou il faut lire
--    les chiffres en « pesee du chef » : 110 g de pate + 14 g de beurre de
--    tourage, c'est un msemen, pas une plaque.
--
--    perte_pct = perte de mise en oeuvre a l'assemblage (farce qui reste dans
--    le bac, bechamel sur la spatule) : 3 % sur les preparations pochees ou
--    etalees, 0 sur ce qui est pese piece a piece.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM recipe_format_components
 WHERE format_id::text LIKE 'fab28400-0000-4000-8000-0000000002%';

-- 8a. Composants issus d'une PREPARATION (sous-recette).
INSERT INTO recipe_format_components (format_id, role, source_recipe_id, quantite, unite, perte_pct, ordre)
SELECT v.format_id, v.role, rec.id, v.qte_piece * f.nb_par_defaut, 'g', v.perte, v.ordre
FROM (VALUES
  -- ── Msemen : pate + beurre de tourage (le feuilletage a l'huile) ─────────
  ('fab28400-0000-4000-8000-000000000201'::uuid, 'fond',      'Pâte à msemen',              110::numeric, 0::numeric, 1::smallint),
  ('fab28400-0000-4000-8000-000000000201', 'garniture', 'Beurre de tourage msemen',    14, 0, 2),
  ('fab28400-0000-4000-8000-000000000202', 'fond',      'Pâte à msemen',              110, 0, 1),
  ('fab28400-0000-4000-8000-000000000202', 'garniture', 'Beurre de tourage msemen',    14, 0, 2),
  ('fab28400-0000-4000-8000-000000000203', 'fond',      'Pâte à msemen',              110, 0, 1),
  ('fab28400-0000-4000-8000-000000000203', 'garniture', 'Beurre de tourage msemen',    14, 0, 2),
  ('fab28400-0000-4000-8000-000000000204', 'fond',      'Pâte à msemen',              168, 0, 1),   -- sachet de 4 x 42 g
  ('fab28400-0000-4000-8000-000000000204', 'garniture', 'Beurre de tourage msemen',    24, 0, 2),
  ('fab28400-0000-4000-8000-000000000205', 'fond',      'Pâte à msemen',               42, 0, 1),
  ('fab28400-0000-4000-8000-000000000205', 'garniture', 'Beurre de tourage msemen',     6, 0, 2),
  ('fab28400-0000-4000-8000-000000000206', 'fond',      'Pâte à msemen',              168, 0, 1),   -- sachet de 4 bebes farcis
  ('fab28400-0000-4000-8000-000000000206', 'garniture', 'Beurre de tourage msemen',    24, 0, 2),
  ('fab28400-0000-4000-8000-000000000206', 'garniture', 'Farce viande hachée épicée',  60, 3, 3),
  -- ── Harcha : la pate fait tout, les inclusions sont a l'etape 8b ─────────
  ('fab28400-0000-4000-8000-000000000207', 'fond',      'Pâte à harcha',               95, 0, 1),
  ('fab28400-0000-4000-8000-000000000208', 'fond',      'Pâte à harcha',               95, 0, 1),
  ('fab28400-0000-4000-8000-000000000209', 'fond',      'Pâte à harcha',              285, 0, 1),   -- pack de 3
  ('fab28400-0000-4000-8000-000000000210', 'fond',      'Pâte à harcha',               90, 0, 1),
  ('fab28400-0000-4000-8000-000000000211', 'fond',      'Pâte à harcha',               92, 0, 1),
  ('fab28400-0000-4000-8000-000000000212', 'fond',      'Pâte à harcha',              276, 0, 1),   -- pack de 3
  ('fab28400-0000-4000-8000-000000000213', 'fond',      'Pâte à harcha',               92, 0, 1),
  ('fab28400-0000-4000-8000-000000000214', 'fond',      'Pâte à harcha',               95, 0, 1),
  ('fab28400-0000-4000-8000-000000000215', 'fond',      'Pâte à harcha à l''orge',     95, 0, 1),
  ('fab28400-0000-4000-8000-000000000216', 'fond',      'Pâte à harcha à l''orge',    285, 0, 1),   -- pack de 3
  ('fab28400-0000-4000-8000-000000000217', 'fond',      'Pâte à harcha complète',     100, 0, 1),
  -- ── Batbout ─────────────────────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000218', 'fond',      'Pâte à batbout',              60, 0, 1),
  ('fab28400-0000-4000-8000-000000000219', 'fond',      'Pâte à batbout',              25, 0, 1),
  ('fab28400-0000-4000-8000-000000000220', 'fond',      'Pâte à batbout',             250, 0, 1),   -- sachet de 10 bebes
  ('fab28400-0000-4000-8000-000000000221', 'fond',      'Pâte à batbout',              55, 0, 1),
  ('fab28400-0000-4000-8000-000000000221', 'garniture', 'Farce viande hachée épicée',  25, 3, 2),
  -- ── Baghrir : 65 g d'appareil par crepe ─────────────────────────────────
  ('fab28400-0000-4000-8000-000000000222', 'fond',      'Appareil à baghrir',         650, 0, 1),   -- 10 pieces
  ('fab28400-0000-4000-8000-000000000223', 'fond',      'Appareil à baghrir',         325, 0, 1),   --  5 pieces
  ('fab28400-0000-4000-8000-000000000224', 'fond',      'Appareil à baghrir',         390, 0, 1),   --  6 pieces
  ('fab28400-0000-4000-8000-000000000225', 'fond',      'Appareil à baghrir',         520, 0, 1),   --  8 pieces
  -- ── Pastillas ───────────────────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000226', 'garniture', 'Farce poulet pastilla',       90, 3, 2),
  ('fab28400-0000-4000-8000-000000000227', 'garniture', 'Farce poulet pastilla',       38, 3, 2),
  ('fab28400-0000-4000-8000-000000000228', 'garniture', 'Farce poulet pastilla',     1400, 3, 2),   -- 8 personnes
  ('fab28400-0000-4000-8000-000000000229', 'garniture', 'Farce fruits de mer',         92, 3, 2),
  ('fab28400-0000-4000-8000-000000000230', 'garniture', 'Farce fruits de mer',         38, 3, 2),
  -- ── Briouats et nems ────────────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000231', 'garniture', 'Farce viande hachée épicée',  30, 3, 2),
  ('fab28400-0000-4000-8000-000000000232', 'garniture', 'Farce poulet marinée',        30, 3, 2),
  ('fab28400-0000-4000-8000-000000000233', 'garniture', 'Farce nems poulet',           48, 3, 2),
  ('fab28400-0000-4000-8000-000000000234', 'garniture', 'Farce nems légumes',          48, 3, 2),
  -- ── Quiches : fond brise + migaine, garnitures a l'etape 8b ─────────────
  ('fab28400-0000-4000-8000-000000000235', 'fond',      'Pâte brisée salée',           35, 0, 1),
  ('fab28400-0000-4000-8000-000000000235', 'garniture', 'Appareil à quiche',           42, 0, 3),
  ('fab28400-0000-4000-8000-000000000236', 'fond',      'Pâte brisée salée',           35, 0, 1),
  ('fab28400-0000-4000-8000-000000000236', 'garniture', 'Appareil à quiche',           45, 0, 3),
  ('fab28400-0000-4000-8000-000000000237', 'fond',      'Pâte brisée salée',           35, 0, 1),
  ('fab28400-0000-4000-8000-000000000237', 'garniture', 'Appareil à quiche',           45, 0, 3),
  ('fab28400-0000-4000-8000-000000000238', 'fond',      'Pâte brisée salée',           35, 0, 1),
  ('fab28400-0000-4000-8000-000000000238', 'garniture', 'Appareil à quiche',           42, 0, 3),
  ('fab28400-0000-4000-8000-000000000239', 'fond',      'Pâte brisée salée',           20, 0, 1),
  ('fab28400-0000-4000-8000-000000000239', 'garniture', 'Appareil à quiche',           24, 0, 3),
  ('fab28400-0000-4000-8000-000000000240', 'fond',      'Pâte brisée salée',           35, 0, 1),
  ('fab28400-0000-4000-8000-000000000240', 'garniture', 'Appareil à quiche',           42, 0, 3),
  ('fab28400-0000-4000-8000-000000000240', 'garniture', 'Farce viande hachée épicée',  32, 3, 4),
  ('fab28400-0000-4000-8000-000000000241', 'fond',      'Pâte brisée salée',          260, 0, 1),   -- grande Ø28, 8 parts
  ('fab28400-0000-4000-8000-000000000241', 'garniture', 'Appareil à quiche',          420, 0, 3),
  -- ── Pizzas ──────────────────────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000242', 'fond',      'Pâte à pizza',               100, 0, 1),
  ('fab28400-0000-4000-8000-000000000242', 'garniture', 'Sauce tomate pizza',          32, 3, 2),
  ('fab28400-0000-4000-8000-000000000242', 'garniture', 'Garniture pizza thon',        20, 3, 3),
  ('fab28400-0000-4000-8000-000000000243', 'fond',      'Pâte à pizza',               100, 0, 1),
  ('fab28400-0000-4000-8000-000000000243', 'garniture', 'Sauce tomate pizza',          32, 3, 2),
  ('fab28400-0000-4000-8000-000000000243', 'garniture', 'Garniture pizza thon',        20, 3, 3),
  ('fab28400-0000-4000-8000-000000000244', 'fond',      'Pâte à pizza',               100, 0, 1),
  ('fab28400-0000-4000-8000-000000000244', 'garniture', 'Sauce tomate pizza',          32, 3, 2),
  ('fab28400-0000-4000-8000-000000000244', 'garniture', 'Garniture pizza poulet',      30, 3, 3),
  ('fab28400-0000-4000-8000-000000000245', 'fond',      'Pâte à pizza',               100, 0, 1),
  ('fab28400-0000-4000-8000-000000000245', 'garniture', 'Sauce tomate pizza',          32, 3, 2),
  ('fab28400-0000-4000-8000-000000000245', 'garniture', 'Farce viande hachée épicée',  35, 3, 3),
  -- ── Croque-monsieur ─────────────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000246', 'garniture', 'Béchamel',                    40, 3, 2),
  ('fab28400-0000-4000-8000-000000000247', 'garniture', 'Béchamel',                    20, 3, 2),
  -- ── Sandwichs ───────────────────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000248', 'fond',      'Pâte à pain sandwich',       100, 0, 1),
  ('fab28400-0000-4000-8000-000000000248', 'garniture', 'Farce poulet marinée',        80, 3, 2),
  ('fab28400-0000-4000-8000-000000000249', 'fond',      'Pâte à pain sandwich',       100, 0, 1),
  ('fab28400-0000-4000-8000-000000000250', 'fond',      'Pâte à pain sandwich',        40, 0, 1),
  ('fab28400-0000-4000-8000-000000000250', 'garniture', 'Farce poulet marinée',        25, 3, 2),
  ('fab28400-0000-4000-8000-000000000251', 'fond',      'Pâte à pain sandwich',        50, 0, 1),
  ('fab28400-0000-4000-8000-000000000252', 'fond',      'Pâte à pain sandwich',        60, 0, 1),   -- bun
  ('fab28400-0000-4000-8000-000000000252', 'garniture', 'Farce viande hachée épicée',  45, 3, 2),
  ('fab28400-0000-4000-8000-000000000253', 'fond',      'Pâte à msemen',               45, 0, 1),   -- galette a tacos
  ('fab28400-0000-4000-8000-000000000253', 'garniture', 'Farce poulet marinée',        20, 3, 2),
  -- ── Croissant salé (pate levee feuilletee de la mig 280) ────────────────
  ('fab28400-0000-4000-8000-000000000254', 'fond',      'Pâte levée feuilletée',       55, 0, 1),
  ('fab28400-0000-4000-8000-000000000254', 'garniture', 'Béchamel',                    15, 3, 2),
  ('fab28400-0000-4000-8000-000000000254', 'decor',     'Dorure',                       3, 0, 4),
  -- ── Basbousa ────────────────────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000257', 'fond',      'Appareil à basbousa',         70, 0, 1),
  ('fab28400-0000-4000-8000-000000000257', 'imbibage',  'Sirop à 30°B',                20, 0, 2),
  ('fab28400-0000-4000-8000-000000000258', 'fond',      'Appareil à basbousa',        700, 0, 1),   -- plat 10 personnes
  ('fab28400-0000-4000-8000-000000000258', 'imbibage',  'Sirop à 30°B',               200, 0, 2),
  ('fab28400-0000-4000-8000-000000000259', 'fond',      'Appareil à basbousa',         70, 0, 1),
  ('fab28400-0000-4000-8000-000000000259', 'insert',    'Crème pâtissière',            40, 3, 2),
  ('fab28400-0000-4000-8000-000000000259', 'imbibage',  'Sirop à 30°B',                20, 0, 3),
  -- ── Chahda et sablé ─────────────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000260', 'fond',      'Pâte à msemen',               90, 0, 1),
  ('fab28400-0000-4000-8000-000000000260', 'garniture', 'Beurre de tourage msemen',    12, 0, 2),
  ('fab28400-0000-4000-8000-000000000261', 'fond',      'Pâte sucrée',                 24, 0, 1)
) AS v (format_id, role, source, qte_piece, perte, ordre)
JOIN recipe_formats f ON f.id = v.format_id
JOIN _sale_rec rec    ON rec.name = v.source;

-- 8b. Composants issus d'un INGREDIENT achete tel quel (garnitures, fromages,
--     huile de cuisson, decors).
INSERT INTO recipe_format_components (format_id, role, source_ingredient_id, quantite, unite, perte_pct, ordre)
SELECT v.format_id, v.role, ing.id, v.qte_piece * f.nb_par_defaut, 'g', v.perte, v.ordre
FROM (VALUES
  -- ── Msemen ──────────────────────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000201'::uuid, 'garniture', 'Khlii',                12::numeric, 0::numeric, 3::smallint),
  ('fab28400-0000-4000-8000-000000000201', 'garniture', 'Huile de table',               4, 0, 4),
  ('fab28400-0000-4000-8000-000000000202', 'garniture', 'Olives noires',               20, 0, 3),
  ('fab28400-0000-4000-8000-000000000202', 'garniture', 'Oignon',                      10, 0, 4),
  ('fab28400-0000-4000-8000-000000000202', 'garniture', 'Huile de table',               4, 0, 5),
  ('fab28400-0000-4000-8000-000000000203', 'garniture', 'Gruyère râpé',                10, 0, 3),
  ('fab28400-0000-4000-8000-000000000203', 'garniture', 'Filet de dinde fume',          8, 0, 4),
  ('fab28400-0000-4000-8000-000000000203', 'garniture', 'Huile de table',               4, 0, 5),
  ('fab28400-0000-4000-8000-000000000204', 'garniture', 'Huile de table',               8, 0, 3),
  ('fab28400-0000-4000-8000-000000000205', 'garniture', 'Khlii',                      3.5, 0, 3),
  ('fab28400-0000-4000-8000-000000000205', 'garniture', 'Huile de table',               2, 0, 4),
  ('fab28400-0000-4000-8000-000000000206', 'garniture', 'Huile de table',               8, 0, 4),
  -- ── Harcha : inclusions ────────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000210', 'garniture', 'Mozzarella',                  10, 0, 2),
  ('fab28400-0000-4000-8000-000000000211', 'garniture', 'Olives noires',               12, 0, 2),
  ('fab28400-0000-4000-8000-000000000212', 'garniture', 'Olives noires',               36, 0, 2),
  ('fab28400-0000-4000-8000-000000000213', 'fruits',    'Raisins secs blonds',         10, 0, 2),
  ('fab28400-0000-4000-8000-000000000214', 'garniture', 'Gouttes Drops 44%',           15, 0, 2),
  -- ── Batbout farci ──────────────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000221', 'garniture', 'Gruyère râpé',                 6, 0, 3),
  -- ── Pastillas : feuille, beurre, amandes et decor sucre-cannelle ───────
  ('fab28400-0000-4000-8000-000000000226', 'fond',      'Feuilles de pastilla',        45, 0, 1),
  ('fab28400-0000-4000-8000-000000000226', 'garniture', 'Beurre',                      12, 0, 3),
  ('fab28400-0000-4000-8000-000000000226', 'garniture', 'Amande concassée',             8, 0, 4),
  ('fab28400-0000-4000-8000-000000000226', 'decor',     'Sucre glace',                  3, 0, 5),
  ('fab28400-0000-4000-8000-000000000226', 'decor',     'Cannelle moulue',            0.5, 0, 6),
  ('fab28400-0000-4000-8000-000000000227', 'fond',      'Feuilles de pastilla',        22, 0, 1),
  ('fab28400-0000-4000-8000-000000000227', 'garniture', 'Beurre',                       6, 0, 3),
  ('fab28400-0000-4000-8000-000000000227', 'garniture', 'Amande concassée',           2.5, 0, 4),
  ('fab28400-0000-4000-8000-000000000228', 'fond',      'Feuilles de pastilla',       400, 0, 1),
  ('fab28400-0000-4000-8000-000000000228', 'garniture', 'Beurre',                     180, 0, 3),
  ('fab28400-0000-4000-8000-000000000228', 'garniture', 'Amande concassée',           400, 0, 4),
  ('fab28400-0000-4000-8000-000000000228', 'decor',     'Sucre glace',                 60, 0, 5),
  ('fab28400-0000-4000-8000-000000000228', 'decor',     'Cannelle moulue',             12, 0, 6),
  ('fab28400-0000-4000-8000-000000000229', 'fond',      'Feuilles de pastilla',        42, 0, 1),
  ('fab28400-0000-4000-8000-000000000229', 'garniture', 'Beurre',                      10, 0, 3),
  ('fab28400-0000-4000-8000-000000000230', 'fond',      'Feuilles de pastilla',        22, 0, 1),
  ('fab28400-0000-4000-8000-000000000230', 'garniture', 'Beurre',                       6, 0, 3),
  -- ── Briouats et nems : feuille + huile de friture absorbee ─────────────
  ('fab28400-0000-4000-8000-000000000231', 'fond',      'Feuilles de pastilla',        12, 0, 1),
  ('fab28400-0000-4000-8000-000000000231', 'garniture', 'Huile de table',               6, 0, 3),
  ('fab28400-0000-4000-8000-000000000232', 'fond',      'Feuilles de pastilla',        12, 0, 1),
  ('fab28400-0000-4000-8000-000000000232', 'garniture', 'Gruyère râpé',                 5, 0, 3),
  ('fab28400-0000-4000-8000-000000000232', 'garniture', 'Huile de table',               6, 0, 4),
  ('fab28400-0000-4000-8000-000000000233', 'fond',      'Feuilles de pastilla',        20, 0, 1),
  ('fab28400-0000-4000-8000-000000000233', 'garniture', 'Huile de table',               8, 0, 3),
  ('fab28400-0000-4000-8000-000000000234', 'fond',      'Feuilles de pastilla',        20, 0, 1),
  ('fab28400-0000-4000-8000-000000000234', 'garniture', 'Huile de table',               8, 0, 3),
  -- ── Quiches : garnitures ───────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000235', 'garniture', 'Filet de dinde fume',         11, 0, 2),
  ('fab28400-0000-4000-8000-000000000235', 'garniture', 'Gruyère râpé',                 4, 0, 4),
  ('fab28400-0000-4000-8000-000000000236', 'garniture', 'Champignons de Paris',        25, 0, 2),
  ('fab28400-0000-4000-8000-000000000236', 'garniture', 'Oignon',                      15, 0, 4),
  ('fab28400-0000-4000-8000-000000000236', 'garniture', 'Beurre',                       3, 0, 5),
  ('fab28400-0000-4000-8000-000000000236', 'garniture', 'Gruyère râpé',                 5, 0, 6),
  ('fab28400-0000-4000-8000-000000000237', 'garniture', 'Épinards frais',              30, 0, 2),
  ('fab28400-0000-4000-8000-000000000237', 'garniture', 'Gruyère râpé',                 6, 0, 4),
  ('fab28400-0000-4000-8000-000000000238', 'garniture', 'Saumon fumé en tranches',    5.5, 0, 2),
  ('fab28400-0000-4000-8000-000000000239', 'garniture', 'Saumon fumé en tranches',      3, 0, 2),
  ('fab28400-0000-4000-8000-000000000240', 'garniture', 'Gruyère râpé',                 5, 0, 5),
  ('fab28400-0000-4000-8000-000000000241', 'garniture', 'Filet de dinde fume',        120, 0, 2),
  ('fab28400-0000-4000-8000-000000000241', 'garniture', 'Gruyère râpé',                60, 0, 4),
  -- ── Pizzas : fromage, olives, filet d'huile ────────────────────────────
  ('fab28400-0000-4000-8000-000000000242', 'garniture', 'Mozzarella',                  16, 0, 4),
  ('fab28400-0000-4000-8000-000000000242', 'garniture', 'Olives noires',                5, 0, 5),
  ('fab28400-0000-4000-8000-000000000242', 'garniture', 'Huile d''olive',               3, 0, 6),
  ('fab28400-0000-4000-8000-000000000243', 'garniture', 'Mozzarella',                  16, 0, 4),
  ('fab28400-0000-4000-8000-000000000243', 'garniture', 'Olives noires',                5, 0, 5),
  ('fab28400-0000-4000-8000-000000000243', 'garniture', 'Huile d''olive',               3, 0, 6),
  ('fab28400-0000-4000-8000-000000000244', 'garniture', 'Mozzarella',                  20, 0, 4),
  ('fab28400-0000-4000-8000-000000000244', 'garniture', 'Huile d''olive',               3, 0, 5),
  ('fab28400-0000-4000-8000-000000000245', 'garniture', 'Mozzarella',                  22, 0, 4),
  ('fab28400-0000-4000-8000-000000000245', 'garniture', 'Olives noires',                6, 0, 5),
  ('fab28400-0000-4000-8000-000000000245', 'garniture', 'Huile d''olive',               3, 0, 6),
  -- ── Croque-monsieur ────────────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000246', 'fond',      'Pain de mie tranché',         60, 0, 1),
  ('fab28400-0000-4000-8000-000000000246', 'garniture', 'Filet de dinde fume',         40, 0, 3),
  ('fab28400-0000-4000-8000-000000000246', 'garniture', 'Gruyère râpé',                32, 0, 4),
  ('fab28400-0000-4000-8000-000000000246', 'garniture', 'Beurre',                       8, 0, 5),
  ('fab28400-0000-4000-8000-000000000247', 'fond',      'Pain de mie tranché',         30, 0, 1),
  ('fab28400-0000-4000-8000-000000000247', 'garniture', 'Filet de dinde fume',         20, 0, 3),
  ('fab28400-0000-4000-8000-000000000247', 'garniture', 'Gruyère râpé',                16, 0, 4),
  ('fab28400-0000-4000-8000-000000000247', 'garniture', 'Beurre',                       4, 0, 5),
  -- ── Sandwichs ──────────────────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000248', 'garniture', 'Mayonnaise bidon',            20, 0, 3),
  ('fab28400-0000-4000-8000-000000000248', 'garniture', 'Tomate',                      30, 0, 4),
  ('fab28400-0000-4000-8000-000000000248', 'garniture', 'Olives noires',                8, 0, 5),
  ('fab28400-0000-4000-8000-000000000249', 'garniture', 'Thon Tam',                    28, 0, 2),
  ('fab28400-0000-4000-8000-000000000249', 'garniture', 'Mayonnaise bidon',            20, 0, 3),
  ('fab28400-0000-4000-8000-000000000249', 'garniture', 'Tomate',                      30, 0, 4),
  ('fab28400-0000-4000-8000-000000000249', 'garniture', 'Olives noires',                8, 0, 5),
  ('fab28400-0000-4000-8000-000000000250', 'garniture', 'Mayonnaise bidon',             8, 0, 3),
  ('fab28400-0000-4000-8000-000000000250', 'garniture', 'Tomate',                      12, 0, 4),
  ('fab28400-0000-4000-8000-000000000251', 'garniture', 'Filet de dinde fume',         25, 0, 2),
  ('fab28400-0000-4000-8000-000000000251', 'garniture', 'Gruyère râpé',                12, 0, 3),
  ('fab28400-0000-4000-8000-000000000251', 'garniture', 'Mayonnaise bidon',            10, 0, 4),
  ('fab28400-0000-4000-8000-000000000251', 'garniture', 'Tomate',                      15, 0, 5),
  ('fab28400-0000-4000-8000-000000000251', 'garniture', 'Olives noires',                5, 0, 6),
  ('fab28400-0000-4000-8000-000000000252', 'garniture', 'Gruyère râpé',                 8, 0, 3),
  ('fab28400-0000-4000-8000-000000000252', 'garniture', 'Ketchup',                     10, 0, 4),
  ('fab28400-0000-4000-8000-000000000252', 'garniture', 'Mayonnaise bidon',             8, 0, 5),
  ('fab28400-0000-4000-8000-000000000252', 'garniture', 'Tomate',                      12, 0, 6),
  ('fab28400-0000-4000-8000-000000000253', 'garniture', 'Gruyère râpé',                 6, 0, 3),
  ('fab28400-0000-4000-8000-000000000253', 'garniture', 'Mayonnaise bidon',             8, 0, 4),
  ('fab28400-0000-4000-8000-000000000253', 'garniture', 'Ketchup',                      6, 0, 5),
  ('fab28400-0000-4000-8000-000000000253', 'garniture', 'Huile de table',               3, 0, 6),
  -- ── Croissant salé ─────────────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000254', 'garniture', 'Filet de dinde fume',         18, 0, 3),
  ('fab28400-0000-4000-8000-000000000254', 'garniture', 'Gruyère râpé',                12, 0, 5),
  -- ── Kounafa : tout est ingredient direct ───────────────────────────────
  ('fab28400-0000-4000-8000-000000000255', 'fond',      'Konafa',                      35, 0, 1),
  ('fab28400-0000-4000-8000-000000000255', 'garniture', 'Beurre',                      12, 0, 2),
  ('fab28400-0000-4000-8000-000000000255', 'garniture', 'Amande concassée',             8, 0, 3),
  ('fab28400-0000-4000-8000-000000000255', 'nappage',   'Miel liquide',                10, 0, 4),
  ('fab28400-0000-4000-8000-000000000256', 'fond',      'Konafa',                      35, 0, 1),
  ('fab28400-0000-4000-8000-000000000256', 'garniture', 'Beurre',                      12, 0, 2),
  ('fab28400-0000-4000-8000-000000000256', 'garniture', 'Pistache décortiquée',         5, 0, 3),
  ('fab28400-0000-4000-8000-000000000256', 'nappage',   'Miel liquide',                10, 0, 4),
  -- ── Basbousa : decor amande ────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000257', 'decor',     'Amande concassée',             3, 0, 3),
  ('fab28400-0000-4000-8000-000000000258', 'decor',     'Amande concassée',            30, 0, 3),
  ('fab28400-0000-4000-8000-000000000259', 'decor',     'Amande concassée',             3, 0, 4),
  -- ── Chahda ─────────────────────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000260', 'garniture', 'Amande concassée',            25, 0, 3),
  ('fab28400-0000-4000-8000-000000000260', 'nappage',   'Miel liquide',                30, 0, 4),
  ('fab28400-0000-4000-8000-000000000260', 'decor',     'Grains de sésame',             5, 0, 5),
  -- ── Sablé framboise ────────────────────────────────────────────────────
  ('fab28400-0000-4000-8000-000000000261', 'insert',    'Confiture de framboise',       6, 0, 2),
  ('fab28400-0000-4000-8000-000000000261', 'decor',     'Sucre glace',                  1, 0, 3)
) AS v (format_id, role, ingredient, qte_piece, perte, ordre)
JOIN recipe_formats f ON f.id = v.format_id
JOIN _sale_ing ing    ON ing.name = v.ingredient;

-- 8c. Le MINI PLATEAU est compose de fiches maison, comptees EN PIECES.
--     unite = 'unit' et non 'g' : fn_unit_conv('unit','unit') = 1, donc
--     chaque ligne consomme quantite / yield_quantity de la fournee de la
--     fiche source — soit exactement N pieces. Une quantite en grammes
--     donnerait ici un cout absurde (la fiche source se compte en pieces).
INSERT INTO recipe_format_components (format_id, role, source_recipe_id, quantite, unite, perte_pct, ordre)
VALUES
  ('fab28400-0000-4000-8000-000000000262', 'garniture', 'fab28400-0000-4000-8000-000000000130', 3, 'unit', 0, 1),  -- 3 msemen khlii
  ('fab28400-0000-4000-8000-000000000262', 'garniture', 'fab28400-0000-4000-8000-000000000136', 2, 'unit', 0, 2),  -- 2 pastillas poulet
  ('fab28400-0000-4000-8000-000000000262', 'garniture', 'fab28400-0000-4000-8000-000000000138', 6, 'unit', 0, 3),  -- 6 briouats viande
  ('fab28400-0000-4000-8000-000000000262', 'garniture', 'fab28400-0000-4000-8000-000000000140', 4, 'unit', 0, 4),  -- 4 mini quiches
  ('fab28400-0000-4000-8000-000000000262', 'garniture', 'fab28400-0000-4000-8000-000000000139', 3, 'unit', 0, 5);  -- 3 nems poulet

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. quantite_par_format = poids d'une piece = somme de la nomenclature / nb.
--    Calcule, jamais saisi : le controle « somme des composants = nb x
--    quantite_par_format » est alors vrai a la decimale pres.
--    Le plateau est exclu (nomenclature en pieces) : son poids est pose a la
--    main d'apres les grammages des fiches qu'il assemble.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE recipe_formats f
   SET quantite_par_format = round(t.total / f.nb_par_defaut, 2), updated_at = NOW()
  FROM (SELECT format_id, sum(quantite) AS total
          FROM recipe_format_components
         WHERE unite = 'g' AND format_id::text LIKE 'fab28400%'
         GROUP BY format_id) t
 WHERE t.format_id = f.id;

UPDATE recipe_formats
   SET quantite_par_format = 1621, updated_at = NOW()
 WHERE id = 'fab28400-0000-4000-8000-000000000262';   -- 3x140 + 2x158 + 6x48 + 4x92 + 3x76

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Miroir recipe_components = nomenclature du format PAR DEFAUT
--     (mig 205/218). v_recipe_total_cost passe par ce miroir pour les recettes
--     composees : sans lui, les 22 fiches couteraient 0 pour tout parent —
--     a commencer par le mini plateau, qui consomme cinq d'entre elles.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM recipe_components
 WHERE recipe_id::text LIKE 'fab28400-0000-4000-8000-0000000001%';

INSERT INTO recipe_components (recipe_id, role, source_recipe_id, source_ingredient_id,
                               quantite, unite, perte_pct, ordre)
SELECT f.recipe_id, c.role, c.source_recipe_id, c.source_ingredient_id,
       c.quantite, c.unite, c.perte_pct, c.ordre
FROM recipe_formats f
JOIN recipe_format_components c ON c.format_id = f.id
WHERE f.is_default AND f.id::text LIKE 'fab28400%';

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Etapes de production des 4 fiches phares.
--     Ce sont les gestes qui ne se devinent pas : le feuilletage a l'huile du
--     msemen, le montage en spirale de la pastilla, le blind-baking du fond de
--     quiche, la maturation de la pate a pizza. Pas de champs arabes : le chef
--     ecrira sa darija lui-meme (convention).
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Pétrissage et boulage","duree_estimee_min":25,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Farine + semoule fine : la semoule donne le croustillant, la farine l''élasticité",
     "Pétrir 15 min jusqu''au test de la vitre : la pâte doit s''étirer sans se déchirer",
     "Bouler à 60 g (mini) ou 130 g (grand), huiler chaque boule au pinceau",
     "Repos 30 min minimum sous film — une pâte non reposée ne s''étirera jamais en feuille"]},
  {"ordre":2,"nom":"Étirage et feuilletage à l''huile","duree_estimee_min":30,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":true,"nb_repetitions":40,"responsable_role":null,
   "checklist_items":[
     "Plan de travail HUILÉ, jamais fariné : la farine bloque l''étirage",
     "Étaler à la main du centre vers l''extérieur jusqu''à voir le plan à travers la pâte",
     "Beurre de tourage étalé à la main sur toute la surface + pincée de semoule",
     "Garniture (khlii, olive, fromage) répartie SANS toucher les bords",
     "Rabattre en 3 puis en 3 : carré de 12 cm, 9 épaisseurs",
     "Point de contrôle : un trou dans la feuille = beurre qui fuit à la cuisson, refaire la pièce"]},
  {"ordre":3,"nom":"Cuisson plancha","duree_estimee_min":20,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":true,"nb_repetitions":40,"responsable_role":null,
   "checklist_items":[
     "Plancha à 180 °C, à peine graissée",
     "Aplatir le carré à la main sur la plancha, pas au rouleau",
     "3 min par face, retourner deux fois : doré tacheté, jamais uniformément brun",
     "Presser à la spatule en fin de cuisson pour souder les feuilles",
     "Refroidir sur grille : empilés chauds, ils se collent"]},
  {"ordre":4,"nom":"Conditionnement","duree_estimee_min":15,"est_bloquante":false,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Pièces refroidies à cœur avant ensachage (sinon condensation = pâte molle)",
     "Sachets de 4 pour les minis, papier intercalaire",
     "Étiquetage DLC : J+1 ambiant, J+3 à +4 °C"]}
]'::jsonb, updated_at = NOW()
WHERE id = 'fab28400-0000-4000-8000-000000000130';

UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Cuisson de la farce","duree_estimee_min":60,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Oignons fondus 40 min à couvert, à feu doux, sans coloration",
     "Poulet poché dans le jus puis effiloché À LA MAIN — le robot en fait de la pâte",
     "Épices ajoutées sur le gras, pas dans l''eau : cannelle, gingembre, curcuma",
     "Œufs battus versés hors du feu, brouillés à la chaleur résiduelle",
     "Point de contrôle : la farce doit être SÈCHE, aucun jus au fond du bac"]},
  {"ordre":2,"nom":"Refroidissement rapide","duree_estimee_min":90,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Cellule de refroidissement : +63 °C à +10 °C en moins de 2 h (obligation HACCP)",
     "Étaler en bacs de 4 cm maximum",
     "Farce à +4 °C avant montage : une farce tiède détrempe la feuille en 10 min"]},
  {"ordre":3,"nom":"Montage en spirale","duree_estimee_min":45,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":true,"nb_repetitions":20,"responsable_role":null,
   "checklist_items":[
     "Feuilles beurrées au pinceau, en rosace débordante autour du cercle",
     "Farce + amandes concassées au centre, dôme régulier",
     "Rabattre les feuilles en spirale, une par une, en tournant le moule",
     "2 feuilles entières dessous pour tenir le fond",
     "Souder au beurre fondu : une pastilla qui s''ouvre à la cuisson est perdue"]},
  {"ordre":4,"nom":"Cuisson et finition","duree_estimee_min":30,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "180 °C chaleur tournante, 20 min pour l''individuelle, 35 min pour la 8 personnes",
     "Retourner à mi-cuisson pour dorer le dessous",
     "Sucre glace + cannelle en croisillons sur pastilla TIÈDE, jamais brûlante",
     "Servir dans les 30 min : la feuille ramollit ensuite"]}
]'::jsonb, updated_at = NOW()
WHERE id = 'fab28400-0000-4000-8000-000000000136';

UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Fonçage","duree_estimee_min":30,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Pâte brisée sortie 15 min avant : trop froide elle casse, trop chaude elle colle",
     "Abaisse à 2,5 mm régulière, foncer sans étirer (une pâte étirée rétracte à la cuisson)",
     "Piquer le fond à la fourchette",
     "Repos 30 min au froid AVANT cuisson : c''est ce repos qui empêche les bords de tomber"]},
  {"ordre":2,"nom":"Cuisson à blanc","duree_estimee_min":20,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Papier cuisson + billes ou légumes secs jusqu''en haut des bords",
     "170 °C pendant 15 min, retirer les billes, 5 min de plus pour sécher le fond",
     "Fond BLOND et sec au toucher : un fond pâle donnera une quiche détrempée",
     "Chablonner au blanc d''œuf si la garniture est très humide (épinards, champignons)"]},
  {"ordre":3,"nom":"Garnissage et appareil","duree_estimee_min":20,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":true,"nb_repetitions":15,"responsable_role":null,
   "checklist_items":[
     "Garniture ÉGOUTTÉE et froide, répartie à plat",
     "Champignons et épinards préalablement sués et pressés : ils rendent 60 % de leur poids",
     "Migaine versée jusqu''à 3 mm du bord, elle gonfle à la cuisson",
     "Fromage râpé en dernier, sur le dessus"]},
  {"ordre":4,"nom":"Cuisson finale","duree_estimee_min":30,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "160 °C, 22 min pour les individuelles, 35 min pour la Ø28",
     "Cuisson douce : au-delà de 170 °C l''appareil bout et devient granuleux",
     "Contrôle : l''appareil doit trembler au centre, pas être liquide",
     "Démouler tiède, refroidir sur grille"]}
]'::jsonb, updated_at = NOW()
WHERE id = 'fab28400-0000-4000-8000-000000000140';

UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Pétrissage et maturation","duree_estimee_min":25,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Hydratation 62 %, pétrissage 10 min, température de pâte 24 °C",
     "Huile d''olive incorporée en fin de pétrissage seulement",
     "Pointage 24 h à +4 °C : c''est la maturation qui fait l''alvéolage et la digestibilité",
     "Bouler à 175 g et remettre en pousse 2 h à température ambiante avant façonnage"]},
  {"ordre":2,"nom":"Façonnage","duree_estimee_min":20,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":true,"nb_repetitions":12,"responsable_role":null,
   "checklist_items":[
     "Étaler à la main en poussant le gaz vers le bord — jamais au rouleau (il écrase les alvéoles)",
     "Bord laissé épais de 1,5 cm",
     "Plaque perforée légèrement huilée, 12 pièces par plaque 60x40"]},
  {"ordre":3,"nom":"Garnissage","duree_estimee_min":15,"est_bloquante":false,"timer_auto":false,
   "controle_qualite":true,"est_repetable":true,"nb_repetitions":12,"responsable_role":null,
   "checklist_items":[
     "Sauce en spirale au dos de la louche, 32 g, sans toucher le bord",
     "Fromage puis garniture, jamais l''inverse : la garniture brûlerait",
     "Filet d''huile d''olive juste avant d''enfourner",
     "Sauce trop liquide = pâte détrempée : réduire davantage la prochaine fournée"]},
  {"ordre":4,"nom":"Cuisson","duree_estimee_min":10,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Sole à 280 °C, 6 à 8 min",
     "Contrôle : dessous doré et sec, bord boursouflé et taché",
     "Sortie sur grille, jamais sur plaque : la vapeur ramollirait le fond",
     "Découpe et service immédiats"]}
]'::jsonb, updated_at = NOW()
WHERE id = 'fab28400-0000-4000-8000-000000000141';
