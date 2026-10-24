-- Migration 272 : Referentiel des contenants de laboratoire (89 formats)
--
-- POURQUOI
--   production_contenants ne contient que 4 lignes saisies a la main ("Cadre
--   37x57cm", "Cadre 40*60 cm", "Moule 300", "Moule 600 g"), sans dimensions
--   ni type de decoupe — le seed d'origine (mig 082) a ete supprime. Resultat :
--   impossible de creer un format sur un cercle a tartelette, une plaque a
--   madeleines ou un cadre insert, alors que c'est le materiel du labo.
--
--   Cette migration injecte le referentiel materiel complet fourni par le chef :
--     9  cadres          (inserts 1/1,5/2 cm, opera, entremets, haut, bandes)
--     13 cercles a tarte (Ø12 a Ø32, carre, ovale, flan)
--     9  cercles entremets / vacherin
--     9  cercles a tartelette (Ø5 a Ø10, carre, ovale, bateau)
--     13 moules          (cake, kouglof, savarin, charlotte, pain de mie, brioche)
--     4  filets de cuisson boulangerie
--     12 plaques et tapis 60x40
--     20 plaques a empreintes (muffins, financiers, madeleines, demi-spheres,
--                             canneles, savarins, cylindres, palets...)
--
--   Les colonnes nom/type_production/unite_lancement/quantite_theorique/
--   pertes_fixes/seuil_rendement_defaut viennent telles quelles du CSV source.
--   Trois informations sont DEDUITES et ajoutees ici :
--
--     - nom lisible : le CSV nomme en slug (Cadre_60x40x4_5cm_Entremets). Le
--       referentiel etant affiche tel quel dans l'UI Formats de production, on
--       stocke la forme francaise (« Cadre entremets 60x40x4,5 cm »).
--     - dimensions (mig 167) : longueur/largeur/profondeur/diametre quand le nom
--       porte les dimensions DU CONTENANT. Pour les plaques a empreintes, le
--       nombre du nom est un nombre de CAVITES, pas une dimension : les colonnes
--       restent NULL et le compte va dans quantite_theorique.
--     - type_decoupe : un cadre rectangulaire qui rend plusieurs pieces se
--       decoupe (damier ; bande pour les cadres 60x10 et 60x15 qui se coupent en
--       barres). Tout le reste produit directement la piece finale
--       (sans_decoupe). nb_pieces_decoupe = quantite_theorique.
--
-- PORTEE
--   INSERT seul, idempotent (NOT EXISTS sur le nom). Aucune ligne existante
--   modifiee ni supprimee, aucun format de recette / cout / plan impacte.
--
--   NB : « Cadre entremets 60x40x4,5 cm » recouvre physiquement l'ancien
--   « Cadre 40*60 cm » (saisi sans epaisseur, 50 pieces au lieu de 70), sur
--   lequel des formats de recette pointent deja. Les deux coexistent : la
--   bascule des formats puis la desactivation de l'ancien se font depuis l'UI
--   Formats de production, pas ici (ON DELETE RESTRICT sur recipe_formats).
--
--   etapes_defaut et categories_pertes restent vides, comme les contenants
--   existants : le CSV source ne les fournit pas, ils se saisissent depuis l'UI.
--
-- INVERSION
--   DELETE FROM production_contenants
--    WHERE created_at >= '<date d''application>' AND nom NOT IN (
--      'Cadre 37x57cm', 'Cadre 40*60 cm', 'Moule 300', 'Moule 600 g');
--   (echoue sur toute ligne a laquelle un format a ete raccroche entre-temps :
--    ON DELETE RESTRICT — c'est voulu.)

INSERT INTO production_contenants (
  nom, type_production, unite_lancement,
  quantite_theorique, pertes_fixes, seuil_rendement_defaut,
  longueur_cm, largeur_cm, profondeur_cm, diametre_cm,
  type_decoupe, nb_pieces_decoupe
)
SELECT v.nom, v.type_production, v.unite_lancement,
       v.quantite_theorique, v.pertes_fixes, v.seuil_rendement_defaut,
       v.longueur_cm, v.largeur_cm, v.profondeur_cm, v.diametre_cm,
       v.type_decoupe, v.nb_pieces_decoupe
FROM (VALUES
  ('Cadre insert 60x40x1 cm', 2, 'cadre', 1.00, 0.00, 95.00, 60, 40, 1, NULL::numeric, 'sans_decoupe', 1),
  ('Cadre insert 60x40x1,5 cm', 2, 'cadre', 1.00, 0.00, 95.00, 60, 40, 1.5, NULL, 'sans_decoupe', 1),
  ('Cadre insert 60x40x2 cm', 2, 'cadre', 1.00, 0.00, 95.00, 60, 40, 2, NULL, 'sans_decoupe', 1),
  ('Cadre opéra 60x40x3 cm', 2, 'cadre', 70.00, 2.00, 90.00, 60, 40, 3, NULL, 'damier', 70),
  ('Cadre entremets 60x40x4,5 cm', 2, 'cadre', 70.00, 2.00, 90.00, 60, 40, 4.5, NULL, 'damier', 70),
  ('Cadre haut 60x40x6 cm', 2, 'cadre', 70.00, 2.00, 90.00, 60, 40, 6, NULL, 'damier', 70),
  ('Cadre demi 40x30x4,5 cm', 2, 'cadre', 32.00, 1.00, 90.00, 40, 30, 4.5, NULL, 'damier', 32),
  ('Cadre bande 60x10x4,5 cm', 2, 'cadre', 12.00, 0.00, 90.00, 60, 10, 4.5, NULL, 'bande', 12),
  ('Cadre bande 60x15x4,5 cm', 2, 'cadre', 18.00, 0.00, 90.00, 60, 15, 4.5, NULL, 'bande', 18),
  ('Cercle à tarte Ø12 cm', 1, 'cercle', 1.00, 0.00, 95.00, NULL, NULL, NULL, 12, 'sans_decoupe', 1),
  ('Cercle à tarte Ø14 cm', 1, 'cercle', 1.00, 0.00, 95.00, NULL, NULL, NULL, 14, 'sans_decoupe', 1),
  ('Cercle à tarte Ø16 cm', 1, 'cercle', 1.00, 0.00, 95.00, NULL, NULL, NULL, 16, 'sans_decoupe', 1),
  ('Cercle à tarte Ø18 cm', 1, 'cercle', 1.00, 0.00, 95.00, NULL, NULL, NULL, 18, 'sans_decoupe', 1),
  ('Cercle à tarte Ø20 cm', 1, 'cercle', 1.00, 0.00, 95.00, NULL, NULL, NULL, 20, 'sans_decoupe', 1),
  ('Cercle à tarte Ø22 cm', 1, 'cercle', 1.00, 0.00, 95.00, NULL, NULL, NULL, 22, 'sans_decoupe', 1),
  ('Cercle à tarte Ø24 cm', 1, 'cercle', 1.00, 0.00, 95.00, NULL, NULL, NULL, 24, 'sans_decoupe', 1),
  ('Cercle à tarte Ø26 cm', 1, 'cercle', 1.00, 0.00, 95.00, NULL, NULL, NULL, 26, 'sans_decoupe', 1),
  ('Cercle à tarte Ø28 cm', 1, 'cercle', 1.00, 0.00, 95.00, NULL, NULL, NULL, 28, 'sans_decoupe', 1),
  ('Cercle à tarte Ø32 cm', 1, 'cercle', 1.00, 0.00, 95.00, NULL, NULL, NULL, 32, 'sans_decoupe', 1),
  ('Cercle à tarte carré 20x20 cm', 1, 'cercle', 1.00, 0.00, 95.00, 20, 20, NULL, NULL, 'sans_decoupe', 1),
  ('Cercle à tarte ovale 25 cm', 1, 'cercle', 1.00, 0.00, 95.00, 25, NULL, NULL, NULL, 'sans_decoupe', 1),
  ('Cercle à flan Ø28 x 5 cm', 1, 'cercle', 1.00, 0.00, 95.00, NULL, NULL, 5, 28, 'sans_decoupe', 1),
  ('Cercle à entremets Ø14 x 4,5 cm', 2, 'cercle', 1.00, 0.00, 95.00, NULL, NULL, 4.5, 14, 'sans_decoupe', 1),
  ('Cercle à entremets Ø16 x 4,5 cm', 2, 'cercle', 1.00, 0.00, 95.00, NULL, NULL, 4.5, 16, 'sans_decoupe', 1),
  ('Cercle à entremets Ø18 x 4,5 cm', 2, 'cercle', 1.00, 0.00, 95.00, NULL, NULL, 4.5, 18, 'sans_decoupe', 1),
  ('Cercle à entremets Ø20 x 4,5 cm', 2, 'cercle', 1.00, 0.00, 95.00, NULL, NULL, 4.5, 20, 'sans_decoupe', 1),
  ('Cercle à entremets Ø22 x 4,5 cm', 2, 'cercle', 1.00, 0.00, 95.00, NULL, NULL, 4.5, 22, 'sans_decoupe', 1),
  ('Cercle à entremets Ø24 x 4,5 cm', 2, 'cercle', 1.00, 0.00, 95.00, NULL, NULL, 4.5, 24, 'sans_decoupe', 1),
  ('Cercle à entremets haut Ø18 x 6 cm', 2, 'cercle', 1.00, 0.00, 95.00, NULL, NULL, 6, 18, 'sans_decoupe', 1),
  ('Cercle à entremets haut Ø20 x 6 cm', 2, 'cercle', 1.00, 0.00, 95.00, NULL, NULL, 6, 20, 'sans_decoupe', 1),
  ('Cercle à vacherin Ø20 x 6 cm', 2, 'cercle', 1.00, 0.00, 95.00, NULL, NULL, 6, 20, 'sans_decoupe', 1),
  ('Cercle à tartelette Ø5 cm', 3, 'cercle', 1.00, 0.00, 95.00, NULL, NULL, NULL, 5, 'sans_decoupe', 1),
  ('Cercle à tartelette Ø6 cm', 3, 'cercle', 1.00, 0.00, 95.00, NULL, NULL, NULL, 6, 'sans_decoupe', 1),
  ('Cercle à tartelette Ø7 cm', 3, 'cercle', 1.00, 0.00, 95.00, NULL, NULL, NULL, 7, 'sans_decoupe', 1),
  ('Cercle à tartelette Ø8 cm', 3, 'cercle', 1.00, 0.00, 95.00, NULL, NULL, NULL, 8, 'sans_decoupe', 1),
  ('Cercle à tartelette Ø9 cm', 3, 'cercle', 1.00, 0.00, 95.00, NULL, NULL, NULL, 9, 'sans_decoupe', 1),
  ('Cercle à tartelette Ø10 cm', 3, 'cercle', 1.00, 0.00, 95.00, NULL, NULL, NULL, 10, 'sans_decoupe', 1),
  ('Cercle à tartelette carré 8x8 cm', 3, 'cercle', 1.00, 0.00, 95.00, 8, 8, NULL, NULL, 'sans_decoupe', 1),
  ('Cercle à tartelette ovale 10 cm', 3, 'cercle', 1.00, 0.00, 95.00, 10, NULL, NULL, NULL, 'sans_decoupe', 1),
  ('Cercle à tartelette bateau 10 cm', 3, 'cercle', 1.00, 0.00, 95.00, 10, NULL, NULL, NULL, 'sans_decoupe', 1),
  ('Moule à cake 15 cm', 1, 'moule', 1.00, 0.00, 95.00, 15, NULL, NULL, NULL, 'sans_decoupe', 1),
  ('Moule à cake 20 cm', 1, 'moule', 1.00, 0.00, 95.00, 20, NULL, NULL, NULL, 'sans_decoupe', 1),
  ('Moule à cake 25 cm', 1, 'moule', 1.00, 0.00, 95.00, 25, NULL, NULL, NULL, 'sans_decoupe', 1),
  ('Moule à cake 30 cm', 1, 'moule', 1.00, 0.00, 95.00, 30, NULL, NULL, NULL, 'sans_decoupe', 1),
  ('Moule à cake slim 30 cm', 1, 'moule', 1.00, 0.00, 95.00, 30, NULL, NULL, NULL, 'sans_decoupe', 1),
  ('Moule à cake individuel 8 cm', 3, 'moule', 1.00, 0.00, 95.00, 8, NULL, NULL, NULL, 'sans_decoupe', 1),
  ('Moule à kouglof Ø20 cm', 1, 'moule', 1.00, 0.00, 95.00, NULL, NULL, NULL, 20, 'sans_decoupe', 1),
  ('Moule à savarin couronne Ø24 cm', 1, 'moule', 1.00, 0.00, 95.00, NULL, NULL, NULL, 24, 'sans_decoupe', 1),
  ('Moule à charlotte Ø18 cm', 1, 'moule', 1.00, 0.00, 95.00, NULL, NULL, NULL, 18, 'sans_decoupe', 1),
  ('Moule à pain de mie 500 g', 4, 'moule', 1.00, 0.00, 95.00, NULL, NULL, NULL, NULL, 'sans_decoupe', 1),
  ('Moule à pain de mie 1000 g', 4, 'moule', 1.00, 0.00, 95.00, NULL, NULL, NULL, NULL, 'sans_decoupe', 1),
  ('Moule à brioche Nanterre', 4, 'moule', 1.00, 0.00, 95.00, NULL, NULL, NULL, NULL, 'sans_decoupe', 1),
  ('Moule à brioche à tête Ø10 cm', 3, 'moule', 1.00, 0.00, 95.00, NULL, NULL, NULL, 10, 'sans_decoupe', 1),
  ('Filet de cuisson baguettes (5)', 4, 'fournee', 5.00, 0.00, 95.00, NULL, NULL, NULL, NULL, 'sans_decoupe', 5),
  ('Filet de cuisson mini-baguettes (10)', 4, 'fournee', 10.00, 0.00, 95.00, NULL, NULL, NULL, NULL, 'sans_decoupe', 10),
  ('Filet de cuisson pains sandwich (6)', 4, 'fournee', 6.00, 0.00, 95.00, NULL, NULL, NULL, NULL, 'sans_decoupe', 6),
  ('Filet de cuisson pains hot-dog (8)', 4, 'fournee', 8.00, 0.00, 95.00, NULL, NULL, NULL, NULL, 'sans_decoupe', 8),
  ('Plaque 60x40 viennoiseries (12)', 5, 'fournee', 12.00, 0.00, 95.00, 60, 40, NULL, NULL, 'sans_decoupe', 12),
  ('Plaque 60x40 viennoiseries (15)', 5, 'fournee', 15.00, 0.00, 95.00, 60, 40, NULL, NULL, 'sans_decoupe', 15),
  ('Plaque 60x40 viennoiseries (18)', 5, 'fournee', 18.00, 0.00, 95.00, 60, 40, NULL, NULL, 'sans_decoupe', 18),
  ('Plaque 60x40 viennoiseries (20)', 5, 'fournee', 20.00, 0.00, 95.00, 60, 40, NULL, NULL, 'sans_decoupe', 20),
  ('Plaque 60x40 mini-viennoiseries (40)', 5, 'fournee', 40.00, 0.00, 95.00, 60, 40, NULL, NULL, 'sans_decoupe', 40),
  ('Plaque 60x40 chouquettes (60)', 5, 'fournee', 60.00, 0.00, 95.00, 60, 40, NULL, NULL, 'sans_decoupe', 60),
  ('Plaque de cuisson plate 60x40', 5, 'fournee', 60.00, 0.00, 95.00, 60, 40, NULL, NULL, 'sans_decoupe', 60),
  ('Plaque de cuisson plate 40x30', 5, 'fournee', 30.00, 0.00, 95.00, 40, 30, NULL, NULL, 'sans_decoupe', 30),
  ('Plaque perforée 60x40', 5, 'fournee', 60.00, 0.00, 95.00, 60, 40, NULL, NULL, 'sans_decoupe', 60),
  ('Plaque à rebord 60x40x2 cm', 5, 'fournee', 1.00, 0.00, 95.00, 60, 40, 2, NULL, 'sans_decoupe', 1),
  ('Tapis silicone à rebord 60x40 cm', 5, 'fournee', 1.00, 0.00, 95.00, 60, 40, NULL, NULL, 'sans_decoupe', 1),
  ('Tapis silicone macarons 60x40 (70)', 5, 'fournee', 70.00, 0.00, 95.00, 60, 40, NULL, NULL, 'sans_decoupe', 70),
  ('Plaque à muffins gros (12)', 3, 'fournee', 12.00, 0.00, 95.00, NULL, NULL, NULL, NULL, 'sans_decoupe', 12),
  ('Plaque à muffins standard (24)', 3, 'fournee', 24.00, 0.00, 95.00, NULL, NULL, NULL, NULL, 'sans_decoupe', 24),
  ('Plaque à mini-muffins (48)', 3, 'fournee', 48.00, 0.00, 95.00, NULL, NULL, NULL, NULL, 'sans_decoupe', 48),
  ('Plaque à financiers (40)', 3, 'fournee', 40.00, 0.00, 95.00, NULL, NULL, NULL, NULL, 'sans_decoupe', 40),
  ('Plaque à mini-financiers (84)', 3, 'fournee', 84.00, 0.00, 95.00, NULL, NULL, NULL, NULL, 'sans_decoupe', 84),
  ('Plaque à madeleines (40)', 3, 'fournee', 40.00, 0.00, 95.00, NULL, NULL, NULL, NULL, 'sans_decoupe', 40),
  ('Plaque à mini-madeleines (84)', 3, 'fournee', 84.00, 0.00, 95.00, NULL, NULL, NULL, NULL, 'sans_decoupe', 84),
  ('Plaque demi-sphères Ø8 cm (15)', 3, 'fournee', 15.00, 0.00, 95.00, NULL, NULL, NULL, NULL, 'sans_decoupe', 15),
  ('Plaque demi-sphères Ø7 cm (24)', 3, 'fournee', 24.00, 0.00, 95.00, NULL, NULL, NULL, NULL, 'sans_decoupe', 24),
  ('Plaque demi-sphères Ø4 cm (40)', 3, 'fournee', 40.00, 0.00, 95.00, NULL, NULL, NULL, NULL, 'sans_decoupe', 40),
  ('Plaque à cannelés standard (18)', 3, 'fournee', 18.00, 0.00, 95.00, NULL, NULL, NULL, NULL, 'sans_decoupe', 18),
  ('Plaque à mini-cannelés (54)', 3, 'fournee', 54.00, 0.00, 95.00, NULL, NULL, NULL, NULL, 'sans_decoupe', 54),
  ('Plaque à savarins individuels (15)', 3, 'fournee', 15.00, 0.00, 95.00, NULL, NULL, NULL, NULL, 'sans_decoupe', 15),
  ('Plaque à cylindres individuels (12)', 3, 'fournee', 12.00, 0.00, 95.00, NULL, NULL, NULL, NULL, 'sans_decoupe', 12),
  ('Plaque à palets ronds (15)', 3, 'fournee', 15.00, 0.00, 95.00, NULL, NULL, NULL, NULL, 'sans_decoupe', 15),
  ('Plaque à quenelles (12)', 3, 'fournee', 12.00, 0.00, 95.00, NULL, NULL, NULL, NULL, 'sans_decoupe', 12),
  ('Plaque à cubes (15)', 3, 'fournee', 15.00, 0.00, 95.00, NULL, NULL, NULL, NULL, 'sans_decoupe', 15),
  ('Plaque à cœurs individuels (8)', 3, 'fournee', 8.00, 0.00, 95.00, NULL, NULL, NULL, NULL, 'sans_decoupe', 8),
  ('Plaque à dômes spirale (6)', 3, 'fournee', 6.00, 0.00, 95.00, NULL, NULL, NULL, NULL, 'sans_decoupe', 6),
  ('Plaque à tartelettes silicone (15)', 3, 'fournee', 15.00, 0.00, 95.00, NULL, NULL, NULL, NULL, 'sans_decoupe', 15)
) AS v (nom, type_production, unite_lancement,
        quantite_theorique, pertes_fixes, seuil_rendement_defaut,
        longueur_cm, largeur_cm, profondeur_cm, diametre_cm,
        type_decoupe, nb_pieces_decoupe)
WHERE NOT EXISTS (
  SELECT 1 FROM production_contenants pc WHERE pc.nom = v.nom
);
