# Cadrage — Solder le legacy de nomenclature (ratio_poids → composé)

Date : 2026-10-23 · Suite de [AUDIT_FORMATS_A2_INVENTAIRE_LEGACY.md](AUDIT_FORMATS_A2_INVENTAIRE_LEGACY.md) (14/08/2026) et de [AUDIT_PRODUCTION_FICHES_TECHNIQUES.md](AUDIT_PRODUCTION_FICHES_TECHNIQUES.md) §3.2.
Ce document ne modifie aucun code : il met l'inventaire à jour, dit pourquoi la dette ne se résorbe pas toute seule, et ordonne la bascule.

---

## 1. Où en est-on depuis l'audit A2

**Rien n'a avancé.** Aucune migration depuis la 261 ne touche le modèle (266, 268, 269 et 343 ne font que *lire* le legacy). Les trois phases de l'A2 — backfill des recettes `ratio_poids`, refonte des vues, suppression — sont toutes encore à faire. L'A2 comptait 118 recettes `ratio_poids` sur 147 ; le chiffre d'aujourd'hui est à relever en prod (requête §5).

Pire : la dette **grossit**. Trois nouveaux lecteurs sont apparus, dont deux que j'ai moi-même ajoutés cette semaine en respectant le double modèle :

| Nouveau lecteur | Pourquoi il lit le legacy | À faire en phase 3 |
|---|---|---|
| `v_recipe_allergens` (mig 343) | Union des ingrédients legacy + composés : déclarer trop plutôt que pas assez | Retirer la branche `recipe_ingredients` / `recipe_sub_recipes` |
| `recipe-version.helper.ts` (mig 346) | Capture tout, y compris le legacy, pour ne rien perdre | Garder (capture historique), les anciennes versions resteront lisibles |
| `recipe-restore.helper.ts` | Réapplique le legacy d'une capture | Convertir le legacy d'une capture en composants du format par défaut à la restauration |
| `production.repository.ts:201` | Liste des ingrédients d'une recette pour l'affichage du plan | Lire `recipe_format_components` du format de l'item |

## 2. La cause racine : la porte d'entrée crée encore du legacy

Le formulaire de recette ([RecipesPage.tsx](../client/src/features/recipes/RecipesPage.tsx), `formIngredients` / `formSubRecipes`) écrit via `recipe.repository.create` dans `recipe_ingredients` et `recipe_sub_recipes`. **Toute recette créée depuis ce formulaire naît en `ratio_poids`.** Elle ne devient composée que si quelqu'un ouvre ensuite l'éditeur de nomenclature. La bascule A2 traitait le stock existant ; tant que le flux entrant n'est pas coupé, le stock se reconstitue.

Conséquence visible en production : [ProductionLaunchModal.tsx](../client/src/features/production/ProductionLaunchModal.tsx) n'affiche que `recipeData.ingredients` et `sub_recipes`. Pour une recette composée, `findById` renvoie `components` — que le modal ignore. **Le panneau « recette » du lancement est vide pour toute recette composée** (constat sur le code). *Corrigé le 2026-10-23 : le modal affiche désormais la nomenclature (`composition`) en plus du legacy — un cas de plus du bi-mode à supprimer en phase 3.*

## 3. Inventaire des lecteurs (état du 2026-10-23)

### 3.1 Vues SQL (5)

