-- Pesage réel — étape 1 : tolérance de pesée et capture de la mesure
--
-- Contexte (audit pesage W2) : `actual_quantity` n'était jamais une mesure. Le bouton
-- "Tout conforme" recopiait `allocated_quantity` sur toutes les lignes, et startPrelevement
-- / verify complétaient le reste. Résultat en base : 0 écart sur toutes les lignes.
-- Le coût réel et le rendement se calculaient donc sur du théorique.
--
-- Cette migration pose le socle de la pesée réelle, AVANT l'arrivée de la balance
-- connectée : le magasinier saisit le poids, le système valide contre une bande de
-- tolérance, et tout écart hors bande exige un motif. Quand la balance sera branchée,
-- seule la SOURCE de la mesure changera (weighing_source passe de 'manual' à 'scale') ;
-- le modèle de données et les règles restent identiques.
--
-- Principe de la tolérance :
--   tolérance = MAX(pourcentage × cible, plancher absolu)
-- Le plancher absolu est indispensable : 1 % de 20 g de levure = 0,2 g, ce qu'aucune
-- balance de labo ne mesure. La bande est SYMÉTRIQUE (−tol / +tol) : une bande
-- uniquement positive pousserait l'opérateur à viser le haut et intégrerait une
-- surconsommation systématique dans tous les coûts.

