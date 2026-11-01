# Audit critique des fiches techniques — réalité du fournil ⇄ rigueur du système

> **Date :** 2026-10-31 · **Source auditée :** base locale `ofauria_db` (migrations jusqu'à 406), **52 fiches actives** (34 bases, 16 produits, 2 doublons vides) — les 125 fiches archivées sont hors périmètre.
> **Méthode :** export complet (composants, formats, étapes, instructions), bilan massique et pourcentages du boulanger recalculés pour chaque pâte, procédés confrontés aux règles de l'art, structure BOM confrontée aux vues de coût du système (`v_recipe_explosion`, `perte_standard_pct`).
> **Convention Kalum vérifiée dans le code :** `yield_quantity` = **masse crue** (somme des entrées) ; le rendement **net** d'une sous-recette = `yield_quantity × (1 − perte_standard_pct)`. Un composant exprimé en grammes est donc une quantité **nette** consommée.
> **Avertissement :** la base de production peut différer (migrations 285-309 durcies au déploiement du 2026-10-24). Les anomalies de données sont à reconfirmer sur la prod avant correction.

---

## 0. Synthèse exécutive

**Ce qui est solide.** Les ratios des bases classiques sont justes au gramme près (Joconde, pâte sucrée, pâte à choux, crème pâtissière, feuilletage, baguette tradition) et les quatre fiches « masterclass » (Pâte levée feuilletée, Torsade, Opéra, Forêt Noire) sont d'un niveau professionnel : températures critiques, timings J-1/J, contrôles, défauts rédhibitoires. Le système sait exprimer ce qu'il faut (perte par base, poids cru/cuit par format, étapes typées avec température).

**Ce qui bloque.** Huit anomalies rendent les chiffres du système faux ou inexploitables en production :

| # | Anomalie | Impact | Fiches |
|---|---|---|---|
| 1 | **« Pâte levée feuilletée nature » est physiquement impossible** : 1 000 g de farine pour 250 ml de lait + 1 œuf (hydratation réelle ≈ 25 %, déclarée 52 %), entrées 2 035 g pour un rendement déclaré 2 400 g | Croissant, Pain au chocolat, Pain aux raisins sont costés sur une pâte qui n'existe pas ; doublon de la vraie base masterclass | 4 fiches |
| 2 | **Aucune freinte de cuisson au niveau produit** : `poids_cuit_g` NULL sur 16 formats / 16, `perte_standard_pct` = 0 sur 15 produits / 16 | Le poids vendu, le coût au gramme cuit et le rendement attendu sont inconnus du système ; le module Rendement n'a pas de référence | tous les produits |
| 3 | **Allergènes vides sur 100 % des ingrédients** (`allergens = {}`) alors que les fiches texte déclarent gluten, œufs, lait, soja, amandes | `v_product_allergens` renvoie vide → étiquetage impossible, risque réglementaire | toutes |
| 4 | **Doublons d'ingrédients à prix différents** : deux « Beurre » (57,00 vs 60,07 DH/kg), deux « Sucre semoule » (10,41 vs **5,42** DH/kg) | Le coût d'une fiche dépend du doublon pointé, pas de la recette | ≥ 20 fiches |
| 5 | **« Chocolat baton » coûte 6,60 DH la pièce** (le carton de 500 est à 147,50 DH → 0,30 DH/pièce) | Pain au chocolat : 24 bâtons = 158 DH de matière pour 12 pièces vendues 6 DH | Pain au chocolat |
| 6 | **Sous-recettes « en plaque » consommées en fraction de fournée** (0,83 plaque de Joconde, 0,74 plaque de génoise) | Le MRP planifie 0,83 plaque : impossible à cuire ; les 3 feuilles exigent une plaque entière | Opéra, Forêt Noire |
| 7 | **Température parasite** : l'étape « Beurre de tourage (test 90°) » porte `temperature_c = 90` (l'angle du test de pliage a été lu comme une température par la migration 342) | Consigne absurde (beurre à 90 °C) affichée au chef | Pâte levée feuilletée |
| 8 | **DLC produit ≠ DLC fiche** : Opéra 15 j en base vs 72 h sur la fiche ; Forêt Noire 3 j vs 48 h ; Torsade NULL vs 24 h | Le FEFO vitrine et les invendus travaillent sur de fausses durées de vie | 3 produits |

À cela s'ajoutent **38 fiches sur 52 sans aucune étape structurée** (toute la boulangerie et toutes les crèmes), un référentiel de **contenants sans catégorie de pertes** (`categories_pertes = []` sur les 50 contenants) et **4 fiches poubelle** à supprimer.

---

## 1. Anomalies transversales (système)

### 1.1 Convention de perte incohérente entre les bases
- Pâtes : `perte_standard_pct` = **chutes de détaillage** (feuilletée 5 %, sucrée 6 %, levée feuilletée 5 %) — correct, c'est la perte de la base.
- Mais **Pâte viennoise sucrée** déclare 12 % « = cuisson » et **Pâte à cake citron** 10 %, **Appareil à muffin** 10 % : la perte de cuisson est portée par la pâte alors qu'elle appartient au **produit cuit**. Si un jour le produit déclare aussi sa freinte, elle sera comptée deux fois.
- 🔧 **Règle à fixer :** base = pertes de fabrication de la base (chutes, parage, évaporation à la cuisson *de la base elle-même* : génoise, Joconde, choux pochés). Produit = freinte de cuisson/parage du produit via `poids_cru_g` → `poids_cuit_g`. Appliquer : muffin 10 % → sur le format (2 160 g cru → 1 945 g cuit), cake citron 10 % → format (500 → 450 g), viennoise 12 % → produits.

