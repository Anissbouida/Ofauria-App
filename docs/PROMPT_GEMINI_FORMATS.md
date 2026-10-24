# CONTEXTE

Tu m'aides à préparer des données de référence métier pour un ERP de production pâtissière / boulangère déjà en service (base PostgreSQL, devise DH, Maroc). Le schéma de base de données existe : **je ne te demande pas de concevoir des tables**, je te demande de **remplir une structure imposée** avec des valeurs métier standard.

Tu joues le rôle d'un **chef pâtissier / responsable de production expérimenté** capable de chiffrer des grammages, des rendements de moules et des nomenclatures d'assemblage.

---

# RÈGLE ABSOLUE — INCERTITUDE

Ces valeurs alimentent un calcul de **coût de revient et de marge réels**. Une valeur inventée fausse silencieusement des prix de vente.

1. Tu ne dois **jamais** inventer un nom de recette, d'ingrédient ou de produit que je ne t'ai pas fourni dans la section « MES DONNÉES ». Si un composant te semble manquer, tu le signales dans le bloc NOTES au lieu de l'ajouter.
2. Quand tu ne connais pas une valeur exacte, tu proposes quand même la **valeur standard du métier**, mais tu la déclares obligatoirement dans le bloc NOTES avec : le niveau de confiance (`haut` / `moyen` / `bas`), la fourchette usuelle, et ce qui permettrait de trancher (peser une fournée, mesurer un moule…).
3. Tu ne présentes jamais une estimation comme une donnée établie.
4. Si une de mes lignes est ambiguë ou contradictoire, tu poses la question dans le bloc NOTES plutôt que de choisir en silence.

---

# NOTION CENTRALE À COMPRENDRE AVANT DE RÉPONDRE

Un **format** = *(une recette) × (un contenant)*, avec la quantité de pâte/appareil engagée par unité produite et le nombre d'unités obtenues sur une fournée standard.

Il n'existe **pas** de champ « nom du format » : c'est le **contenant** qui nomme le format (« Moule rond Ø20cm », « Cadre 40x60cm », « Tartelette Ø8cm »). Deux formats d'une même recette exigent donc **deux contenants distincts**, même s'il s'agit physiquement du même type de moule dans deux tailles (« Moule cake 300 g » et « Moule cake 600 g »).

Chaque recette relève d'un **mode de coût**, à déterminer par toi pour chaque recette que je te fournis :

- **`ratio_poids`** — une seule masse (pâte, appareil, crème) déclinée en plusieurs tailles : 1 fournée → 3 moules moyens + 3 petits. Le coût de la fournée se répartit au prorata du poids engagé. *Exemples : cake, pâte à brioche, crème pâtissière, génoise.*
- **`compose`** — le produit est un **assemblage de plusieurs recettes de base** jouant des rôles différents (fond + garniture + nappage), et chaque taille a sa propre nomenclature — une tartelette n'est pas une Ø28 réduite. *Exemples : tarte, entremets, mille-feuille, produit garni.*

Règle de tranchage : assemblage de plusieurs recettes de base → `compose` ; masse unique déclinée en tailles → `ratio_poids`.

---

# MES DONNÉES

## Recettes / produits à traiter
<!-- Colle ici la liste. Une par ligne. Précise si possible : le poids total d'une fournée standard, et pour les produits composés la liste des composants. -->
[À COMPLÉTER]

## Contenants déjà existants (à réutiliser en priorité)
<!-- Colle ici la liste des moules/cadres/cercles déjà référencés. -->
[À COMPLÉTER]

## Recettes de base disponibles (utilisables comme composants)
<!-- Pâte sucrée, crème pâtissière, ganache… -->
[À COMPLÉTER]

## Ingrédients disponibles (utilisables comme composants directs)
[À COMPLÉTER]

---

# STRUCTURE DE SORTIE ATTENDUE

Tu produis **quatre blocs, dans cet ordre, et rien d'autre**. Les trois premiers sont du CSV strict, séparateur **point-virgule `;`**, avec la ligne d'en-tête exacte donnée ci-dessous, sans guillemets, sans espace après le `;`, décimales avec un **point**. Une cellule vide signifie « non renseigné » (ne mets pas `NULL`, `N/A` ni `-`).

## BLOC 1 — Contenants manquants

Uniquement les contenants **absents** de la liste que je t'ai donnée. Si aucun n'est nécessaire, rends l'en-tête seul.

```csv
nom;type_production;unite_lancement;quantite_theorique;pertes_fixes;seuil_rendement_defaut
```

| Colonne | Règle |
|---|---|
| `nom` | Nom parlant qui servira de nom de format, avec la dimension. Sans accent ni caractère spécial (écris `O20cm` pour Ø20cm). |
| `type_production` | `1` Moule→Découpe · `2` Entremets monté · `3` Pièces individuelles · `4` Pétrissage→Cuisson · `5` Laminage→Cuisson |
| `unite_lancement` | Un seul mot parmi : `moule`, `cadre`, `cercle`, `fournee`, `kg_pate`, `unit` |
| `quantite_theorique` | Rendement théorique d'un lancement, exprimé dans `unite_lancement` |
| `pertes_fixes` | Pertes structurelles constantes (chutes de bords, fonds de cuve), même unité. `0` si aucune. |
| `seuil_rendement_defaut` | % de rendement en dessous duquel on alerte. Défaut raisonnable : `90`. |

## BLOC 2 — Formats

Une ligne par format.

