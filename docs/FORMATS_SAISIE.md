# Alimentation des formats de production — structure des informations attendues

*Cadre : ce document décrit exactement ce que je dois recevoir pour créer/mettre à jour les formats. Il est calé sur le modèle réel : `production_contenants` (mig 082), `recipe_formats` (157, 162, 168, 199, 263, 266, 269), `recipe_format_components` (200, 265).*

---

## 0. Le principe en une phrase

Un **format** = *(une recette) × (un contenant)*, avec la quantité de pâte/appareil engagée par unité et le nombre d'unités par fournée.

Il n'y a **pas de colonne « nom de format »** : c'est le **contenant** qui nomme le format (« Moule rond Ø20cm », « Cadre 40x60cm », « Kg pâte briochée »). Conséquence directe : deux formats distincts d'une même recette exigent **deux contenants distincts** (contrainte `UNIQUE (recipe_id, contenant_id)`). Si le cake 300 g et le cake 600 g sortent du même type de moule, il me faut malgré tout deux entrées de contenant (« Moule cake 300 g », « Moule cake 600 g »).

*Analogie Oracle : `production_contenants` est une table de référentiel (comme une lookup de types), `recipe_formats` est la table intersection recette↔contenant avec ses attributs, `recipe_format_components` est la nomenclature détail rattachée à cette intersection.*

---

## 1. Choisir d'abord le mode de coût de chaque recette

C'est la **première** information à me donner, avant les formats eux-mêmes : `recipes.mode_cout`.

| Mode | Quand | Ce que ça implique pour la saisie |
|---|---|---|
| **`ratio_poids`** (défaut) | Une seule pâte/appareil est répartie sur plusieurs formats — 1 fournée → 3 moules moyens + 3 petits. Co-produits. | Je n'ai besoin **que du tableau 2**. Le coût total de la fournée est ventilé au prorata de `quantite_par_format × nb_par_defaut`. La composition reste celle de la recette. |
| **`compose`** | Chaque format a sa **propre** nomenclature — une tartelette n'est pas une Ø28 réduite. Assemblages : tartes, entremets, produits garnis. | Il me faut le **tableau 2 + le tableau 3**. Le coût = somme des composants du format + emballage + indirects. |

Si vous ne tranchez pas : tout ce qui est **assemblé à partir de plusieurs recettes de base** (fond + crème + nappage) est `compose` ; tout ce qui est **une seule masse déclinée en tailles** est `ratio_poids`.

---

## 2. Tableau 1 — Contenants (seulement les manquants)

Ne me listez que les contenants **qui n'existent pas encore**. Déjà en base : Cadre 40x60cm, Moule rond Ø20cm, Cercle entremets Ø18/Ø22cm, Fournée pièces sèches, Fournée pièces garnies, Kg pâte boulangerie, Kg détrempe feuilletée, Kg pâte briochée, Kg crème pâtissière, Kg ganache, Kg crème d'amande, Kg appareil à flan, Kg crème mousseline, Kg sirop imbibage.

Fichier : `docs/templates/formats/1_contenants.csv`

| Colonne | Obligatoire | Contenu |
|---|---|---|
| `nom` | **oui** | Nom exact et parlant, il servira de nom de format. Ex. « Moule cake 600 g » |
| `type_production` | **oui** | `1` Moule→Découpe · `2` Entremets monté · `3` Pièces individuelles · `4` Pétrissage→Cuisson · `5` Laminage→Cuisson |
| `unite_lancement` | **oui** | Unité de lancement d'un ordre : `moule`, `cadre`, `cercle`, `fournee`, `kg_pate`, `unit` |
| `quantite_theorique` | oui | Rendement théorique d'un lancement dans cette unité (ex. cadre 40x60 → 22 parts) |
| `pertes_fixes` | oui (0 possible) | Pertes structurelles constantes (chutes de bords…) dans la même unité |
| `seuil_rendement_defaut` | non (90 par défaut) | % en dessous duquel le rendement est alerté |

Les étapes de fabrication (`etapes_defaut`) et catégories de pertes : facultatif à ce stade, on les affine après.

---

## 3. Tableau 2 — Formats (le cœur)