### 1.2 Rendement cru vs quantités nettes : à documenter sur l'écran
Le système applique `net = cru × (1 − perte)`. Les fiches masterclass l'ont compris (Opéra consomme 1 050 g **nets** de Joconde sur 1 262 g crus à 17 %). Les autres non : Mille-feuille consomme 1 680 g de crème pâtissière pour une fournée de 1 560 g crus (1 513 g nets) → **1,11 fournée**. Afficher sur l'éditeur de composition « fournée nette = X g » éviterait ces dépassements.

### 1.3 Fournées fractionnaires de sous-recettes « indivisibles »
Une plaque de génoise ou trois feuilles de Joconde ne se cuisent pas à 83 %. 🔧 Ajouter sur la recette de base un indicateur **« lot indivisible »** (ou `taille_lot_min` = rendement) : le MRP arrondit alors à la fournée entière et l'excédent va au stock de semi-finis (`semi_finished_lots`). En attendant : aligner les quantités sur la fournée entière (voir fiches).

### 1.4 Ingrédients en « pièce » sans masse
`Oeuf` (unit) et `Chocolat baton` (unit) n'ont pas de `poids_piece_kg`. Le bilan massique du Croissant ignore l'œuf de dorure, et le Pain au chocolat ne connaît pas la masse de ses bâtons (2 × 3,5 g). 🔧 Renseigner `poids_piece_kg` : œuf 0,055, bâton 0,0035. Pour la dorure, préférer la base « Dorure » (déjà existante) à l'œuf entier.

### 1.5 Étapes
- 14 fiches ont des étapes ; sur les quatre masterclass elles sont excellentes. Mais **Biscuit Joconde, Génoise cacao, Crème au beurre, Ganache, Chantilly, Punch** tiennent en **une seule étape de type `autre`** de 15 à 50 min avec toute la procédure en checklist : impossible de minuter la cuisson, de poser une consigne de température sur l'étape `cuisson` ni de déclencher un contrôle HACCP.
- **Toute la boulangerie** (pâtes à baguette, pain maison, pain complet, levain), **toutes les pâtes** (feuilletée, sucrée, choux, brioche, viennoise) et **toutes les crèmes** n'ont **aucune étape** : pas de pointage, d'apprêt, de cuisson ni de refroidissement rapide (CCP) dans le système, seulement une phrase dans `instructions`.
- `temperature_pate_cible_c` et `hydratation_pct` (colonnes prévues pour cela) sont NULL sur **toutes** les pâtes sauf la base « nature » fautive.
- 🔧 Découper les étapes `autre` en `petrissage` / `montage` / `cuisson` (avec `temperature_c`) / `refroidissement` ; créer les étapes manquantes (modèle en §3) ; renseigner T° pâte et hydratation sur les 9 pâtes.