```csv
recette;mode_cout;contenant;quantite_par_format;unite;nb_par_defaut;is_default;nb_parts;poids_cru_g;poids_cuit_g;densite_kg_l;cout_emballage_unitaire;ordre
```

| Colonne | Règle |
|---|---|
| `recette` | Reprise **à l'identique** du nom que je t'ai donné. |
| `mode_cout` | `ratio_poids` ou `compose`. **Identique sur toutes les lignes d'une même recette.** |
| `contenant` | Nom exact d'un contenant existant ou créé au bloc 1. |
| `quantite_par_format` | Quantité de pâte / appareil engagée pour **1 unité** de ce format. |
| `unite` | **Strictement** `g`, `kg`, `ml` ou `l`. Privilégie `g`. |
| `nb_par_defaut` | Nombre d'unités de ce format obtenues sur **une fournée standard**. Entier > 0. |
| `is_default` | `1` sur **exactement un seul** format par recette (le plus courant), `0` sur les autres. Une recette sans ce `1` sera rejetée. |
| `nb_parts` | Nombre de parts si vente à la part. Vide sinon. |
| `poids_cru_g` / `poids_cuit_g` | En **grammes** tous les deux, pour estimer la perte de cuisson. Renseigne-les seulement si le produit est cuit et si tu as une base sérieuse. |
| `densite_kg_l` | **Uniquement si `unite` vaut `ml` ou `l`** (crème ≈ 1.05, sirop ≈ 1.30). Vide dans tous les autres cas. |
| `cout_emballage_unitaire` | En DH par unité. Laisse **vide** si tu n'as pas d'information — ne devine pas un prix. |
| `ordre` | Ordre d'affichage, du plus grand format au plus petit : 1, 2, 3… |

**Contrainte de cohérence à respecter et à vérifier toi-même** : pour chaque recette, `Σ (quantite_par_format × nb_par_defaut)` sur tous ses formats doit être cohérent avec le poids total d'une fournée standard. Si je t'ai donné ce poids, l'écart doit rester sous 5 % ; sinon, explique dans les notes l'hypothèse de fournée que tu as retenue.

## BLOC 3 — Nomenclature par format

**Uniquement pour les recettes que tu as classées en `compose`.** Une ligne par composant de chaque format.

```csv
recette;contenant;role;source_type;source_nom;quantite;unite;perte_pct;ordre
```

| Colonne | Règle |
|---|---|
| `recette` + `contenant` | Identifient le format concerné : reprends exactement les valeurs du bloc 2. |
| `role` | Un code **strictement** parmi : `fond`, `biscuit`, `croustillant`, `garniture`, `insert`, `fruits`, `nappage`, `glacage`, `decor`, `emballage`. S'il t'en manque un, signale-le dans les notes au lieu d'inventer un code. |
| `source_type` | `recette` (recette de base) **ou** `ingredient` (matière achetée). Jamais autre chose. |
| `source_nom` | Nom exact repris de mes listes. Une seule source par ligne. |
| `quantite` | Quantité **nette** : ce qui finit réellement dans le produit, pertes exclues. |
| `unite` | Doit être convertible vers l'unité de rendement de la source. N'utilise `unit` (pièce) que si la source est réellement dénombrée à la pièce. |
| `perte_pct` | Perte propre à cette ligne : casse des fonds, coulage du nappage, épluchage des fruits. `0` si aucune. |
| `ordre` | Ordre de montage, de bas en haut. |

## BLOC 4 — NOTES

En texte libre structuré, et seulement ici. Tu y mets, dans cet ordre :

1. **Valeurs incertaines** — sous forme de liste : `recette / format / colonne → valeur proposée · confiance haut|moyen|bas · fourchette usuelle · comment trancher`.
2. **Choix de `mode_cout`** — pour chaque recette où le classement `ratio_poids` / `compose` s'est joué de peu, la raison retenue.
3. **Manques bloquants** — composants, contenants ou informations que tu aurais eu besoin d'avoir et que je ne t'ai pas fournis.
4. **Questions** — ce que je dois trancher moi-même avant intégration.

---

# AUTOCONTRÔLE OBLIGATOIRE AVANT DE RÉPONDRE

Vérifie chacun de ces points et corrige silencieusement avant de rendre ta réponse :

- [ ] Exactement **un** `is_default=1` par recette.
- [ ] Aucun couple (`recette`, `contenant`) en double dans le bloc 2.
- [ ] `mode_cout` identique sur toutes les lignes d'une même recette.
- [ ] Tout contenant cité au bloc 2 existe : soit dans ma liste, soit au bloc 1.
- [ ] `unite` ∈ {`g`, `kg`, `ml`, `l`} au bloc 2 ; `densite_kg_l` renseignée **seulement** si `ml`/`l`.
- [ ] `role` ∈ liste fermée ; `source_type` ∈ {`recette`, `ingredient`}.
- [ ] Tout `source_nom` provient de mes listes, sans exception.
- [ ] Bloc 3 rempli pour **toutes** les recettes `compose` et pour **aucune** recette `ratio_poids`.
- [ ] Chaque colonne de chaque ligne CSV a le bon nombre de `;` (pas de champ oublié).
- [ ] Somme des poids par recette cohérente avec la fournée.

---

# CE QUE JE NE TE DEMANDE PAS

N'ajoute ni prix d'achat, ni coût matière, ni coût de main-d'œuvre, ni frais indirects, ni prix de vente, ni marge : mon système les calcule à partir de ses propres référentiels. N'écris aucun SQL, aucune définition de table, aucun `INSERT`. Pas de préambule ni de conclusion en dehors des quatre blocs demandés.
