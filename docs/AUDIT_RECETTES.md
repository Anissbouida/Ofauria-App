# Audit du module Recettes

*Audit réalisé le 14/07/2026 — périmètre : backend (routes/contrôleurs/repositories/validateurs/import Excel), modèle de données (migrations 005→227, vues de coût), frontend (RecipesPage, NomenclatureEditor, NomenclaturePage, RecipeImportModal).*

---

## Synthèse

Le module fonctionne mais porte la dette de **trois refontes successives jamais nettoyées** : la composition d'une recette vit dans 4 tables en parallèle (`recipe_ingredients`/`recipe_sub_recipes` legacy, `recipe_components`, `recipe_format_components`), le calcul de coût existe en **7 implémentations** (3 côté serveur, 4 côté client) qui peuvent diverger, et les invariants métier (un format par défaut actif, pas de doublon, pas de cycle, unités valides) ne sont garantis que par du code applicatif et des migrations réparatrices — pas par la base.

Deux bugs **critiques** sont corrigibles immédiatement :

1. **`PUT /recipes/:id` remet le prix de vente du produit à 0** pour toute recette en mode `compose` (le calcul JS de `totalCost` ignore `recipe_components`, et le client n'envoie jamais `salePrice`).
2. **Aucune route recettes n'est enveloppée dans `asyncHandler`** (Express 4) : toute erreur DB non catchée laisse la requête HTTP suspendue jusqu'au timeout (504 Cloud Run) au lieu d'un code d'erreur propre.

Points forts à préserver : gestion React Query exemplaire dans `NomenclatureEditor` (invalidations complètes, protection de course commentée), import Excel en 2 phases preview→commit, requêtes SQL 100 % paramétrées, AuthZ cohérente (lecture=authentifié, mutation=PRODUCTION, delete/import=ADMIN), types monétaires en `NUMERIC` partout.

---

## 1. Bugs à corriger en priorité (backend)

### CRITIQUE

**B1. Prix produit écrasé à 0 en mode composé** — `recipe.repository.ts:616-648` + `:755-764`
Le `totalCost` de `update()` est calculé uniquement depuis `data.ingredients`/`subRecipes`/`packaging` du payload. Pour une recette `compose` (tables legacy purgées par `replaceForFormat`), le formulaire renvoie des tableaux vides → `totalCost=0` → `syncProductPrice` fait `UPDATE products SET cost_price=0, price=0`. Chaque sauvegarde des métadonnées d'une recette-produit composée remet le prix à 0.
→ **Reco** : utiliser `computeFullCost()` (la vue `v_recipe_total_cost` gère legacy + composé), ou ne pas appeler `syncProductPrice` quand `mode_cout='compose'` sans composition dans le payload.

**B2. Pas d'`asyncHandler` sur `recipes.routes.ts`** (tout le fichier, l. 28-71)
Express 4 ne rattrape pas les promesses rejetées : erreur PG (`GET /recipes/abc` → 22P02, DELETE d'une recette référencée → FK RESTRICT) = requête pendante, jamais transmise à `errorHandler`. Le middleware existe et est utilisé ailleurs (`bon-sortie.routes.ts`).
→ **Reco** : envelopper chaque handler, + valider les params UUID (`z.string().uuid()`) pour renvoyer 400 au lieu de 22P02.

### MAJEUR

**B3. Defaults zod sur l'update partiel** — `recipe.validator.ts:68`
`updateRecipeSchema.partial({ ingredients: true })` ne neutralise que `ingredients` : un PUT qui omet un champ reçoit son `.default()` (marge→3, `etapes`→`[]`, `subRecipes`→`[]`…). Conséquence : les sous-recettes legacy, `recipe_packaging` et `etapes` sont wipés silencieusement sur un PUT partiel ; le contrat « le formulaire n'envoie que les métadonnées » ne tient que parce que le client envoie tout.
→ **Reco** : vrai schéma partiel sans defaults + ne toucher chaque table enfant que si la clé est présente.

**B4. `deleteFormat` = DELETE physique** — `recipe-component.repository.ts:531-556`
`recipe.repository.update()` a été converti en soft-delete précisément parce qu'un DELETE de `recipe_formats` référencé par un `production_plan_items` historique viole `uq_plan_item_product_legacy`. `deleteFormat` refait le DELETE brut → 500 sur tout format historisé. Le miroir `recipe_components` n'est pas non plus resynchronisé si le format supprimé était le défaut.
→ **Reco** : aligner sur `is_active=false` + resync du miroir.

**B5. `duplicateFormat` désynchronise le miroir** — `recipe-component.repository.ts:468-513`
L'upsert peut écraser la BOM d'un format déjà `is_default` sans resynchroniser `recipe_components` (contrairement à `replaceForFormat`) → `v_recipe_total_cost` et le calcul des besoins divergent. Pas de `detectComponentCycle` sur ce chemin non plus.

**B6. Import commit non transactionnel** — `recipe-import.controller.ts:670-994`
La docstring promet une transaction ; en réalité chaque recette est dans sa propre transaction. Échec au milieu = import partiel avec HTTP 200 `success:true`. Aussi : ré-importer une recette `compose` réinsère du legacy dans `recipe_ingredients` → **double comptage** dans `v_recipe_compose_cost`.
→ **Reco** : statut distinct si `errors.length>0`, bloquer l'update de composition des recettes `compose` à l'import.

**B7. `xlsx` 0.18.5 vulnérable** (CVE-2023-30533 prototype pollution, CVE-2024-22363 ReDoS) sur un buffer uploadé. Atténué par ADMIN-only + 5 Mo.
→ **Reco** : migrer vers SheetJS ≥ 0.20.2 (canal officiel) ou `exceljs`.

### MINEUR

- `listSources` : division par zéro possible si `perte_standard_pct=100` (`recipe-component.repository.ts:104`, ajouter `NULLIF`).
- Détection de cycle par `err.message?.includes('circulaire')` (`recipe.controller.ts:33,53`) — utiliser un `err.code` comme le fait déjà `recipe-component.controller.ts`.
- `updateFormat` : impossible de remettre `nb_parts`/`contenantId` à NULL (`COALESCE` = « pas de changement »).
- `createFormat` : course possible sur `is_default` (SELECT count puis INSERT sans transaction) ; l'`ON CONFLICT DO UPDATE SET is_active=true` réactive l'ancienne ligne en **perdant les valeurs du payload**.
- Upload : filtre par extension seulement, rejet silencieux (« Aucun fichier envoye ») ; `LIMIT_FILE_SIZE` → 500 au lieu de 413.
- `hadError` jamais assigné dans `recipe-import.controller.ts:399,421` (code mort).
- Rôle `BELDI_SALE` dans ROLE_GROUPS.PRODUCTION peut modifier recettes et marges — à confirmer fonctionnellement.
- Incohérences HTTP : cycle legacy→400 vs cycle composé→409 ; DELETE d'une recette inexistante→200.

---

## 2. Modèle de données

### Le problème de fond : composition en 4 tables, miroir applicatif

Le miroir `recipe_format_components` (format défaut) ↔ `recipe_components` est maintenu par double écriture dans `replaceForFormat` uniquement. Aucun trigger ni contrainte ne garantit la synchro — le script `audit-cycles-recettes.sql` existe précisément parce que la désynchro se produit. Le niveau d'accrochage de la BOM a changé **3 fois** en 20 migrations (202→205→218).
→ **Reco** : choisir UN niveau canonique (le format par défaut, direction de la mig 218), l'autre devient vue ou trigger ; puis migration de nettoyage (drop `recipe_sub_recipes` une fois les recettes de base migrées).

### Contraintes manquantes (sévérité HAUTE)

| Manque | Risque | Reco |
|---|---|---|
| Pas d'UNIQUE sur `recipe_components(recipe_id, source_*)` ni `recipe_format_components(format_id, source_*)` | Le scénario mig 174 (398 doublons, coûts ×2/×3) peut se reproduire | Index uniques partiels |
| `unite` VARCHAR libre, `fn_unit_conv` retourne **1 en silence** pour unité inconnue | Coût faux sans erreur | CHECK sur liste fermée |
| `recipes.etapes` JSONB non validé, casté `::numeric` dans `v_recipe_format_cost` | Une valeur non numérique **casse la vue à la lecture** pour toute la table | CHECK `jsonb_typeof` ou table normalisée |
| « Exactement un `is_default` actif » non garanti (index partiel = *au plus un*, pas *un actif*) | Migrations réparatrices 218-C/221/222/223, deux corruptions déjà survenues | Étendre l'index à `WHERE is_default AND is_active` + trigger de repromotion |
| `UNIQUE(recipe_id, contenant_id)` sur `recipe_formats` | Interdit 2 formats sur le même moule, force le hack upsert de `createFormat` | Revoir la contrainte |
| Index FK manquants : `recipe_ingredients.ingredient_id`, `recipe_components.source_recipe_id/source_ingredient_id`, `recipe_versions.changed_by` | Seq scans sur DELETE RESTRICT et recalculs | Migration d'index |

### Anti-cycle : incomplet (HAUTE)

- En base : seulement l'auto-référence directe (CHECK mig 215). Pas de trigger pour les cycles indirects.
- `detectComponentCycle` (correct, mode-aware) n'est appelé **que** dans `replaceForFormat` — pas dans `duplicateFormat` ni l'import.
- `detectCycle` legacy ne parcourt que `recipe_sub_recipes` (un cycle mixte compose/ratio_poids passe) et **n'a ni limite de profondeur ni suivi de chemin** : sur un cycle existant en base, la CTE boucle indéfiniment.
- Filets aval : `v_recipe_total_cost` tronque à depth<12 **en silence** → coût sous-estimé sans alerte.
→ **Reco** : constraint trigger déféré sur les deux tables d'arêtes + fix de `detectCycle` + exposer un flag `depth_tronque` dans la vue.

### Vues de coût : 10 vues, 6 générations, 4 incohérences actives

1. `v_recipe_component_cost` (203) n'a **pas** été rebranchée sur la densité en 227 (contrairement à `v_rcomp_cost`) → la page composition et la page format affichent **deux coûts différents** pour un ingrédient poids↔volume.
2. Les vues de poids `v_recipe_*_weight_kg` (143, jamais retouchées) ignorent `recipe_components` → **poids faux/vide pour tout produit composé**, alors que `v_recipe_format_summary` et le backfill 157 s'appuient dessus.
3. `v_recipe_format_cost` ne connaît pas `main_oeuvre_min` (213) : MO de la vue = étapes JSONB, MO du service = `COALESCE(main_oeuvre_min, étapes)` → deux prix « calculés » possibles.
4. `listFormats` mélange `cout_compose_dh` (une vue) et `prix_vente_unitaire` (une autre) → prix affiché qui ne dérive pas du coût affiché.
→ **Reco** : migration « alignement vues » (densité partout, poids sur le graphe unifié, `main_oeuvre_min` dans la vue format), et supprimer `v_recipe_compose_cost`/`v_recipe_component_cost` au profit de `v_rcomp_cost`.

### Versioning (mig 041) : décoratif (HAUTE)

Le snapshot ne capture ni `recipe_components`, ni les formats, ni `mode_cout`, ni les leviers finance ; il n'est écrit que par `recipe.repository.update()` — pas par `replaceForFormat`, `updateFinance`, `updateFormat` ni l'import. Pour une recette composée (la norme depuis 217), l'historique est vide ou trompeur. Le `total_cost` snapshotté est la colonne morte de 005. `MAX(version_number)+1` sans verrou.
→ **Reco** : soit fonction SQL `fn_snapshot_recipe(id)` appelée par tous les chemins d'écriture, soit retirer la feature de l'UI plutôt qu'exposer un historique faux.

### Nettoyage legacy à planifier (MOYENNE)

- `recipes.total_cost` : mort depuis mig 120, encore snapshotté → DROP.
- `recipes.contenant_id` : déprécié depuis 157 (« sera retiré »), encore SELECTé partout → DROP planifié.
- Overrides mig 168 (`*_override`) : doublon de concept avec la BOM par format + `nb_parts` → consolider.
- `quantite_par_format_g` mal nommée (contient des kg/ml/l depuis 162) → renommer.
- Hard DELETE de `recipes` + CASCADE sur `recipe_versions` = perte d'historique → `is_active` sur `recipes`.
- Le coût d'hier n'est reconstructible nulle part (seul `production_cout_reel` fige quelque chose) → décider explicitement : snapshot périodique ou assumer.
- `v_recipe_total_cost` recalcule le graphe complet à **chaque affichage de la liste** (jointe dans `findAll`) : O(N recettes × profondeur) → vue matérialisée rafraîchie sur trigger quand le catalogue grossit.
- `shared/src/types/recipe.types.ts` très en retard sur le schéma (pas de `modeCout`, `isDefault`, `nbParts`, composition, catégories).

---

## 3. Frontend — ergonomie et design

### Le chantier n°1 : deux éditeurs concurrents

Ouvrir une recette suit deux chemins selon `is_base` : modal legacy (`RecipeFormModal`, onglets + « Formats de production » + « Aperçu Coûts ») vs page nomenclature plein écran — deux vocabulaires pour les mêmes concepts. Mais le bouton **« Nouveau » ouvre toujours le vieux modal**, y compris pour un produit composé : créer un produit = remplir le modal → sauver → rouvrir → recréer un format → composer (8-10 clics, deux modèles mentaux). L'« Aperçu Coûts » du modal ne s'affiche qu'**après sauvegarde**, alors que `NomenclatureEditor` calcule en live.
→ **Reco** : pour les produits finis, « Nouveau » crée une coquille minimale (nom + catégorie + produit) puis redirige vers `/recipes/:id/nomenclature` ; retirer du modal les sections formats/coûts redondantes.

### Critiques UX

- **Perte de saisie** : un clic franc sur le fond ferme le formulaire de création/édition sans confirmation (pas d'état dirty) ; « Annuler » de `NomenclatureEditor` quitte aussi sans garde-fou. → tracker un flag dirty + confirmation (quick win, défaut n°1 pour un utilisateur labo).
- **Zéro responsive** : aucune `@media` query dans le CSS, grids fixes, cibles tactiles 24-32 px. Si l'usage tablette en labo est visé, c'est un chantier ; sinon documenter « desktop only ».
- **Suppression anonyme** : `confirm('Supprimer cette recette ?')` natif sans le nom de la recette. → inclure le nom, puis modal maison.

### Majeurs UX/design

- **Pas de suppression de format dans l'UI** alors que `recipesApi.deleteFormat` existe déjà — un format créé par erreur reste à vie. → bouton corbeille (quick win, mais corriger B4 d'abord).
- **Entorses à la règle unité-saisie** : `deriveFromContenant` convertit automatiquement g↔kg au seuil 1000 (« 600 g » peut devenir « 0.60 kg »). → conserver l'unité sélectionnée dans la ligne.
- **Trois systèmes visuels** dans le même module : liste odoo-*, form modal Tailwind pastel ad hoc, import modal vert émeraude sans `ModalBackdrop` ni Échap. → aligner l'import modal (quick win), absorber le form modal au fil du chantier n°1.
- **Formatage monétaire** : `toFixed(2) + ' DH'` répété ~60 fois, pas de séparateur de milliers, point décimal. → `utils/money.ts` avec `Intl.NumberFormat('fr-MA', …)`.
- **Pas de filtre « à corriger »** alors que la pastille d'état (compo vide / rendement à définir) existe. → chip de filtre (quick win).
- Seuils de marge 30/50 % codés en dur à 6 endroits ; kanban colore par *marge*, liste colore par *santé des données* — deux sémantiques pour le même signal.

### Technique React

- **`RecipesPage.tsx` = 2 923 lignes** (liste + `RecipeDetailModal` ~680 l. + `RecipeFormModal` ~1 400 l. + `SearchableSelect` générique). → découpage mécanique en 4 fichiers, sans changement de logique.
- **17 `setState` dans le corps du composant** pour initialiser le formulaire d'édition (`RecipesPage.tsx:1596-1664`) — fragile (refetch ignoré, double rendu). `NomenclatureEditor` fait la version propre en `useEffect`. → aligner.
- **`Record<string, any>` sur list/getById** (~80 casts inline) alors que la moitié nomenclature de la même API est bien typée. → exporter `RecipeListItem`/`RecipeDetail` depuis `recipes.api.ts`.
- **Conversion d'unités dupliquée 3×** côté client (RecipesPage, NomenclatureEditor, `utils/units.ts` incomplet) et **calcul de coût 4×** (détail, form modal, liste, nomenclature). → centraliser conversions dans `utils/units.ts` ; à terme, le serveur seule source des coûts affichés, calcul client réservé au live-preview.
- Erreurs de *lecture* non gérées : échec réseau sur la liste affiche « Aucune recette trouvée » (faux message). → bandeau d'erreur commun.
- Extracteurs d'erreur dupliqués (2 versions + `api-error.ts` existant). `SourcePicker` tronque à 60 résultats sans l'indiquer. Import : bandeau vert « Import terminé » même avec des erreurs par ligne ; pas de lien vers les éléments créés.
- Accessibilité de base : lignes cliquables sans clavier, tri sans `aria-sort`, toggle sans rôle switch, `SourcePicker` sans navigation clavier.

---

## 4. Tests

**Testé** : uniquement `recipe-composition.helper.ts` (13 tests, DB stubbée — formule legacy, diviseurs fournée/pièce, densité, cycles, fallback).
**Non testé** : `recipe.repository` (create/update/versioning/`syncProductPrice`/cascades), `recipe-component.repository` (`replaceForFormat` + miroir, `computeFinance`, CRUD formats), `recipe-excel.service` (parseur **pur**, idéal à tester : normalisation d'unités, virgule décimale — zéro test), l'import, les contrôleurs (codes HTTP, AuthZ). Les bugs B1 et B3 auraient été attrapés par un test d'intégration du PUT.

---

## 5. Plan d'action priorisé

### Lot 1 — Correctifs immédiats (quelques jours)
1. B1 : coût via `computeFullCost()` dans `update()` (arrête l'écrasement des prix).
2. B2 : `asyncHandler` sur toutes les routes + validation UUID des params.
3. B4 : `deleteFormat` en soft-delete + câbler le bouton de suppression de format dans l'UI.
4. B3 : schéma d'update sans defaults.
5. UX : garde-fou dirty sur les modales + confirm nommé.

### Lot 2 — Intégrité en base (1 migration + 1 trigger)
6. Migration « contraintes » : UNIQUE composants, CHECK unités, CHECK etapes, index FK, invariant « un défaut actif ».
7. Trigger anti-cycle sur `recipe_components` + `recipe_sub_recipes` ; fix `detectCycle` (depth/path).
8. Migration « alignement vues » : densité dans `v_recipe_component_cost`, vues de poids sur le graphe unifié, `main_oeuvre_min` dans `v_recipe_format_cost`.

### Lot 3 — Consolidation (chantiers)
9. UX : « Nouveau produit » → redirection directe vers la nomenclature ; dégraisser le modal legacy.
10. Découpage de `RecipesPage.tsx` + typage de l'API + centralisation unités/monnaie.
11. Décision versioning : `fn_snapshot_recipe()` partout, ou retrait de la feature.
12. Nettoyage legacy : DROP `total_cost`, `contenant_id`, `recipe_sub_recipes` (après migration des bases), renommages, suppression des vues transitoires.
13. Mise à jour `xlsx` ; tests d'intégration sur le PUT et le parseur Excel.

### À décider (fonctionnel)
- Usage tablette en labo → conditionne le chantier responsive.
- Rôle `beldi_sale` autorisé à modifier recettes/marges ?
- Historisation des coûts : snapshot périodique ou `production_cout_reel` fait foi ?
- Deux formats sur le même contenant : besoin réel ? (conditionne la contrainte UNIQUE).