### 1.6 Référentiel
- **Doublons** « Beurre » ×2 et « Sucre semoule » ×2 utilisés simultanément par des fiches actives, à prix différents (sucre : facteur 2). 🔧 Fusionner via l'outil de remplacement A→B (mig 401) puis archiver le doublon.
- **Chocolat baton** : 4 références (6,60 DH/pièce ; 0 DH ; 147,50 DH/carton de 500 ; 92,19 DH/kg). 🔧 Une seule référence en `unit` à ≈ 0,30 DH, `poids_piece_kg` 0,0035.
- **Allergènes** : 0 ingrédient renseigné. 🔧 Renseigner au minimum farine (gluten), beurre/lait/crème/mascarpone (lait), œufs (œuf), amande/noix (fruits à coque), sésame, chocolat et pâte à glacer (soja), glucose (aucun). Les vues 343 feront le reste.
- **Contenants** : `etapes_defaut` et `categories_pertes` vides sur les 50 contenants → le panneau Rendement ne propose aucune catégorie de perte. 🔧 Seeder `pertes_cuisson`, `pertes_demoulage`, `pertes_casse` sur les plaques/moules, `pertes_parage`, `pertes_decoupe` sur les cadres.
- **Deux « Sirop 30° »** à ratios différents (voir fiches) ; **deux « Croissant »** ; **« Recette Baguette Tradition »** (0,5 kg de farine Soisson, rien d'autre) ; **« SIMPate mvo3… » ×2** (résidus de simulation). 🔧 Supprimer / archiver.

### 1.7 DLC produit vs fiche
| Produit | Fiche | Base `products.shelf_life_days` / `display_life_hours` | 🔧 |
|---|---|---|---|
| Opéra | 72 h à +4 °C | **15 j** / 48 h | 3 j / 72 h |
| Forêt Noire | 48 h (crème foisonnée) | 3 j / 48 h | 2 j / 48 h |
| Torsade | 24 h vitrine | **NULL** / NULL | 1 j / 24 h |
| Éclair chocolat | — | 1 j / 12 h | OK (crème pâtissière) |

---

## 2. Audit fiche par fiche

### A. Boulangerie

#### Pâte à baguette courante (1 668 g)
- 🟢 Farine 1 000 / eau 620 / sel 18 / levure 20 / améliorant 10 → hydratation **62 %**, sel 1,8 %, levure 2 % : méthode directe standard, cohérente avec un pétrissage intensifié.
- 🔴 Aucune étape, pas de T° de pâte cible ni d'hydratation renseignée. Pas de catégorie de perte.
- 🔧 `hydratation_pct` 62, `temperature_pate_cible_c` 24. Étapes : frasage 4 min / pétrissage 2ᵉ vitesse 6-8 min (T° 23-25 °C) → pointage 45-60 min à 24 °C (1 rabat) → division/boulage → détente 20 min → façonnage → apprêt 60-75 min à 26 °C, 75 % HR → cuisson 240 °C buée 20-22 min → ressuage 20 min.

#### Pâte à baguette tradition (1 856 g)
- 🟢 Farine 1 000 / eau 680 / levain liquide 150 / levure 8 / sel 18, sans améliorant : hydratation effective **≈ 70 %**, levure 0,8 %, levain 15 % — conforme au décret « tradition » et aux règles de l'art.
- 🔴 Mêmes manques (étapes, T°, hydratation). Le levain liquide n'a pas de **chef** : la base « Levain liquide » est 500 eau + 500 farine sans ensemencement (voir plus bas).
- 🔧 `hydratation_pct` 70, T° 23. Étapes : autolyse 30 min → pétrissage lent 8-10 min → pointage **90-120 min** à 24 °C avec 2 rabats (ou 12-18 h à 4 °C en bac) → division 350 g → détente 25 min → façonnage → apprêt 60-90 min → cuisson 250 °C buée 22-24 min → ressuage.

#### Baguette normale (5 pièces) · Baguette tradition sésame (5 pièces)
- 🟢 Tradition : 1 750 g de pâte pour 5 = **350 g cru → ≈ 290 g cuit**, sésame 10 g/pièce, `poids_cru_g` 1 800 : cohérent.
- 🔴 Normale : 1 250 g pour **5** pièces (250 g cru) mais le format est « Filet de cuisson **mini-baguettes (10)** » avec `nb_par_defaut` 10 : soit 10 mini-baguettes de 125 g, soit 5 baguettes de 250 g, pas les deux. Vendue 1,50 DH, 250 g cru est trop pour ce prix ; la « normale » marocaine est plutôt 150-170 g cru. `perte_standard_pct` 5 % posée sur le **produit** sans `poids_cuit_g`.
- 🔴 Aucune des deux n'a `poids_cuit_g` : la freinte de cuisson d'une baguette est **18-22 %**.
- 🔧 Normale : trancher le format (10 × 125 g sur filet mini, ou 5 × 250 g sur filet (5)) ; `poids_cuit_g` = cru × 0,80. Tradition : `poids_cuit_g` 1 440 (−20 %). Étapes héritées de la pâte + cuisson.

#### Pâte de pain maison (1 888 g) · Pain maison (30 pièces)
- 🟢 Farine 800 + complète 200 / eau 660 / levain 200 / levure 10 / sel 18 : hydratation ≈ 69 %, levure 1 %, levain 20 % : pain de ménage au levain, équilibré.
- 🔴 Le produit consomme **9 000 g** de pâte (300 g/pièce) sur une fournée de 1 888 g → **4,77 fournées** par plan : la fiche base est un « kilo de farine » de test, pas la taille du pétrin. Pas de freinte (pain maison −12 à −15 %).
- 🔧 Dimensionner la base sur le pétrin réel (ex. 5 kg farine → 9 440 g, 1 fournée = 30 pains) ; `poids_cuit_g` 7 800 (−13 %). Étapes comme la tradition (pointage long au levain).

#### Pâte complète (1 748 g) · Pain complet (30 pièces)
- 🟢 Sel 1,8 %, levure 2 %, son 5 % : structure correcte.
- 🔴 Hydratation **65 %** pour 70 % de farine complète + son : le son et l'enveloppe absorbent plus, la pâte sera serrée, le pain dense. Produit : 7 500 g pour 30 = 250 g cru, **4,29 fournées**, pas de freinte.
- 🔧 Eau 700-720 g (hydratation 70-72 %) ; redimensionner la base au pétrin ; `poids_cuit_g` −14 %. Apprêt plus court que la blanche (45-60 min), cuisson 230 °C 25 min.

#### Levain liquide (1 000 g)
- 🟢 100 % d'hydratation : c'est bien un levain liquide.
- 🔴 Pas de **chef** dans la composition : 500 g d'eau + 500 g de farine ne font pas un levain, ils font une pâte à crêpes. Le système coûte 1 kg de levain au prix de la farine, et aucune étape (rafraîchi, 12 h à 28 °C) n'existe.
- 🔧 Composition : levain chef 100-200 g (sous-recette elle-même, ou ingrédient « Levain chef ») + 450 farine + 450 eau ; étape `pointage` 12 h à 26-28 °C ; DLC 24-48 h à 4 °C (`default_shelf_life_days` 2).

### B. Viennoiserie

#### Pâte levée feuilletée (masterclass, 2 265 g) — base de référence
- 🟢 Procédé exemplaire : température de base 54 (T° liquides = 54 − T° labo − T° farine, pâte 22-24 °C), frasage 4 min + 5-6 min 2ᵉ vitesse « pas de voile », pointage 30 min → blocage 40 min à −18 °C → 12 h à 4 °C, beurre de tourage 84 % MG à 13-15 °C avec test de pliage, 1 tour double + 1 simple = 12 couches, repos 30 min entre tours, détaillage 3,5 mm. Sel 2 %, sucre 12 %, levure 4,5 %, beurre de tourage 500 g = 27 % du poids de détrempe. Tout est conforme aux règles de l'art.
- 🔴 **La composition en base ne correspond pas au texte de la fiche.** Texte : détrempe 1 850 g = farine 1 000 + lait 350 + eau 100 + **œufs 100** + sucre 120 + levure 45 + sel 20 + **lait en poudre 30** + beurre pommade 80 + malt 5, puis 500 g de beurre de tourage = **2 350 g**. Base : eau 250 + lait 250, **pas d'œufs, pas de lait en poudre**, beurre 570 en un seul poste (pommade + tourage confondus), améliorant 10, rendement **2 265 g**. Hydratation réelle du texte ≈ 52 %, de la base ≈ 47 %.
- 🔴 Étape 4 « Beurre de tourage (test 90°) » : `temperature_c = 90` (artefact de la migration 342 qui a lu « 90° » comme une température).
- 🔴 Étape 1 « Température de l'eau » typée `autre` et étape 5 « Enchâssage et tours » typée `autre` au lieu de `tourage` ; l'étape 3 cumule pointage + blocage + 12 h de froid en un seul bloc de 780 min (le blocage à −18 °C est un `refroidissement` à tracer séparément).
- 🔧 Aligner la composition sur le texte : lait 350, eau 100, œufs entiers liquides 100, lait en poudre 30, beurre pommade 80 (poste « détrempe ») et **beurre de tourage 84 %** 500 g (poste séparé, idéalement un ingrédient distinct « Beurre de tourage 84 % »), malt 5 ; rendement 2 350 g ; `hydratation_pct` 52 ; `temperature_pate_cible_c` 23. Mettre `temperature_c` à NULL (ou 14 pour la consigne beurre) sur l'étape 4, typer E1 `petrissage` (ou la fusionner dans E2), E5 `tourage`, scinder E3 en pointage 30 min / refroidissement 40 min à −18 / repos 720 min à 4 °C.

#### Pâte levée feuilletée nature (2 400 g) — 🔴 à retirer
- 🔴 Farine 1 000 / lait **250 ml** / œuf **1** / beurre 550 / sucre 120 / levure 40 / sel 20 : somme des entrées **2 035 g** pour un rendement déclaré 2 400 g (365 g sortis de nulle part). Hydratation réelle ≈ **25 %** (impossible : une détrempe ne se forme pas sous 45 %), alors que la fiche affiche 52 %. Pas d'eau, pas de distinction beurre détrempe / tourage. Étapes squelettiques (3 tours simples à 40 min sans repos, pointage « au froid » 60 min seul).
- 🔴 C'est un **doublon** de la masterclass, et c'est pourtant **elle** que consomment Croissant, Pain au chocolat et Pain aux raisins.
- 🔧 Archiver cette base ; repointer les trois produits sur « Pâte levée feuilletée » via le remplacement A→B (mig 401), en recalculant les quantités en net (perte 5 %).

#### Croissant (12 pièces)
- 🟢 Plaque 60×40 viennoiseries (12) cohérente avec un croissant de 70-90 g.
- 🔴 780 g de pâte / 12 = **65 g cru** → ≈ 55 g cuit : c'est un mini-croissant, pas un croissant de boulangerie (70-90 g cru, 90 g sur la fiche Torsade du même atelier). Dorure = « Oeuf 1 unit » sans masse. Pas de `poids_cuit_g`, pas d'étapes (détaillage triangles 10×25 cm, apprêt 2 h à 26 °C, cuisson 170 °C 16-18 min ventilé). Doublon « Croissant [1 unit] » vide en base.
- 🔧 Pâte 960 g nets (80 g × 12) de la masterclass ; dorure = base « Dorure » 36 g (3 g/pièce) ; `poids_cru_g` 996, `poids_cuit_g` 830 (−17 %) ; copier les étapes 1, 3, 4, 5, 6 de la Torsade (détaillage, apprêt 135 min 26 °C 75 % HR, dorure, cuisson 170 °C 17 min, ressuage). Supprimer le doublon vide.

#### Pain au chocolat (12 pièces)
- 🔴 720 g de pâte / 12 = **60 g cru** (standard 70-85 g pour un rectangle 8×14 cm à 2 bâtons). `poids_cru_g` 760 ne correspond ni à 720 (pâte seule) ni à 720 + 24 bâtons (≈ 804 g). Coût des bâtons aberrant (§1.6). Aucune étape, pas de freinte.
- 🔧 Pâte 900 g nets (75 g × 12), 24 bâtons à 0,30 DH / 3,5 g, dorure 36 g ; `poids_cru_g` 1 020, `poids_cuit_g` 860 (−16 %) ; mêmes étapes que le croissant.

#### Pain aux raisins (12 pièces)
- 🟢 95 g cru par pièce (pâte 60 + crème pâtissière 25 + raisins 10) : la garniture est dans les ratios du métier (crème 20-30 g, raisins 10-15 g).
- 🔴 Pâte 60 g/pièce trop légère pour un escargot Ø 10 cm (70-80 g) ; crème pâtissière 300 g = 0,19 fournée (acceptable, la crème est divisible). Pas de freinte, pas d'étapes (abaisse 3 mm en bande 30 cm, crème, raisins macérés, rouler, trancher 2,5 cm, apprêt, cuisson 175 °C 18 min, nappage).
- 🔧 Pâte 840 g nets (70 g), crème 300, raisins 150 (12,5 g, idéalement macérés : prévoir 10 g de sirop 30°B) ; `poids_cuit_g` −15 % ; ajouter 5 étapes.

#### Torsade nature sucre (15 pièces) — masterclass
- 🟢 Quantités par pièce exactes et retrouvées dans la composition : pâton 90 g (1 350 / 15), sucre 8 g, dorure 3 g, sirop 4 g → format 105 g ✓. Rendement 1 kg de farine → 24 × 90 g = 2 160 g ≈ pâte nette 2 230 g ✓. Freinte de cuisson 14 % → 77 g, sirotée 81 g ✓. Apprêt 26-27 °C maxi 28 °C (beurre fond à 30), 75 % HR, 2 h-2 h 30 ✓. Cuisson ventilée 165-170 °C 16-18 min, buée fermée, clapet à 8 min ✓. Ressuage sur grille, jamais filmer tiède ✓. Surgélation crue −35 °C 40 min / 3 semaines, précuite 80 % / 6 semaines ✓. Défauts rédhibitoires listés ✓.
- 🔴 Contradiction interne de capacité : étape 2 dit « ≈ **12** pièces sur plaque 60 × 40 » (espacement 6 cm), le format et le rendement disent **15**. `nb_repetitions` = 24 sur l'étape de façonnage (c'est le nombre de pièces par kilo de farine, pas la fournée de 15). `poids_cuit_g` NULL alors que la fiche donne 77 g → 1 155 g pour 15. Le sirop consommé est « Sirop à 30°B » de la base, dont le ratio est faux (voir sirops) alors que le texte de la Torsade donne le bon (500 eau / 650 sucre / 50 glucose). DLC produit NULL vs 24 h.
- 🔧 Trancher 12 ou 15 par plaque (15 tient à 5 cm d'espacement sur 3 rangées de 5) ; `nb_repetitions` 15 ; `poids_cuit_g` 1 215 (15 × 81 g sirotées) ; corriger la base sirop ; `shelf_life_days` 1 / `display_life_hours` 24.

#### Pâte viennoise sucrée (1 828 g)
- 🟢 Sel 1,8 %, sucre 12 %, levure 4 %, beurre 15 % : viennoise lactée correcte. Pousse contrôlée une nuit à 4 °C ✓.
- 🔴 Hydratation ≈ 45 % (lait 450 + œufs 50) : un peu serrée pour une viennoise (50-55 %). Perte 12 % déclarée « = cuisson » sur la **pâte** (convention fautive §1.1). Aucun produit actif ne l'utilise ; pas d'étapes.
- 🔧 Lait 500 g ; perte base 2 % (chutes), freinte sur les produits ; étapes pétrissage 12 min (T° 25) → pointage 45 min → division → façonnage → apprêt 90 min 27 °C → dorure → cuisson 180 °C 15 min.

#### Pâte à brioche (2 190 g) · Brioche (1 pièce)
- 🟢 Farine 1 000 / œufs 500 / lait 100 / beurre 400 / sucre 130 / levure 40 / sel 20 : brioche « moyenne » de boutique (œufs 50 %, beurre 40 %), beurre en 3 fois, pousse contrôlée à 4 °C ✓. Perte 3 % (chutes) ✓.
- 🔴 Produit : **60 g** de pâte dans un « Moule à brioche à tête Ø 10 cm » : un moule Ø 10 cm demande 80-100 g (60 g remplit un Ø 7-8 cm). Pas de freinte (brioche −12 %), pas d'étapes (boulage, tête, apprêt 2 h à 27 °C, dorure, cuisson 170 °C 18 min).
- 🔧 Soit moule Ø 8 cm, soit 90 g ; `poids_cuit_g` cru × 0,88 ; étapes.

### C. Pâtisserie — bases

#### Pâte feuilletée (2 350 g)
- 🟢 Détrempe 1 000 / 480 eau / 20 sel + beurre 850 : hydratation 48 %, beurre 85 % de la farine, 5 tours simples, repos 30 min, 48 h au froid, 3 mois surgelée en pâtons, perte 5 % de rognures : fiche de feuilletage classique irréprochable.
- 🔴 Pas d'étapes structurées (le texte seul), beurre détrempe et beurre de tourage confondus dans un seul poste.
- 🔧 Étapes : détrempe (pétrissage 5 min, 20 °C) → repos 30 min à 4 °C → enchâssage → tours 1-2 → repos 30 min → tours 3-4 → repos → tour 5 → repos 1 h minimum. Séparer beurre pommade 100 g / beurre de tourage 750 g.

#### Pâte sucrée (1 160 g)
- 🟢 500 farine / 300 beurre / 190 sucre glace / 105 œufs / 60 amande / 5 sel : **c'est la pâte sucrée classique au gramme près**. Sablage, repos 2 h, fonçage 2,5 mm, perte 6 % de chutes ✓.
- 🔴 Pas d'étapes ; pas de DLC base (J+3 à 4 °C, 1 mois à −18 °C).
- 🔧 Étapes sablage → crémage œufs → frasage sans corser → repos 2 h → fonçage → repos 30 min au froid avant cuisson.

#### Pâte à choux (1 470 g)
- 🟢 Eau 250 + lait 250 / beurre 200 / farine 300 / œufs 450 / sel 5 / sucre 15 : ratio classique (500 liquide / 200 / 300 / 450-500). Dessèchement 2 min, œufs progressifs « au ruban ». **Perte 28 %** d'évaporation à la cuisson : réaliste (25-30 %).
- 🔴 La perte de 28 % est portée par la base alors que c'est la cuisson du produit poché (éclair) qui évapore : l'Éclair ne pourra pas déclarer de freinte sans la compter deux fois. Pas de T° de cuisson structurée.
- 🔧 Garder 28 % sur la base **uniquement si** l'Éclair reste à freinte 0 et que le système le documente ; sinon perte base 2 %, `poids_cuit_g` de l'Éclair = choux × 0,72 + garnitures.

#### Crème pâtissière (1 560 g) · Crème pâtissière chocolat (1 150 g)
- 🟢 Lait 1 000 / jaunes 160 / sucre 220 / maïzena 92 / beurre 80 / vanille 8 : standard (jaunes 16 %, sucre 22 %, amidon 9 %). Cuisson 2 min après ébullition, beurre à 40 °C, **refroidissement < 1 h en cellule à +4 °C** (CCP correct), J+2. Chocolat : 15 % de couverture 55 % dans la crème chaude ✓.
- 🔴 Pas d'étapes, donc le CCP refroidissement n'est pas tracé. Fournée chocolat (1 150 g, 1 127 nets) trop petite pour l'Éclair (1 440 g).
- 🔧 Étapes `cuisson` (ébullition 2 min, 85 °C minimum) → `refroidissement` (−3 à 4 °C en < 60 min, timer). Fournée chocolat 1 500 g (1 300 pâtissière + 200 couverture).

#### Crème d'amande (1 855 g)
- 🟢 TPT 475 / 475 / 475 + œufs 380 + maïzena 50 : équilibrée (œufs 80 % de l'amande), « ne pas foisonner » ✓, J+3 ✓, perte 2 % ✓.

#### Crème chantilly (1 060 g) · Chantilly mascarpone vanille (1 205 g)
- 🟢 Mascarpone 27 % de la crème, sucre glace 10 %, tout à 4 °C, « ne se congèle pas », 1 h maxi avant usage ✓. Perte 0,4 % ✓.
- 🔴 Chantilly simple sucrée à 6 % (standard 8-10 %) ; **Crème fraîche** du référentiel utilisée pour une crème liquide 35 % MG (la fiche le signale elle-même).
- 🔧 Sucre glace 90 g ; créer l'ingrédient « Crème liquide 35 % » et le substituer.

#### Biscuit Joconde (1 262 g)
- 🟢 TPT 260/260 + œufs 350 + blancs 230 + sucre 40 + farine 70 + beurre 50 : **la Joconde classique exacte**. 3 feuilles de 400 g sur 40×30, four 230 °C 6-8 min, perte de cuisson 17 % → 1 047 g nets, cohérent avec les 1 050 g consommés par l'Opéra.
- 🔴 Une seule étape `autre` de 50 min : la cuisson à 230 °C (critique : 1 min de trop = biscuit sec) n'est ni typée ni minutée. 3 × 400 g = 1 200 g, pas 1 262 : les 62 g (5 %) de reste de cuve ne sont pas nommés.
- 🔧 Scinder : montage (25 min) / `cuisson` 230 °C 7 min (timer) / `refroidissement` ; `perte_standard_pct` 17 inclut le fond de cuve, le noter.

#### Génoise cacao (1 020 g) · Génoise nature (1 000 g)
- 🟢 Œufs 450 / sucre 280 / farine 220 / cacao 70 (cacao = 24 % des poudres) ; nature 500/250/250 ; bain-marie 40-45 °C, ruban 10-12 min, 180 °C 18-22 min, perte 11,7-12 % ✓.
- 🔴 Étape unique `autre` (cacao) ; aucune étape (nature). La cacao est consommée en **0,74 plaque** par la Forêt Noire (§1.3).
- 🔧 Scinder en montage / `cuisson` 180 °C 20 min / `refroidissement` ; marquer « lot indivisible ».

#### Ganache chocolat noir (490 g) · Glaçage opéra (440 g) · Glaçage miroir cacao (1 400 g)
- 🟢 Ganache 250 couverture / 200 crème / 40 beurre (ratio 1,25, ferme pour un cadre), émulsion par le centre, beurre à 40 °C, coulée à 30-32 °C ✓. Glaçage opéra 250 couverture + 150 pâte à glacer + 40 huile, 30-32 °C, alternative sans pâte à glacer donnée ✓. Miroir : 300 eau / 500 sucre / 100 glucose / 180 cacao / 300 crème / 20 gélatine, cuisson 103 °C, gélatine à 60 °C, usage 32-35 °C, « mixer sans air » ✓ (ratios Valrhona).
- 🔴 Le miroir cacao est utilisé comme **glaçage d'éclair** : inhabituel (fondant ou glaçage chocolat), il coule et ne sèche pas sur une surface bombée en vitrine. Perte miroir 5 % (reste de cul-de-poule) acceptable.
- 🔧 Pour l'éclair, créer « Glaçage éclair chocolat » (fondant 500 + sirop 30°B 50 + cacao 40, usage à 37 °C) ou garder le miroir en l'assumant (vitrine froide).

#### Crème au beurre café (703 g) · Punch café Opéra (418 g)
- 🟢 Pâte à bombe sucre 200 + eau 65 cuits à 118 °C, jaunes 80, beurre 340 à **20 °C exactement**, refroidissement à 25 °C sondé, diagnostic granuleux/liquide : rigoureux. Punch 250 eau / 150 sucre / café 15 / vanille 3, refroidi avant usage, 1 semaine à 4 °C ✓.
- 🔴 Perte 1 % crème au beurre et 5 % punch ne sont pas justifiées sur la fiche (le punch perd à l'ébullition, soit ; la crème ne perd rien). Étapes `autre`.
- 🔧 Typer les étapes (`cuisson` du sucre 118 °C avec T°, `montage`) ; perte crème 0 %.

#### Sirops — 🔴 trois fiches, trois ratios
| Fiche | Composition | Teneur en sucre | Degré Baumé réel |
|---|---|---|---|
| Sirop 30° (533 g) | 200 ml eau + 333 g sucre | 62 % | ≈ 32 °B ✓ |
| **Sirop à 30°B (1 350 g)** | 750 g eau + 600 g sucre | **44 %** | **≈ 24 °B ✗** |
| Torsade (texte) | 500 eau + 650 sucre + 50 glucose | 58 % | ≈ 30 °B ✓ |
| Sirop griotte (400 g) | 200 eau + 100 sucre + 100 purée | 25 % | sirop léger (voulu) |
- 🔴 « Sirop à 30°B » n'est pas à 30 °B : il est sous-dosé d'un tiers. C'est **lui** que consomme la Torsade. Doublon avec « Sirop 30° » (bon ratio, mais étape sans durée et références d'ingrédients en UUID bruts).
- 🔧 Une seule base « Sirop 30°B » : eau 1 000 + sucre 1 350 (ou eau 750 + sucre 1 000 + glucose 50), perte 3 % d'évaporation, DLC 15 j à 4 °C ; archiver « Sirop 30° ». Griotte : 25 % est faible pour la conservation annoncée (1 semaine) : passer à 200 eau / 150 sucre / 100 purée.

#### Dorure (200 g)
- 🟢 Œufs 160 + jaunes 38 + sel 2, tamisée, J+2 ✓. À utiliser partout où « Oeuf 1 unit » est saisi.

### D. Produits montés et cuits

#### Opéra (24 parts) — masterclass
- 🟢 Structure 7 couches + chablon (80 g) + glaçage, masses par couche retrouvées exactement dans la composition : 350 × 3 Joconde, 110 × 3 punch, 380 + 220 crème, 400 ganache, 300 glaçage = **2 760 g** brut = texte ✓. Parage 1 cm → 38 × 28 → 4 × 9,5 et 6 × 4,5 ✓ (27 cm sur 28). 4 températures critiques (118 / 25 / 30-32 / 30-32), blocages 20 min entre couches, nuit au froid, contrôle de rendement par pesée du cadre (2 400-2 500 g), hauteur 2,4-2,5 cm, DLC 72 h, cadre entier 1 mois à −18 °C avant glaçage : fiche de niveau MOF.
- 🔴 **Parage de 310 g (11 %) non modélisé** : `perte_standard_pct` 0, `quantite_par_format` 115 g = 2 760 / 24 (brut), alors que la part réelle fait 100 g. Joconde consommée en **0,83 fournée** (3 feuilles = 1 plaque entière). Hauteur théorique : 3 biscuits (≈ 4 mm) + 4,5 + 4 + 3 + ≈ 1 = **24,5 mm** ✓. DLC produit 15 j (§1.7). Allergènes du texte (gluten, œuf, lait, amande, soja) absents des ingrédients.
- 🔧 `perte_standard_pct` 11 (ou `poids_cuit_g` = 2 450 sur le format) ; Joconde 1 047 g = fournée entière ; `shelf_life_days` 3 ; corriger les DLC/allergènes ingrédients.

#### Forêt Noire (24 parts) — masterclass
- 🟢 6 couches cohérentes, griottes 2 × 225 = 450 ✓, sirop 3 × 100 = 300 ✓, chantilly 400 + 400 + 300 = 1 100 ✓, blocage 2 h / 30 min cellule avant parage, couteau chaud essuyé à chaque coupe, « ne pas surgeler les parts avec griottes », DLC 48 h, aucun alcool assumé ✓. Hauteur : 3 génoises 8-10 mm + 2 × chantilly ≈ 7 mm + masquage 5 mm ≈ **45 mm** = cadre 4,5 ✓.
- 🔴 **Les masses ne bouclent pas.** Composition = 2 750 g brut ; texte : « brut 3 100 g − 300 g parage = 2 800 g » et « ~130 g la part » (24 × 130 = 3 120). Avec 2 750 brut − 300 parage = 2 450 → **102 g la part**, pas 130. Un volume de part 9,5 × 4,5 × 4,5 cm = 192 cm³ à ≈ 0,55 g/cm³ (chantilly) donne ≈ 105 g : c'est le texte (130 g) qui est faux, pas la composition. `quantite_par_format` 130 g propagé au prix/part. Génoise consommée 0,74 plaque (§1.3 : 900 g nets = la plaque entière, 3 feuilles de 300 g parées à 250). DLC 3 j vs 48 h.
- 🔧 Texte : brut 2 750, paré 2 450, part **≈ 100 g** ; format 115 g brut / `poids_cuit_g` 2 450 ; génoise 900 g (plaque entière, 150 g de parage) ; `shelf_life_days` 2.

#### Mille-feuille (24 pièces)
- 🟢 Feuilletage 80 g cru/pièce (3 abaisses 60 × 40 à 2 mm ≈ 2 000 g) et crème pâtissière 70 g/pièce : dans les ratios (60-80 g).
- 🔴 **Aucune finition** : ni fondant/sucre glace pour le dessus, ni cuisson du feuilletage sous plaque (étape « cuisson 200 °C 25 min entre deux plaques, caraméliser au sucre glace 240 °C 2 min ») : la fiche est un sandwich de pâte crue et de crème. Crème 1 680 g sur une fournée nette de 1 513 g (**1,11 fournée**). Pas de freinte alors que le feuilletage cuit perd ≈ 20 % d'eau, et que le détaillage des bandes en 24 rectangles fait 10 % de chutes. `poids_cru_g` 3 600 = somme brute. DLC 1 j ✓.
- 🔧 Ajouter fondant 480 g (20 g/pièce) + cacao 20 g pour le marbrage (ou sucre glace 120 g pour la version caramélisée) ; crème 1 440 g (60 g) ou fournée crème 1 800 g ; `poids_cuit_g` ≈ 3 000 ; 5 étapes (abaisse, piquage, cuisson sous plaque, montage, glaçage).

#### Éclair chocolat (24 pièces)
- 🟢 Choux 45 g cru/pièce (pochage 13-14 cm, douille 14), crème 60 g, glaçage 20 g : exacts. Plaque perforée ✓.
- 🔴 Crème pâtissière chocolat consommée **1,28 fournée** (1 440 sur 1 127 nets). Pas d'étapes (pochage, cuisson 180 °C 35 min **sans ouvrir** puis 10 min clapet ouvert, ressuage, garnissage par 3 trous, glaçage). `poids_cuit_g` NULL alors que choux 1 080 × 0,72 + 1 440 + 480 = **2 700 g** sont calculables. Glaçage miroir discutable (voir glaçages).
- 🔧 Fournée crème choc 1 500 g ; `poids_cuit_g` 2 700 ; 5 étapes avec `cuisson` 180 °C 35 + 10 min ; DLC 1 j ✓.

#### Tarte aux amandes (15 pièces)
- 🟢 Pâte sucrée et crème d'amande justes ; décor 10 g d'amande ✓.
- 🔴 Fond **60 g** et crème **80 g** par tartelette pour une « Plaque à tartelettes silicone (15) » (Ø 8 cm ≈ 40 g de fond, 50-60 g de crème) : soit 150 g cru par tartelette vendue 12 DH, surdosée d'un tiers, soit ce sont des tartes individuelles Ø 10-11 cm et le contenant est faux. Pas de freinte (crème d'amande −10 % à la cuisson), pas d'étapes (fonçage, crème, amandes, cuisson 170 °C 25-30 min, nappage), pas de nappage (abricot 10 g/pièce) dans la composition.
- 🔧 Trancher le diamètre ; pour Ø 8 cm : fond 600 g (40 g), crème 900 g (60 g), nappage 150 g ; `poids_cuit_g` cru × 0,92.

#### Appareil à muffin chocolat (2 100 g) · Muffin chocolat (24 pièces)
- 🟢 90 g cru par alvéole standard ✓. Sucre 92 %, beurre 50 %, œufs 71 %, lait 67 % de la farine : texture muffin américain cohérente.
- 🔴 **Levure chimique 24 g pour 480 g de farine = 5 %** : le double de la norme (2,5-3,5 %). À 5 % le muffin monte en pic puis s'affaisse, et laisse un goût savonneux/amer. Sel 4 g (0,8 %, faible pour un chocolat). Produit : 2 160 g pour une fournée de 2 100 g (1 890 nets à 10 %) → **1,14 fournée**. La perte 10 % de cuisson est sur l'appareil (§1.1) et le produit n'a pas de `poids_cuit_g`.
- 🔧 Levure chimique **15 g** (3,1 %), sel 6 g ; fournée appareil 2 160 g (= 24 × 90) ; perte appareil 0, `poids_cuit_g` 1 945 (−10 %).

#### Pâte à cake citron (2 000 g) · Cake citron (1 pièce)
- 🟢 Beurre 440 / sucre 500 / œufs 460 / farine 440 : quatre-quarts citronné, levure chimique 12 g (2,7 %) ✓, 500 g dans un moule de 20 cm ✓ (freinte 10 % → 450 g, DLC 5 j ✓).
- 🔴 « Citron 140 g » en kg : zeste + jus de 2 citrons ? ou fruits entiers ? Non précisé ; un cake citron se parfume au zeste (2 citrons) et à l'huile essentielle, le jus va dans le sirop d'imbibage ou le glaçage, **absents** de la fiche (glaçage citron sucre glace 100 g + jus 15 g). Perte 10 % sur la pâte au lieu du produit.
- 🔧 Décomposer : zeste de citron 20 g + jus 60 g ; ajouter sirop citron 60 g/cake et glaçage 60 g ; freinte sur le format (`poids_cuit_g` 450).

#### Pâte à cookies (2 000 g)
- 🟢 Beurre 63 %, sucres 66 % (cassonade 2/3), œufs 26 %, perte 8 % ✓.
- 🔴 **Lait 200 g** dans une pâte à cookies : une pâte à cookies ne contient pas de lait (elle s'étale et devient cakeuse) ; vanille 4 g ✓ ; aucun produit actif ne l'utilise ; pas d'étapes (crémage, repos 12 h au froid, boulage 60-80 g, 170 °C 12 min).
- 🔧 Supprimer le lait (ou 50 g maxi), compenser par œufs 220 g ; chocolat (gouttes 25-30 %) absent de la base : à ajouter au produit.

### E. Fiches à supprimer
- **Croissant [1 unit]** : vide, doublon du Croissant (12).
- **Recette Baguette Tradition [1 unit]** : 0,5 kg de farine Soisson, rien d'autre ; produit « Baguette Tradition » en doublon de « BAG TRADITION SÉSAME ».
- **SIMPate mvo3lk2axigrs**, **SIMPate mvo3u2awwe7uh** : résidus de simulation.
- **Sirop 30°** après fusion avec « Sirop à 30°B » corrigé ; **Pâte levée feuilletée nature** après repointage des 3 viennoiseries.

---

## 3. Plan de correction priorisé

| Priorité | Action | Fiches | Outil Kalum |
|---|---|---|---|
| **P0** | Archiver « Pâte levée feuilletée nature », repointer Croissant / Pain au chocolat / Pain aux raisins sur la masterclass avec les quantités en net | 4 | Remplacement A→B (401) |
| **P0** | Aligner la composition de « Pâte levée feuilletée » sur son texte (œufs 100, lait poudre 30, lait 350, eau 100, beurre détrempe 80 + tourage 500, 2 350 g) ; `temperature_c` de l'étape 4 → NULL | 1 | Éditeur de composition |
| **P0** | Fusionner Beurre ×2, Sucre semoule ×2 ; une seule référence « Bâton chocolat » à 0,30 DH / 3,5 g | référentiel | 401 + fiche ingrédient |
| **P0** | Renseigner les allergènes des ≈ 40 ingrédients utilisés | référentiel | Fiche ingrédient (344) |
| **P1** | Renseigner `poids_cuit_g` sur les 16 formats (baguette −20 %, viennoiseries −15 à −17 %, cadres = brut − parage, choux −28 %, muffin/cake −10 %) et basculer les pertes « cuisson » des bases vers les produits | 16 + 3 | Formats |
| **P1** | Corriger Sirop 30°B (1 000 eau / 1 350 sucre), muffin (levure 15 g), pain complet (eau 710), Forêt Noire (part 100 g, génoise 900 g), Opéra (parage 11 %, Joconde 1 047 g), Mille-feuille (fondant + crème 1 440) | 7 | Éditeur |
| **P1** | DLC produits : Opéra 3 j, Forêt Noire 2 j, Torsade 1 j / 24 h | 3 | Fiche produit |
| **P2** | Étapes structurées sur les 38 fiches sans procédé, en commençant par les pâtes (pointage / apprêt / cuisson / refroidissement avec `temperature_c`) et les crèmes (CCP refroidissement) ; scinder les 6 étapes `autre` monolithiques | 44 | Éditeur d'étapes |
| **P2** | `hydratation_pct` + `temperature_pate_cible_c` sur les 9 pâtes ; `poids_piece_kg` sur Oeuf (0,055) et bâton (0,0035) | 11 | Fiches |
| **P2** | Seeder `categories_pertes` sur les 50 contenants ; marquer Joconde / génoises « lot indivisible » (évolution système, cf. architecture labo L3) | référentiel | Migration |
| **P3** | Supprimer les 4 fiches poubelle ; redimensionner les pâtes à pain sur le pétrin réel ; trancher les formats ambigus (baguette normale 5/10, brioche 60 g/Ø 10, tartelettes Ø 8/Ø 10, torsade 12/15 par plaque) | 8 | Décision chef |

### Réserve
Les ratios « règles de l'art » cités (hydratations, freintes, températures d'apprêt, temps de cuisson) sont ceux de la boulangerie-pâtisserie française de boutique ; le chef peut légitimement s'en écarter (croissant de 65 g, chantilly à 6 %), mais la fiche doit alors l'assumer explicitement, pas le subir par oubli. Les anomalies **de données** (doublons, DLC, coût des bâtons, allergènes vides) sont, elles, à corriger sans débat.