Fichier : `docs/templates/formats/2_formats.csv` — **un format par ligne**.

| Colonne | Obligatoire | Contenu / piège |
|---|---|---|
| `recette` | **oui** | Nom exact de la recette. ⚠️ Certains noms en base ont un **espace de fin** : si vous avez les IDs, préférez-les, sinon je fais le rapprochement et je vous fais valider les ambigus. |
| `mode_cout` | **oui** | `ratio_poids` ou `compose` (§1). Se répète sur chaque ligne de la recette, valeur identique. |
| `contenant` | **oui** | Nom exact du contenant (tableau 1 ou existant). |
| `quantite_par_format` | **oui** | Quantité de pâte/appareil engagée par **1 unité** de ce format. Ex. 600 pour un cake moyen. |
| `unite` | **oui** | `g`, `kg`, `ml` ou `l` — rien d'autre. |
| `nb_par_defaut` | **oui** | Nombre d'unités de ce format produites sur **une fournée standard**. C'est ce couple (quantité × nb) qui pilote la ventilation du coût en `ratio_poids`. |
| `is_default` | **oui** | `1` sur **exactement un** format par recette (contrainte d'unicité), `0` sinon. C'est le format canonique utilisé pour le calcul inverse des besoins. |
| `nb_parts` | non | Nombre de parts théoriques si vente à la part → donne coût/part et prix/part. |
| `poids_cru_g` / `poids_cuit_g` | non | Poids engagé cru et poids estimé après cuisson → perte de cuisson calculée. En **grammes** tous les deux. |
| `densite_kg_l` | non | **Uniquement si `unite` vaut ml ou l.** Sinon la conversion se fait à densité 1 (crème ≈ 1,05 ; sirop ≈ 1,30). |
| `cout_emballage_unitaire` | non (0) | Coût d'emballage en DH par unité de ce format. |
| `produit_pos` | non mais **fortement recommandé** | Nom du produit vendu correspondant. C'est le lien qui permet de comparer prix calculé vs prix pratiqué. Un produit ne peut être rattaché qu'à **un seul format actif**. |
| `prix_vente_force` | non | Prix de vente imposé, prime sur coût × marge. |
| `marge_format` | non | Multiplicateur de marge propre au format (ignoré si prix forcé). |
| `ordre` | non | Ordre d'affichage dans l'UI. |

**Contrôle de cohérence que je ferai systématiquement** : `Σ (quantite_par_format × nb_par_defaut)` sur tous les formats d'une recette doit être proche du **poids total de la fournée** (calculé depuis la composition). L'écart est affiché comme « perte » dans `v_recipe_format_summary`. Donnez-moi donc, quand vous l'avez, **le poids total de fournée attendu** — c'est mon contrôle d'entrée.

---

## 4. Tableau 3 — Composants par format (recettes `compose` uniquement)

Fichier : `docs/templates/formats/3_composants.csv` — **une ligne par composant de format**.

| Colonne | Obligatoire | Contenu / piège |
|---|---|---|
| `recette` + `contenant` | **oui** | Identifient le format auquel le composant se rattache (mêmes valeurs qu'au tableau 2). |
| `role` | recommandé | Un code parmi : `fond`, `biscuit`, `croustillant`, `garniture`, `insert`, `fruits`, `nappage`, `glacage`, `decor`, `emballage`. La liste est éditable si un rôle manque — dites-le moi. |
| `source_type` | **oui** | `recette` (recette de base : crème pâtissière, pâte sucrée…) **ou** `ingredient` (matière achetée directement : amandes, sucre glace…). |
| `source_nom` | **oui** | Nom de la recette de base **ou** de l'ingrédient. Jamais les deux : la contrainte impose une source et une seule par ligne. |
| `quantite` | **oui** | Quantité **nette** — ce qui finit dans le produit fini. |
| `unite` | **oui** | Doit être **convertible** vers l'unité de rendement de la source. Un composant en `unit` (pièce) tiré d'une recette dont le rendement est en `kg` donne aujourd'hui un facteur 1 silencieux → coût faux. Signalez-moi ces cas plutôt que de forcer. |
| `perte_pct` | non (0) | Perte propre à **cette ligne** : 5 % de casse sur les fonds de tarte, 2 % de coulage sur le nappage, épluchage des fruits. La quantité brute consommée devient `quantite / (1 − perte_pct/100)`. |
| `ordre` | non | Ordre d'affichage / de montage. |

---

## 5. Exemple complet, à recopier

**Tarte au citron, 3 formats, mode `compose`.**

Tableau 1 (contenants manquants) :
```
nom;type_production;unite_lancement;quantite_theorique;pertes_fixes;seuil_rendement_defaut
Cercle a tarte O24cm;2;cercle;10;0;92
Cercle a tarte O16cm;2;cercle;20;0;92
Tartelette O8cm;3;fournee;60;2;90
```

Tableau 2 (formats) :
```
recette;mode_cout;contenant;quantite_par_format;unite;nb_par_defaut;is_default;nb_parts;poids_cru_g;poids_cuit_g;densite_kg_l;cout_emballage_unitaire;produit_pos;prix_vente_force;marge_format;ordre
Tarte citron;compose;Cercle a tarte O24cm;850;g;6;1;8;;;;2.50;Tarte citron 8 parts;;;1
Tarte citron;compose;Cercle a tarte O16cm;380;g;4;0;4;;;;1.80;Tarte citron individuelle;;;2
Tarte citron;compose;Tartelette O8cm;95;g;24;0;1;;;;0.60;Tartelette citron;;;3
```

Tableau 3 (nomenclature par format) :
```
recette;contenant;role;source_type;source_nom;quantite;unite;perte_pct;ordre
Tarte citron;Cercle a tarte O24cm;fond;recette;Pate sucree;280;g;5;1
Tarte citron;Cercle a tarte O24cm;garniture;recette;Creme citron;450;g;2;2
Tarte citron;Cercle a tarte O24cm;decor;ingredient;Meringue italienne;120;g;0;3
Tarte citron;Cercle a tarte O16cm;fond;recette;Pate sucree;130;g;5;1
Tarte citron;Cercle a tarte O16cm;garniture;recette;Creme citron;200;g;2;2
Tarte citron;Cercle a tarte O16cm;decor;ingredient;Meringue italienne;50;g;0;3
Tarte citron;Tartelette O8cm;fond;recette;Pate sucree;35;g;8;1
Tarte citron;Tartelette O8cm;garniture;recette;Creme citron;50;g;2;2
Tarte citron;Tartelette O8cm;decor;ingredient;Meringue italienne;10;g;0;3
```

---

## 6. Format d'échange accepté

Par ordre de préférence : **CSV séparé par `;`** (les 3 fichiers de `docs/templates/formats/`), **classeur Excel** avec un onglet par tableau, ou **collé directement dans le chat** sous forme de tableau. L'important est de respecter les colonnes ; l'ordre des lignes n'a pas d'importance.

Si les données existent déjà quelque part sous une autre forme (fiches techniques papier scannées, tableur de l'atelier), envoyez-les telles quelles : je fais la mise en forme et je vous soumets le résultat avant tout écrit en base.

---

## 7. Ce que je ferai à réception

1. **Rapprochement des noms** (recettes, ingrédients, contenants) et retour de la liste des non-résolus / ambigus avant tout écrit.
2. **Contrôles bloquants** : un seul `is_default` par recette ; pas de doublon (recette, contenant) ; source unique par composant ; unités convertibles ; un produit POS sur un seul format actif.
3. **Contrôle de masse** : `Σ (quantité × nb)` vs poids de fournée, écart signalé recette par recette.
4. **Migration SQL idempotente** (avec sa note d'inversion, comme les autres), appliquée d'abord en local, résultats de coût par format soumis à votre validation, puis production.

---

## 8. Ce que je ne vous demande pas

Inutile de saisir : les coûts matière (calculés depuis les prix d'achat), les frais indirects et la main-d'œuvre (déjà paramétrés au niveau recette), les prix de vente calculés (déduits du coût × marge — sauf si vous voulez forcer), les étapes de fabrication détaillées (portées par le contenant, affinées après).
