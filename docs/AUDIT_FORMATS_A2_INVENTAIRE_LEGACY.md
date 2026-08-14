# Audit Formats — A2 (P1) : inventaire des lecteurs legacy

*Livré le 14/08/2026 — préparation à la fin de bascule des 3 sources de nomenclature identifiée dans [AUDIT_FORMATS_PRODUCTION.md](AUDIT_FORMATS_PRODUCTION.md) §A2. Cet inventaire ne modifie AUCUN code — il chiffre le boulot restant pour solder la dette.*

---

## Contexte

Le module vit avec **trois sources concurrentes** pour la même chose (« la BOM d'une recette »):

| Source | Rôle actuel | Consommateurs |
|---|---|---|
| `recipe_ingredients` (496 lignes) + `recipe_sub_recipes` (91 lignes) | Legacy pré-BOM par format. Historiquement l'unique modèle ; source primaire pour les recettes en `mode_cout = 'ratio_poids'` (**118 sur 147**). | Vues `v_recipe_direct_cost`, `v_recipe_direct_weight_kg`, `v_recipe_total_cost`, `v_recipe_total_weight_kg` + `recipe.repository`, `inventory.repository`, `production-cout.repository`, `recipe-composition.helper`, `recipe-component.repository` (fallback lecture), `controllers/reports`, `controllers/recipe-import`, `controllers/ingredient-import`. |
| `recipe_components` (104 lignes) | Miroir du format par défaut pour les recettes en `mode_cout = 'compose'` (**29 sur 147**). Alimenté par `recipe-component.repository.replaceForFormat` quand le format touché est `is_default = true`. | Lu par `v_recipe_total_cost` (branche `compose`) et par `recipe-composition.helper.getCompositionForNeeds` en fallback quand aucun `format_id` n'est fourni. |
| `recipe_format_components` (117 lignes) | **Source de vérité** de la nouvelle BOM. Lu par `v_recipe_component_cost`, `v_recipe_compose_cost` (mig 265) et par le helper de composition quand `format_id` est passé. | Écrit uniquement par `recipe-component.repository.replaceForFormat` / `duplicateFormat`. |

`recipes.contenant_id` est déjà à **NULL partout** (0 sur 147) : la première marche du soft-delete a été faite, il ne reste que la colonne à retirer.

---

## Inventaire détaillé des lecteurs

### 1. Vues SQL

| Vue | Ligne | Ce qu'elle lit | Note |
|---|---|---|---|
| `v_recipe_direct_cost` | `recipe_ingredients ri JOIN ingredients ing` | Coût matière propre d'une recette (`ri.quantity × ing.unit_cost + recipe_packaging`). | Source primaire de tous les calculs de coût. Lue par `v_recipe_total_cost`, `v_recipe_format_cost`, `v_recipe_compose_cost`. |
| `v_recipe_direct_weight_kg` | `recipe_ingredients ri JOIN ingredients ing` | Poids matière propre d'une recette. | Source de `v_recipe_total_weight_kg`. |
| `v_recipe_total_cost` | `recipe_sub_recipes rsr` (branche `ratio_poids`) + `recipe_components c` (branche `compose`) | Coût total d'une recette (matière + composants récursifs). | Recette LIVE la plus lue de l'app. Récursive (mig 204, profondeur ≤ 12). |
| `v_recipe_total_weight_kg` | `recipe_sub_recipes rsr` | Poids total d'une recette. | Utilisé par `v_recipe_format_summary` pour le contrôle poids engagé vs produit. |

**Toutes les 4 doivent être refondues** pour lire uniquement `recipe_format_components` (via le format par défaut) après bascule.

### 2. Code serveur — écritures

| Fichier | Ligne | Opération | Statut |
|---|---|---|---|
| `recipe.repository.ts` | 385 | `INSERT INTO recipe_ingredients` (create) | À remplacer par `replaceForFormat(format_id_defaut)`. |
| `recipe.repository.ts` | 403 | `INSERT INTO recipe_sub_recipes` (create) | Idem. |
| `recipe.repository.ts` | 672, 675 | `DELETE + re-INSERT recipe_ingredients` (update recette) | Idem. |
| `recipe.repository.ts` | 683, 692 | `DELETE + re-INSERT recipe_sub_recipes` (update recette) | Idem. |
| `recipe-component.repository.ts` | 299, 300 | `DELETE recipe_ingredients / recipe_sub_recipes` lors de bascule vers `compose` (mig 218) | À supprimer une fois la bascule totale. |
| `recipe.repository.ts` | ~750 | Setter `contenant_id` sur `recipes` | Colonne à droper. |

### 3. Code serveur — lectures

| Fichier | Rôle | Effort |
|---|---|---|
| `recipe.repository.ts:127, 141, 208, 224, 233` | `findById` / `findAll` retournent la composition telle qu'elle vit dans les 2 tables legacy pour l'ancien éditeur (celui d'avant `NomenclatureEditor`). | Faible si l'ancien éditeur n'a plus de client. À vérifier. |
| `inventory.repository.ts:353, 386, 491` | Recherche « quelles recettes utilisent cet ingrédient » (impacts d'un rappel fournisseur, calculs de stock). | **Sensible.** Doit être ré-écrit pour interroger `recipe_format_components.source_ingredient_id` union `recipe_components`. |
| `production-cout.repository.ts:369, 459` | Calcul du coût réel d'un plan clôturé (agrège ingrédients consommés depuis les recettes). | Se croise avec A6b (snapshot du coût prévu au lancement). Une fois la bascule faite, lecture depuis `recipe_format_components` + `format_id` du plan item. |
| `recipe-composition.helper.ts:154, 161` | Fallback ultime `getCompositionForNeeds` pour les recettes en `ratio_poids` sans BOM composée. | Suppression PURE après bascule — c'est le fallback qui devient inutile. |
| `recipe-component.repository.ts:192, 211, 409, 421` | Fallback UI (montrer la composition legacy quand la BOM par format n'est pas encore saisie). | Suppression après bascule. |
| `controllers/reports.controller.ts:272, 451` | Rapports de consommation ingrédients. | Ré-écrit sur `recipe_format_components`. |
| `controllers/recipe-import.controller.ts:351, 521, 356, 531` | Import xlsx : lit la composition existante pour un « diff avant/après ». | Ré-écrit ; l'écriture doit basculer sur `replaceForFormat`. |
| `controllers/ingredient-import.controller.ts:261` | Recherche récettes impactées par un renommage d'ingrédient. | Idem `inventory.repository`. |
| `scripts/resync-recipe-product-prices.ts:4` | Script batch de re-synchro de prix. Commentaire mentionne `recipe_ingredients`. | Vérifier si encore utilisé. |

### 4. Validateur

`server/src/validators/recipe.validator.ts:52` — commentaire mentionne `recipes.contenant_id` comme « compat descendante ». La colonne peut être retirée du schéma d'entrée sans casse observable côté client.

---

## Plan de bascule proposé (3 phases, ~5 j·h chacune)

### Phase 1 — Backfill : `ratio_poids` → `compose` (118 recettes)

Migration idempotente qui, pour chaque recette en `ratio_poids` :
1. Crée un format par défaut s'il n'existe pas déjà (utiliser le contenant générique de la mig 201 si aucun n'est disponible).
2. Insère dans `recipe_format_components` une ligne par ligne de `recipe_ingredients` et `recipe_sub_recipes` (avec conservation de `unit`, `quantity`).
3. Passe `mode_cout = 'compose'` sur la recette.

**Contrôle de neutralité** : hash `md5(SUM(cout_unitaire_complet) OVER format_id)` avant/après backfill. Doit rester identique — sinon rollback et diagnostic.

Livrable : **1 migration** + **1 script de vérification post-mig** (compare les coûts, remonte les recettes divergentes).

### Phase 2 — Refonte des vues de coût

Les 4 vues (`v_recipe_direct_cost`, `v_recipe_direct_weight_kg`, `v_recipe_total_cost`, `v_recipe_total_weight_kg`) lisent désormais **exclusivement** `recipe_format_components` du format `is_default`, en composant récursivement.

**Contrôle** : refaire le hash après refonte, doit rester identique.

Attention à la récursivité : `v_recipe_total_cost` est déjà récursive (mig 204) — la nouvelle version doit conserver le garde-fou `MAX_DEPTH 12`.

Livrable : **1 migration** (DROP CASCADE + CREATE des 4 vues + toutes les vues dépendantes recréées à l'identique, ~200 lignes SQL).

### Phase 3 — Suppression du legacy

1. Supprime `recipe_components` (miroir devenu inutile).
2. Retire la synchronisation du miroir dans `recipe-component.repository.ts:297-310`.
3. Retire les fallbacks legacy dans `recipe-composition.helper.ts` et `recipe-component.repository.ts` (les blocs commentés « FALLBACK legacy »).
4. Refactorise les 10 fichiers `.ts` listés en §3 pour lire `recipe_format_components`.
5. `DROP TABLE recipe_ingredients, recipe_sub_recipes`.
6. `ALTER TABLE recipes DROP COLUMN contenant_id`.
7. Adapte le validateur `recipe.validator.ts` et les schémas Zod exposés.

Livrable : **1 migration** de drop + **~15 modifications** de fichiers TS.

---

## Points de vigilance

**Recettes en `ratio_poids` sans format** — 118 recettes ratio_poids × plusieurs formats potentiels : la Phase 1 doit gérer le cas où plusieurs contenants historiques sont mentionnés dans `produit_profil_production` ou dans les plans historiques. Ne créer qu'UN format par défaut ; le multi-format viendra à la saisie.

**Tests** — `server/src/__tests__/recipe-composition.test.ts` a 13 tests. Ils doivent tous rester verts après chaque phase, comme filet de sécurité minimum.

**Historique** — `production_plan_items` référence `format_id`. Après la Phase 1, les items historiques (aujourd'hui `format_id NULL`) doivent voir leur format assigné rétroactivement pour que `v_plan_item_rendement` continue de fonctionner. La mig 261 (snapshot A6b) fige déjà le coût théorique par item — les items déjà snapshottés n'ont plus besoin des vues live pour leur historique.

**Coordination avec A6b** — le snapshot A6b (mig 261) lit `v_recipe_total_cost` pour les items sans `format_id`. Une fois la Phase 2 terminée, le snapshot lira toujours la même vue, mais qui lira désormais `recipe_format_components`. Aucune adaptation nécessaire côté A6b.

---

## Estimation totale

| Phase | Effort | Risque | Réversibilité |
|---|---|---|---|
| 1 — Backfill | ~1 j·h + tests neutralité | Faible (transactionnel + hash) | Trivial (rollback DELETE) |
| 2 — Refonte vues | ~2 j·h | Moyen (récursivité, dépendances) | Possible via migration inverse |
| 3 — Drop legacy | ~2 j·h | Faible si Phases 1-2 validées | **IRRÉVERSIBLE** (drop des données) |

**Total : ~5 j·h** répartis sur 2 semaines conseillé (1 j·h/semaine + observation prod entre chaque phase). Aucune dépendance externe.

Aucune fenêtre de maintenance requise : chaque phase est backward-compatible tant que la précédente est validée en prod. La seule opération non-instantanée est le DROP CASCADE final (Phase 3, quelques secondes sur les 4 vues).