-- ─── 1. Défauts de tolérance par catégorie d'ingrédient ───────────────────
-- tolerance_abs_sub est exprimé dans la SOUS-unité (g pour les masses, ml pour les
-- volumes) : c'est l'échelle à laquelle on raisonne un plancher. La conversion vers
-- l'unité réelle de la ligne est faite par fn_weighing_tolerance.
CREATE TABLE IF NOT EXISTS weighing_tolerance_defaults (
  category          text PRIMARY KEY,
  tolerance_pct     numeric(5,2) NOT NULL CHECK (tolerance_pct >= 0 AND tolerance_pct <= 100),
  tolerance_abs_sub numeric(12,4) NOT NULL CHECK (tolerance_abs_sub >= 0),
  notes             text,
  updated_at        timestamptz NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE weighing_tolerance_defaults IS
  'Tolerance de pesee par categorie d''ingredient (ingredients.category). La ligne category=''*'' est le defaut global.';
COMMENT ON COLUMN weighing_tolerance_defaults.tolerance_abs_sub IS
  'Plancher absolu en sous-unite (g pour les masses, ml pour les volumes). Prime sur le pourcentage sur les petites cibles.';

INSERT INTO weighing_tolerance_defaults (category, tolerance_pct, tolerance_abs_sub, notes) VALUES
  ('*',                      1.00, 2.0000, 'Defaut global'),
  ('colorants',              2.00, 0.5000, 'Doses minuscules : le plancher gouverne'),
  ('gelifiants',             2.00, 0.5000, 'Doses minuscules : le plancher gouverne'),
  ('epices',                 1.50, 1.0000, 'Impact gout fort a faible dose'),
  ('sel_vinaigre',           1.50, 1.0000, 'Impact gout et fermentation'),
  ('levures',                1.50, 1.0000, 'Impact fermentation : precision requise'),
  ('farines',                1.00, 5.0000, 'Gros volumes, verse a la main'),
  ('sucres',                 1.00, 5.0000, 'Gros volumes, verse a la main'),
  ('beurre',                 1.00, 2.0000, NULL),
  ('matieres_grasses',       1.00, 2.0000, NULL),
  ('produits_laitiers',      1.00, 2.0000, NULL),
  ('lait',                   1.00, 2.0000, NULL),
  ('cremes',                 1.00, 2.0000, NULL),
  ('oeufs',                  1.00, 2.0000, NULL),
  ('chocolat',               1.00, 2.0000, NULL),
  ('fruits',                 2.00, 5.0000, 'Produit frais : calibre irregulier'),
  ('legumes',                2.00, 5.0000, 'Produit frais : calibre irregulier'),
  ('viandes',                2.00, 5.0000, 'Decoupe : calibre irregulier'),
  ('poissons_fruits_de_mer', 2.00, 5.0000, 'Decoupe : calibre irregulier'),
  ('fromages',               2.00, 5.0000, 'Decoupe : calibre irregulier'),
  ('fruits_secs',            2.00, 5.0000, NULL),
  ('decors',                 2.00, 5.0000, NULL),
  ('preparations',           2.00, 5.0000, NULL),
  ('conserves',              2.00, 5.0000, NULL),
  ('sauces',                 2.00, 5.0000, NULL),
  ('pates_riz',              2.00, 5.0000, NULL),
  ('autre',                  1.00, 2.0000, 'Categorie fourre-tout : defaut global')
ON CONFLICT (category) DO NOTHING;

-- ─── 2. Override par ingrédient ───────────────────────────────────────────
-- Renseigner l'un OU l'autre : la partie non renseignée retombe sur le défaut
-- de catégorie. Permet de serrer un ingrédient précis sans toucher sa famille.
ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS weighing_tolerance_pct numeric(5,2)
    CHECK (weighing_tolerance_pct IS NULL OR (weighing_tolerance_pct >= 0 AND weighing_tolerance_pct <= 100)),
  ADD COLUMN IF NOT EXISTS weighing_tolerance_abs numeric(12,4)
    CHECK (weighing_tolerance_abs IS NULL OR weighing_tolerance_abs >= 0);

COMMENT ON COLUMN ingredients.weighing_tolerance_pct IS
  'Override du pourcentage de tolerance de pesee. NULL = defaut de la categorie.';
COMMENT ON COLUMN ingredients.weighing_tolerance_abs IS
  'Override du plancher absolu de tolerance, EXPRIME DANS L''UNITE DE BASE de l''ingredient (pas en sous-unite). NULL = defaut de la categorie.';

-- ─── 3. Capture de la mesure sur la ligne BSI ─────────────────────────────
ALTER TABLE production_bons_sortie_lignes
  ADD COLUMN IF NOT EXISTS tare_quantity     numeric(12,4),
  ADD COLUMN IF NOT EXISTS weighed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS weighed_by        uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS weighing_source   text
    CHECK (weighing_source IN ('manual', 'scale', 'auto')),
  ADD COLUMN IF NOT EXISTS tolerance_applied numeric(12,4),
  ADD COLUMN IF NOT EXISTS ecart_reason      text;

COMMENT ON COLUMN production_bons_sortie_lignes.tare_quantity IS
  'Poids du contenant vide au moment de la pesee (bac, seau). Informatif tant que la balance n''est pas connectee.';
COMMENT ON COLUMN production_bons_sortie_lignes.weighing_source IS
  'manual = poids saisi par le magasinier ; scale = lu sur la balance connectee ; auto = complete par le systeme (verify/startPrelevement), donc NON MESURE — a exclure des analyses d''ecart.';
COMMENT ON COLUMN production_bons_sortie_lignes.tolerance_applied IS
  'Tolerance absolue retenue au moment de la pesee, dans l''unite de la ligne. Figee pour l''audit : changer le referentiel ne doit pas reecrire l''histoire.';
COMMENT ON COLUMN production_bons_sortie_lignes.ecart_reason IS
  'Motif obligatoire quand |actual - allocated| depasse la tolerance.';

-- Les lignes existantes n'ont jamais été pesées : on le dit explicitement plutôt que
-- de laisser croire que leur actual_quantity est une mesure.
UPDATE production_bons_sortie_lignes
   SET weighing_source = 'auto'
 WHERE actual_quantity IS NOT NULL
   AND weighing_source IS NULL;

CREATE INDEX IF NOT EXISTS idx_bsi_lignes_weighed
  ON production_bons_sortie_lignes (weighed_at DESC)
  WHERE weighed_at IS NOT NULL;

-- ─── 4. Fonction de résolution de la tolérance ────────────────────────────
-- Source unique de vérité, appelée par la requête d'affichage des lignes ET par la
-- validation de la pesée : impossible que l'UI affiche une bande et que le serveur
-- en applique une autre.
--
-- Retourne la tolérance ABSOLUE, exprimée dans l'unité passée en paramètre
-- (= l'unité de la ligne BSI, qui est celle de l'ingrédient).
CREATE OR REPLACE FUNCTION fn_weighing_tolerance(
  p_ingredient_id uuid,
  p_target        numeric,
  p_unit          text
) RETURNS numeric AS $$
DECLARE
  v_unit      text;
  v_cat       text;
  v_pct       numeric;
  v_abs       numeric;
  v_def_pct   numeric;
  v_def_sub   numeric;
BEGIN
  IF p_target IS NULL OR p_target <= 0 THEN
    RETURN 0;
  END IF;

  v_unit := lower(COALESCE(p_unit, 'kg'));

  SELECT i.category, i.weighing_tolerance_pct, i.weighing_tolerance_abs
    INTO v_cat, v_pct, v_abs
    FROM ingredients i
   WHERE i.id = p_ingredient_id;

  -- Défaut de catégorie, avec repli sur la ligne '*'. ORDER BY place la catégorie
  -- exacte avant le joker.
  SELECT d.tolerance_pct, d.tolerance_abs_sub
    INTO v_def_pct, v_def_sub
    FROM weighing_tolerance_defaults d
   WHERE d.category = COALESCE(v_cat, '*') OR d.category = '*'
   ORDER BY (d.category <> '*') DESC
   LIMIT 1;

  v_pct := COALESCE(v_pct, v_def_pct, 1.0);

  IF v_abs IS NULL THEN
    -- Conversion du plancher (exprimé en g/ml) vers l'unité de la ligne.
    v_abs := CASE
      WHEN v_unit IN ('kg', 'l')  THEN COALESCE(v_def_sub, 2.0) / 1000.0
      WHEN v_unit IN ('g', 'ml')  THEN COALESCE(v_def_sub, 2.0)
      -- Unités comptables (pcs, paq, botte...) : un plancher au poids n'a pas de sens,
      -- la plus petite tolérance utile est l'unité elle-même.
      ELSE 1.0
    END;
  END IF;

  -- $N::numeric partout : GREATEST sur des littéraux non typés se fait inférer en
  -- integer par Postgres et casse sur les décimaux (piège déjà rencontré ailleurs).
  RETURN GREATEST(p_target * v_pct / 100.0::numeric, v_abs::numeric);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION fn_weighing_tolerance(uuid, numeric, text) IS
  'Tolerance de pesee absolue = MAX(pct x cible, plancher absolu), dans l''unite passee. Override ingredient > defaut categorie > defaut global.';