`v_recipe_direct_cost`, `v_recipe_direct_weight_kg`, `v_recipe_total_cost`, `v_recipe_total_weight_kg` (inchangées depuis l'A2) + `v_recipe_allergens` (mig 343). Aucune fonction ni trigger ne lit le legacy.

### 3.2 Serveur — écritures (3 chemins)

| Fichier | Opération | Phase |
|---|---|---|
| `recipe.repository.ts` create/update | INSERT / DELETE+INSERT `recipe_ingredients`, `recipe_sub_recipes` | **0** — c'est la porte d'entrée |
| `recipe-component.repository.ts` replaceForFormat | purge le legacy à la première BOM composée (mig 218) | 3 — devient sans objet |
| `recipe-restore.helper.ts` | réapplique le legacy d'une capture | 3 |

### 3.3 Serveur — lectures (10 fichiers)

| Fichier | Rôle | Effort |
|---|---|---|
| `recipe.repository.ts` (13 occ.) | findById / findByProductId / findAll renvoient `ingredients` + `sub_recipes` legacy | Moyen : renvoyer la BOM du format par défaut sous la même forme (compat clients) |
| `recipe-component.repository.ts` (10 occ.) | fallbacks « montrer le legacy si pas de BOM » | Suppression |
| `recipe-composition.helper.ts` (3) | fallback besoins pour `ratio_poids` | Suppression (13 tests unitaires à adapter) |
| `inventory.repository.ts:353,386,491` | « quelles recettes utilisent cet ingrédient » | **Sensible** : union `recipe_format_components` ∪ `recipe_components` |
| `production.repository.ts:201` | ingrédients affichés sur le plan | Lire le format de l'item |
| `production-cout.repository.ts` (2) | coût réel d'un plan | Format de l'item (snapshot A6b déjà en place) |
| `controllers/reports.controller.ts:272,451` | rapports de consommation | Réécriture sur `recipe_format_components` |
| `controllers/recipe-import.controller.ts` (4) | import xlsx : diff avant/après + écriture | L'écriture doit passer par `replaceForFormat` |
| `controllers/ingredient-import.controller.ts:261` | recettes impactées par un renommage | Idem inventory |
| `scripts/resync-recipe-product-prices.ts` | commentaire seulement | Rien |

### 3.4 Client

| Fichier | Rôle |
|---|---|
| `RecipesPage.tsx` (19 occ.) | formulaire legacy (création/édition), affichage `sub_recipes` quand `mode_cout !== 'compose'`, KPI bi-modes (`isCompose` partout) |
| `ProductionLaunchModal.tsx` (11) | panneau recette : `ingredients` + `sub_recipes` uniquement (bug §2) |
| `RecipeImportModal.tsx`, `SemiFinisTab.tsx`, `PlanDetailPage.tsx`, `recipes.api.ts` | lectures mineures |

Toute l'UI est écrite en **bi-mode** (`isCompose ? … : …`). La fin du legacy supprime une branche sur deux dans une vingtaine d'endroits : c'est le vrai gain, et le vrai effort.

## 4. Plan ordonné

L'ordre de l'A2 était : backfill → vues → suppression. Il manquait la marche zéro, celle qui empêche la dette de revenir.

### Phase 0 — Couper le flux entrant (≈ 1,5 j)

1. `recipe.repository.create` : créer **toujours** un format par défaut et écrire la composition dans `recipe_format_components` (+ miroir `recipe_components`), `mode_cout = 'compose'`. Plus aucune écriture dans les tables legacy.
2. `recipe.repository.update` : si la recette est encore `ratio_poids`, la convertir au premier enregistrement (même mécanique que la mig 218) puis écrire en composé.
3. `ProductionLaunchModal` : afficher `components` (bug §2) — indépendant, à faire tout de suite.
4. Import xlsx : écrire via `replaceForFormat`.

À partir d'ici, le nombre de recettes `ratio_poids` ne peut plus que baisser. Toute l'UI bi-mode reste en place : **aucun risque fonctionnel**.

### Phase 1 — Backfill du stock (≈ 1 j)

Migration idempotente : pour chaque recette `ratio_poids` active, créer le format par défaut s'il manque, copier `recipe_ingredients` + `recipe_sub_recipes` dans `recipe_format_components` et `recipe_components`, passer en `compose`. **Ne pas vider les tables legacy** à cette étape (filet).

Contrôle de neutralité : `v_recipe_total_cost` par recette avant/après, écart toléré 0,01 DH ; lister les divergentes. Les recettes archivées sont converties aussi (restaurables).

### Phase 2 — Vues et lecteurs sur la seule source composée (≈ 2 j)

Les 5 vues lisent `recipe_format_components` du format `is_default` (récursif, profondeur 12, garde anti-cycle par chemin comme `v_recipe_allergens`). Les 10 lecteurs serveur passent sur la même source ; `findById` continue de renvoyer `ingredients` / `sub_recipes` **dérivés** de la BOM (compat UI) pendant une version.

Contrôle : même hash de coût qu'en phase 1 ; les 25 tests DB + 13 tests unitaires verts ; les tests DB existants sur `v_recipe_component_cost` et `v_recipe_allergens` servent de non-régression.

### Phase 3 — Suppression (≈ 1,5 j, irréversible)

`DROP TABLE recipe_ingredients, recipe_sub_recipes`, `DROP COLUMN recipes.mode_cout` (tout est composé), `recipes.contenant_id` ; retrait des fallbacks et de la branche legacy dans l'UI (`isCompose` disparaît). `recipe_components` (miroir) : garder tant que `v_recipe_total_cost` s'en sert, ou le remplacer par une lecture directe du format par défaut — décision en phase 2.

Garde-fou : la capture `recipe_versions.snapshot` conserve le legacy des anciennes versions ; la restauration d'une version pré-phase 3 doit convertir ses `ingredients`/`sub_recipes` en composants (déjà prévu §1).

## 5. À relever en prod avant de commencer (lecture seule)

```sql
SELECT
  (SELECT count(*) FROM recipes WHERE archived_at IS NULL)                                   AS recettes_actives,
  (SELECT count(*) FROM recipes WHERE archived_at IS NULL AND mode_cout = 'ratio_poids')      AS en_ratio_poids,
  (SELECT count(*) FROM recipes WHERE archived_at IS NULL AND mode_cout = 'compose')          AS en_compose,
  (SELECT count(*) FROM recipes r WHERE r.archived_at IS NULL AND r.mode_cout = 'ratio_poids'
     AND NOT EXISTS (SELECT 1 FROM recipe_formats f WHERE f.recipe_id = r.id AND f.is_active)) AS ratio_poids_sans_format,
  (SELECT count(*) FROM recipes r WHERE r.archived_at IS NULL AND r.mode_cout = 'compose'
     AND EXISTS (SELECT 1 FROM recipe_ingredients ri WHERE ri.recipe_id = r.id))               AS compose_avec_reste_legacy,
  (SELECT count(*) FROM recipe_ingredients)                                                  AS lignes_recipe_ingredients,
  (SELECT count(*) FROM recipe_sub_recipes)                                                  AS lignes_recipe_sub_recipes,
  (SELECT count(*) FROM recipe_components)                                                   AS lignes_recipe_components,
  (SELECT count(*) FROM recipe_format_components)                                            AS lignes_format_components,
  (SELECT count(*) FROM production_plan_items WHERE format_id IS NULL)                       AS plan_items_sans_format;
```

`compose_avec_reste_legacy` doit être 0 (la mig 218 purge) ; sinon c'est un double comptage de coût à corriger avant la phase 1. `plan_items_sans_format` dit combien d'items historiques devront recevoir leur format rétroactivement (point de vigilance A2).

## 6. Estimation et risques

| Phase | Effort | Risque | Réversible |
|---|---|---|---|
| 0 — Flux entrant | 1,5 j | Faible (UI bi-mode conservée) | Oui |
| 1 — Backfill | 1 j | Faible (idempotent, hash) | Oui (legacy non vidé) |
| 2 — Vues + lecteurs | 2 j | Moyen (récursivité, 10 fichiers) | Oui (migration inverse) |
| 3 — Suppression | 1,5 j | Faible si 0-2 validées | **Non** |

**≈ 6 j**, une phase par semaine avec observation prod entre chaque. La phase 0 et le bug du modal de lancement peuvent démarrer sans attendre le relevé §5. La branche `wip/travail-en-cours-2026-10-22` (fiches techniques 281-287 écrites en composé) est compatible : elle ne crée pas de legacy.
