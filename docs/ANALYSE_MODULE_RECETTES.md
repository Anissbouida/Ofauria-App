# Module Recettes / Fiches techniques — modèle conceptuel, architecture d'interface, fonctionnement technique

> **Date :** 2026-10-31 · **Périmètre :** tables `recipes`, `recipe_*`, `production_contenants`, `produit_profil_production` ; routes `/recipes` ; features client `features/recipes`.
> **Méthode :** lecture du schéma (contraintes, triggers, vues, fonctions), des dépôts et contrôleurs serveur, des pages et de l'API client, du diff non commité ; comptages sur la base locale. Les constats « vérifiés » ont été relus dans le code ; les autres sont marqués *(lecture)*.
> **Documents liés :** [AUDIT_FICHES_TECHNIQUES_TERRAIN.md](AUDIT_FICHES_TECHNIQUES_TERRAIN.md) (contenu des fiches), [ARCHITECTURE_LABO_DDD_VS_KALUM.md](ARCHITECTURE_LABO_DDD_VS_KALUM.md) (cible métier).

---

## 0. Synthèse exécutive

**Le module est fonctionnellement riche mais porte trois générations de modèle de données qui cohabitent, et c'est de là que viennent presque toutes les anomalies.** La composition d'une fiche existe sous trois formes : l'ancien modèle (`recipe_ingredients` + `recipe_sub_recipes`), le modèle « composants » au niveau recette (`recipe_components`, devenu miroir du format par défaut) et le modèle par format (`recipe_format_components`). Chaque lecteur (coût, besoins, interface, PDF, MRP, explosion) choisit son chemin et son ordre de repli, et chaque écrivain synchronise une partie seulement des trois. Le résultat : des coûts différents selon l'écran, des pertes de données silencieuses et un éditeur client qui recalcule le coût avec une formule différente du serveur.

**Dix points à traiter avant tout nouveau développement**, classés par gravité :

| # | Constat | Gravité | Vérifié |
|---|---|---|---|
| 1 | `PUT /recipes/:id` **efface les étapes, les sous-recettes et les emballages** quand le client ne les envoie pas (`default([])` du schéma + écriture inconditionnelle). L'import xlsx en mise à jour, qui n'envoie pas les étapes, **vide donc les procédés** de chaque fiche importée | Perte de données | ✔ |
| 2 | Les **références d'ingrédients pesés par étape** (`ingredient_refs`) sont retirées par Zod sur `POST /` et `PUT /:id` (pas de `passthrough`), alors que le lancement de production les lit. Sauvegarder une préparation depuis la page Préparation suffit à les perdre | Perte de données | ✔ |
| 3 | Le **travail en cours** (mode « par fournée / par pièce ») ne peut pas fonctionner : `identitySchema` et `createRecipeSchema` ne déclarent pas `compoParPiece`, et `validate()` remplace `req.body` par le résultat du `parse`. Le mode n'est jamais enregistré, et l'ancien bouton a été retiré de l'éditeur : il n'est plus modifiable nulle part | Fonctionnel | ✔ |
| 4 | **Trois formules de coût** : la vue par format applique la perte par ligne (`perte_pct`), la vue recette, l'explosion et le miroir ne l'appliquent pas, et le client calcule une quatrième valeur (sans perte par ligne, avec main-d'œuvre saisie). Liste, fiche, PDF, plan théorique et MRP peuvent afficher quatre coûts différents pour la même recette | Cohérence | ✔ |
| 5 | **2 500 lignes mortes** dans `RecipesPage.tsx` (3 575 lignes) : deux modales atteignables seulement par `?open=`, qu'aucun lien ne génère. L'historique des versions, la restauration, les allergènes, l'édition du type/température/minuteur des étapes et des paramètres de pâte ne sont **plus accessibles** depuis l'interface | UI | ✔ |
| 6 | **Anti-cycle partiel** : un seul CHECK d'auto-référence (mig 215), la détection applicative ne parcourt pas les formats non par défaut, aucune garde sur `recipe_format_components`. Les vues récursives s'arrêtent à 12 niveaux : un cycle ne bloque pas la base, il gonfle le coût silencieusement | Intégrité | ✔ (garde-fou 12) |
| 7 | Une recette peut basculer en mode `compose` par un format **non** par défaut sans que le miroir soit rempli ni l'ancien modèle purgé : la vue de coût recette perd ses arêtes de sous-recettes mais garde le coût direct | Cohérence | ✔ |
| 8 | **Suppression physique** de format (`DELETE /formats/:id`) et de recettes (`/bulk-delete`) alors que tout le reste est en archivage ; promotion d'un nouveau défaut sans resynchroniser le miroir | Intégrité | ✔ |
| 9 | **Propagation des prix limitée à l'ancien modèle** : `recalcParents` ne suit que `recipe_sub_recipes`, le remplacement en masse ne synchronise rien ; un changement de coût d'une base en `compose` ne remonte pas au prix produit | Cohérence | *(lecture)* |
| 10 | **Seuls 17 produits sur 345 ont une recette active en base locale** ; `recipes.product_id` (1:1) et `recipe_formats.product_id` (format vendu au POS) sont deux chemins résolus à quatre endroits différents du code | Modèle | ✔ |

---

## 1. Modèle conceptuel

### 1.1 Entités et relations

```
products ──(1:1 recipes.product_id UNIQUE)──► recipes ◄──(recipe_formats.product_id, 1 format actif / produit)── products
                                                │
              ┌─────────────────────────────────┼──────────────────────────────────┐
              │ génération 1 (2024)             │ génération 2 (mig 205/218)       │ génération 3 (mig 157/200)
              │ recipe_ingredients ──► ingredients   recipe_components              recipe_formats ──► production_contenants (nullable)
              │ recipe_sub_recipes ──► recipes       (miroir du format par défaut)      │   ├ product_id, is_default, nb_par_defaut, nb_parts
              │ (quantité = fraction de fournée)     ──► ingredients | recipes          │   ├ quantite_par_format(+unite), poids_cru_g, poids_cuit_g
              │                                                                          │   └ densite_kg_l, overrides prix / marge
              │                                                                          └── recipe_format_components ──► ingredients | recipes
              │                                                                              (role, quantite, unite, perte_pct, ordre)
              ├── recipe_packaging ──► packaging_items
              ├── recipe_versions (snapshot JSONB complet depuis mig 346)
              ├── recipe_bom_audit (triggers sur recipe_formats + recipe_format_components seulement)
              ├── recipe_bulk_replace_log (A→B sur les 3 tables, annulable)
              └── recipe_categories (classement de production, distinct des catégories commerciales)

production_contenants (etapes_defaut, categories_pertes — vides en base) ◄── produit_profil_production (etapes_surcharges, prioritaires au lancement)
recipes.etapes JSONB ──(initializeForItem)──► production_item_etapes
```

### 1.2 Attributs structurants de `recipes`
- **Rendement** : `yield_quantity` + `yield_unit` = masse ou nombre **brut** d'une fournée ; `perte_standard_pct` → net = brut × (1 − perte). `pieces_par_fournee`, `compo_par_piece` (une compo décrit une pièce ou une fournée).
- **Coût** : `mode_cout` ∈ {`ratio_poids`, `compose`}, frais indirects (`taux_main_oeuvre_dh_h`, `main_oeuvre_min`, `cout_energie_fournee`, `taux_frais_structure_pct`), `margin_multiplier`. `total_cost` est une colonne **morte** (toujours 0).
- **Procédé** : `etapes` JSONB (type, température, humidité, durée, checklist FR/AR, timer, répétition, `ingredient_refs`), `temperature_pate_cible_c`, `hydratation_pct`.
- **Cycle de vie** : `archived_at` / `archived_by` ; `contenant_id` « deprecated » depuis la mig 157 mais toujours écrit.

### 1.3 Invariants réellement garantis par la base
| Invariant | Garanti par | Trou |
|---|---|---|
| Un composant a exactement une source (ingrédient **ou** recette) | CHECK `one_source` sur les deux tables de composants | — |
| Pas d'auto-référence directe | CHECK sur `recipe_components` et `recipe_sub_recipes` | **Aucun** CHECK sur `recipe_format_components` ; cycles indirects non garantis (détection applicative partielle) |
| Un seul format par défaut par recette | index partiel `WHERE is_default` | Ne regarde pas `is_active` : un format désactivé peut rester le défaut et bloquer la promotion d'un autre |
| Un format actif par produit POS | index partiel `WHERE product_id IS NOT NULL AND is_active` | — |
| Un contenant par recette | `UNIQUE(recipe_id, contenant_id)` | Les contenants NULL (formats neutres des bases, mig 274) ne sont pas dédoublonnés |
| Quantités, pertes, rendements positifs ou bornés | CHECK | — |
| Audit des modifications de nomenclature | triggers mig 264 | Ne couvre ni `recipes`, ni le miroir, ni l'ancien modèle, ni les étapes, ni les emballages ; `create`/`update` n'écrivent pas `updated_by` → l'audit attribue au mauvais auteur |

### 1.4 Usage réel des trois générations (base locale)
| Recettes | Total | Ancien modèle | Miroir `recipe_components` | Composants par format | Formats |
|---|---|---|---|---|---|
| Actives | 52 | 33 | 16 | 16 | 22 |
| Archivées | 125 | 121 | 3 | 3 | 12 |

Les **bases** (crèmes, pâtes) vivent toujours dans l'ancien modèle ; les **produits** sont en génération 3 avec miroir. Les deux mondes se rencontrent dès qu'un produit consomme une base.

### 1.5 Jugement sur le modèle
- **Bien conçu** : le format comme unité de composition (une tarte 6 parts et un cadre 60×40 n'ont pas la même BOM), le rôle de composant, la perte par ligne, le rendement brut/net, la densité et le poids par pièce, les snapshots de version complets.
- **Dette** : le miroir `recipe_components` n'est ni une vue ni une table maître, c'est une copie que trois écrivains entretiennent à la main ; l'ancien modèle n'a jamais été migré pour les bases ; `recipes.contenant_id`, `total_cost`, `yield_unit = 'moule'` et le `produit_profil_production` sont des survivances de la génération 1.
- **Cible** (section 5) : une seule table de composition (`recipe_format_components`), un format neutre obligatoire par base, l'ancien modèle et le miroir en lecture seule puis supprimés.

---

## 2. Architecture de l'interface

### 2.1 Pages et navigation
| Route | Page (lignes) | Rôle | Conteneur |
|---|---|---|---|
| `/recipes` | `RecipesPage` (3 575) | Liste 3 onglets (produits / bases / formats-contenants), liste ou kanban, tri, filtre catégorie, archivées, sélection multiple, import/export xlsx, remplacement en masse | `ProductionLayout` → `ModuleShell` « Production », entrée « Fiches techniques » (section Paramétrage) |
| `/recipes/:id/nomenclature` | `NomenclaturePage` (105) + `NomenclatureEditor` (1 111) | Fiche produit : bandeau KPI collant (rendement, coût/pièce, prix, marge), composition **par format** (onglets), paramètres du format, coût et prix, lien POS, explosion, étapes | Pleine page, **hors** `ModuleShell` |
| `/recipes/:id/preparation` | `PreparationPage` (586) | Fiche base : fournée, perte, coût au kg net, « utilisée par », frais indirects, étapes | Pleine page, hors `ModuleShell` |

- Un clic sur une ligne ouvre la bonne page selon `is_base` ; retour par `/recipes?tab=…`. Composition, formats, étapes et explosion sont **sur une seule page** sans sous-route ni ancre.
- Rien n'empêche d'ouvrir `/nomenclature` sur une base ou `/preparation` sur un produit (affichage dégradé).
- Les pages de détail sortent de la coquille de module : perte de la navigation de rubriques, incohérent avec la règle « ModuleShell partout » appliquée aux 8 modules.

### 2.2 Gestion d'état
- React Query pour la lecture (`staleTime` 30 s), état local hydraté pour l'édition, **enregistrement explicite** (pas d'autosave, pas d'optimiste), invalidation après succès.
- `NomenclatureEditor` : empreinte `signature()` → `isDirty`, garde `beforeunload`, confirmation au changement de format. `PreparationPage` : booléen `dirty` **sans** garde de sortie.
- La sauvegarde de l'éditeur fait **deux appels non transactionnels** (`PUT …/components` puis `PATCH …/finance`) : si le second échoue, la composition est enregistrée et rien n'est invalidé.
- Erreurs : `notify.error` avec un extracteur recopié dans 6 fichiers ; `isError` jamais traité ; « introuvable » affiché pour toute erreur de chargement ; mutations de suppression/restauration sans `onError`.
- Confirmations par `confirm()` natif alors que `ConfirmDialog` existe dans le socle UI.

### 2.3 L'éditeur de composition
- Édite `recipe_format_components` du format sélectionné ; sources = bases non archivées + ingrédients (`/component-sources`, liste tronquée à **60 résultats** sans navigation clavier).
- `perte_pct` par ligne est **chargée et renvoyée mais non saisissable** (« UI dédiée en P2 »), exclue de la détection de modification et ignorée du coût client → le coût affiché diffère du `cout_dh` serveur dès qu'une ligne a une perte.
- Liste d'unités `g, kg, ml, l, cl, unit` ; une ligne en `mg`/`dl` affiche une valeur fausse ; conversion entre familles = facteur 1 avec drapeau ambre (copie de `fn_unit_conv_ok`) ; la densité du **format** n'est pas utilisée côté client.
- Lignes incomplètes **écartées sans prévenir** à l'enregistrement.
- La « perte cuisson » affichée dans la carte « Format du produit » est en réalité `perte_standard_pct` **de la recette** (partagée par tous les formats) : l'UI suggère une propriété du format qui n'en est pas une.
- Coût client recalculé en direct (matière ÷ rendement, MO = minutes saisies ou étapes × taux, énergie, structure, marge) : quatrième formule, voir §3.3.
- Grille fixe de ≈ 590 px sans défilement horizontal ; glisser-déposer HTML5 inopérant au tactile.

### 2.4 Étapes, explosion, remplacement
- `EtapesSection` (partagé) : lecture FR/darija, édition nom, durée, CQ, bloquante, checklist FR/AR, ordre. **Non éditables nulle part** : type, température, humidité, minuteur, répétitions, rôle, `ingredient_refs` (seule la modale morte le permettait). La sauvegarde via `PUT /:id/etapes` conserve ces champs (passthrough) ; celle de `PreparationPage` via `PUT /:id` les perd (§0 #2).
- `ExplosionSection` : par **recette**, pas par format (alors que l'éditeur est par format), non invalidée après sauvegarde, sans état d'erreur.
- Arbre `SubTree` en lecture seule (`/children`, miroir puis ancien modèle).
- `BulkReplaceModal` (admin) : aperçu automatique, application **sans confirmation**, n'invalide ni composants ni explosion ni arbre.

### 2.5 Code mort et doublons
- `RecipeDetailModal`, `RecipeFormModal`, `SearchableSelect` (≈ 2 500 lignes) atteignables uniquement par `?open=` que rien ne génère. Fonctions devenues invisibles : versions et restauration, allergènes, surcharges de prix par format, emballages, instructions, paramètres de pâte, édition avancée des étapes.
- `ProductionProfileTab` importé mais jamais rendu dans `ProductsPage` (seul son type sert).
- Conversion d'unités codée **trois fois** côté client (+ une SQL + une TS serveur) ; `dh()` défini dans 4 fichiers ; seuils de marge 50/30 % répétés 5 fois ; ouverture PDF codée 3 fois ; mêmes données sous plusieurs clés de cache (`contenants-list` / `contenants-active` / `contenants`, `ingredients` / `ingredients-list` / `component-sources`, `['recipes']` avec et sans `{archived}`).
- `RecipesPage` : deux boutons « Archivées », deux « Restaurer » par ligne en vue archivée, confirmation « définitive » pour une action qui archive ; deux calculs de marge différents entre kanban et liste.

---

## 3. Fonctionnement technique

### 3.1 API (`/recipes`, `authenticate` partout)
| Groupe | Routes | Rôle | Notes |
|---|---|---|---|
| Lecture | `GET /`, `/base`, `/categories`, `/component-roles`, `/component-sources`, `/:id`, `/by-product/:pid`, `/:id/children`, `/:id/explosion`, `/:id/versions`, `/:id/fiche-technique` | tous | `GET /:id` renvoie **les trois modèles** (`ingredients`, `sub_recipes`, `composition`) et `used_by` fusionné par priorité |
| Fiche | `POST /`, `PUT /:id`, `PATCH /:id/finance`, `PATCH /:id/identity`, `PUT /:id/etapes` | production | `PUT /:id` = réécriture complète (§0 #1) ; `finance` et `identity` sont des écritures ciblées sûres |
| Formats | `GET/POST /:id/formats`, `POST …/:fid/duplicate`, `PUT …/:fid`, `DELETE …/:fid`, `GET/PUT …/:fid/components` | production | `PUT …/components` = snapshot → anti-cycle (409) → remplacement → miroir si défaut → purge ancien modèle → bascule `compose` ; `DELETE` physique |
| Cycle de vie | `DELETE /:id` (archive), `POST /:id/restore`, `/bulk-archive`, `/bulk-restore`, `/bulk-delete` (physique), `/:id/versions/:n/restore` | admin / production | |
| Masse | `/bulk-replace/preview`, `…/apply`, `…/:logId/revert`, `…/logs` | admin, manager | **Sans validateur Zod** (validation manuelle) ; pas de version, pas de synchro prix, pas d'`updated_by` |
| Import | `GET /export`, `/import/template`, `POST /import/preview`, `…/commit` | admin | `commit` passe par `create`/`update` **ancien modèle** → réinjecte `recipe_ingredients` dans une recette `compose` (coût compté deux fois) et vide les étapes |

### 3.2 Qui lit quoi (ordre de repli)
| Lecteur | Source | Repli |
|---|---|---|
| Besoins de production / BSI / déduction stock / semi-finis (`getCompositionForNeeds`) | `recipe_format_components` du format demandé si `compose` | miroir `recipe_components` → ancien modèle. Le `formatId` ne s'applique **qu'au 1er niveau** ; les enfants sont lus avec `null` |
| MRP matières | `v_recipe_explosion ÷ yield_quantity` | n'utilise **pas** le helper ; diviseur ≠ celui des besoins |
| Coût recette (liste, prix synchronisé, `theo_*` du plan) | `v_recipe_total_cost` : ancien modèle + miroir | ne lit **jamais** les composants de format |
| Coût du format (éditeur, PDF en `compose`, liste des formats) | `v_recipe_component_cost` / `v_recipe_compose_cost` sur `recipe_format_components` | |
| Arbre `/children` | miroir | ancien modèle |
| PDF (liste des ingrédients des bases) | `recipe_ingredients` uniquement | vide pour une base en `compose` |
| Poids total (`v_recipe_total_weight_kg`) | ancien modèle, **un niveau**, liquides à densité 1, `unit` ignoré | 0 pour une recette `compose` |

### 3.3 Les formules de coût qui coexistent
| Lieu | Perte par ligne | Perte standard (net) | Densité | Main-d'œuvre | Emballage |
|---|---|---|---|---|---|
| `v_recipe_component_cost` (format) | ✔ | ✔ | ✔ ingrédient | — | — |
| `v_recipe_compose_cost` (format + direct) | ✔ | ✔ | ✔ | — | 1× par lancement (PDF ÷ `nb_par_defaut`, ignore `compo_par_piece`) |
| `v_recipe_total_cost` / `v_rcomp_cost` / `v_recipe_explosion` (recette) | **✗** | ✔ | ✔ | — | recette |
| `v_recipe_format_cost` (prorata poids) | ✗ | ✔ | ✔ format | Σ durées d'étapes seulement (ignore `main_oeuvre_min` et répétitions) | ✔ |
| `computeFinance` / `findByFormat` (API) | ✔ | ✔ | ✔ | `main_oeuvre_min` prioritaire | exclu |
| Client `NomenclatureEditor` | **✗** | ✔ | partielle | minutes saisies ou étapes | — |

Diviseur de lot : `nb_par_defaut` → `pieces_par_fournee` → défaut → `yield` (besoins) ; `pieces_par_fournee` d'abord (finance) ; `yield_quantity` toujours (MRP, `theo_*`), y compris en `compo_par_piece`.

### 3.4 Unités
- SQL `fn_unit_conv` : masses et volumes ; **facteur 1 pour tout le reste** (dont `unit` ↔ kg). Avec densité : poids ↔ volume. `fn_unit_conv_ok` (mig 260) ne fait que **signaler** (`conversion_ok`, `bad_conversions_count`) ; le coût n'est jamais bloqué et le drapeau n'est pas porté par les vues recette.
- TypeScript `convertQuantity` : poids ↔ volume sans densité = `uncertain: true` ; autres incompatibilités = **silencieuses** ; `mg` et `dl` reconnus comme familles mais absents des facteurs.
- Besoins : `conv_incertaine` ne regarde que les ingrédients (une sous-recette en `unit` contre un rendement en kg passe sans alerte).

### 3.5 Étapes → production
- `initializeForItem` au démarrage d'une ligne de plan : `etapes_surcharges` du profil produit si non vides, sinon `recipes.etapes` (le `etapes_defaut` du contenant n'est plus lu). Copie type, température, humidité, durée, checklist, timer, répétitions ; **ne copie ni les champs darija ni `ingredient_refs`** ; ne tient pas compte du **format** de la ligne.
- Deux schémas Zod pour la même structure : `saveEtapesSchema` avec `passthrough`, `createRecipeSchema.etapes` sans.

### 3.6 Versions, audit, transactions
- Version (snapshot complet avant modification) créée par `update`, `replaceForFormat`, `updateFinance` (hors transaction), restauration. **Pas** de version pour `saveEtapes`, `saveIdentity`, création/duplication/suppression de format, remplacement en masse, import en création.
- Restauration : re-vérifie les cycles, réapplique tout sauf `product_id` et l'archivage, désactive les formats absents de la version, erreur `NO_SNAPSHOT` avant la mig 346.
- `update` lit `findById` sur le pool et non sur le client de transaction ; `syncProductPrice` des cascades tourne hors transaction.

---

## 4. Anomalies classées

**A. Pertes de données (à corriger en premier)**
1. `PUT /:id` : `etapes`, `subRecipes`, `packaging` à `default([])`, écrits sans condition ; `category_id`, `contenant_id`, `piece_weight_kg`, T° pâte et hydratation mis à NULL s'ils sont absents.
2. Import xlsx en mise à jour → étapes et catégorie effacées, ancien modèle réinjecté dans une recette `compose`.
3. `ingredient_refs` retirés par le schéma sans `passthrough` ; de plus ils pointent vers `recipe_ingredients`, que `replaceForFormat` purge → références orphelines en `compose`.
4. `DELETE /formats/:id` et `/bulk-delete` physiques.

**B. Cohérence des coûts**
5. `perte_pct` par ligne absente de `v_recipe_total_cost`, `v_rcomp_cost`, `v_recipe_explosion` et du client.
6. Emballage compté 1× par lancement et PDF ÷ `nb_par_defaut` sans `compo_par_piece`.
7. `v_recipe_format_cost` (prorata poids) encore utilisée pour figer `theo_*` sur les plans en `compose`.
8. Bascule `compose` par un format non par défaut sans miroir ni purge.
9. Propagation des prix (`recalcParents`, `syncProductPrice`) limitée à l'ancien modèle ; remplacement en masse sans synchro.
10. Diviseurs de lot différents entre besoins, finance et MRP.

**C. Intégrité**
11. Anti-cycle partiel ; aucune garde sur `recipe_format_components`.
12. Format désactivé pouvant rester `is_default` ; promotion de défaut sans resynchroniser le miroir.
13. `updated_by` non renseigné par `create`/`update` → audit attribué au mauvais auteur ; audit aveugle sur `recipes`, miroir, ancien modèle, étapes.
14. Routes bulk-replace sans Zod.

**D. Interface**
15. 2 500 lignes mortes et fonctions devenues inaccessibles (versions, allergènes, paramètres de pâte, édition avancée des étapes).
16. Travail en cours `compoParPiece` inopérant (schémas) et mode devenu non modifiable.
17. Deux appels non transactionnels à l'enregistrement ; `PreparationPage` sans garde de sortie ; lignes incomplètes écartées sans message.
18. Explosion par recette vs éditeur par format ; caches non invalidés après remplacement en masse.
19. Pages de détail hors `ModuleShell` ; grille non responsive ; drag-and-drop non tactile ; `confirm()` natif.

---

## 5. Cible et plan de remise à plat

### 5.1 Principes
1. **Une seule table de composition** : `recipe_format_components`. Chaque base reçoit un format neutre (déjà prévu par la mig 274). `recipe_components` devient une **vue** sur le format par défaut (plus de miroir à entretenir) ; `recipe_ingredients` et `recipe_sub_recipes` migrées puis supprimées.
2. **Une seule fonction de coût** (SQL, récursive, 12 niveaux) prenant `(recipe_id, format_id)` et appliquant perte par ligne, perte standard, densité, `compo_par_piece` ; toutes les vues et le client la consomment (le client n'additionne plus, il affiche).
3. **Un seul diviseur de lot** exposé par l'API (`batch_divisor`) et utilisé par besoins, finance, MRP et `theo_*`.
4. **Écritures ciblées** : plus de `PUT /:id` global ; `identity`, `finance`, `etapes`, `formats`, `components` restent des ressources séparées. L'import passe par ces ressources.
5. **Archivage partout**, jamais de DELETE physique exposé.
6. **Une fiche = une page sous `ModuleShell`** avec onglets Composition / Formats / Procédé / Coût & prix / Historique, mêmes composants pour bases et produits (une base est un produit sans prix de vente).

### 5.2 Lots
| Lot | Contenu | Effort | Risque |
|---|---|---|---|
| **L0 — correctifs immédiats** | `compoParPiece` dans `identitySchema` + `createRecipeSchema` ; `etapeSchema.passthrough()` partout ; `updateRecipeSchema` sans `default([])` (champs absents = inchangés) ; import en mise à jour → `saveEtapes` conservées ; `temperature_c` parasite ; `is_default` retiré à la désactivation | Faible | Nul |
| **L1 — coût unifié** | fonction `fn_recipe_cost(recipe_id, format_id)` ; vues recette/explosion/format réécrites dessus ; client lit `cout_dh` serveur ; `v_recipe_format_cost` retirée du figeage `theo_*` ; diviseur unique | Moyen | Moyen (figer les `theo_*` existants) |
| **L2 — modèle unique** | migration ancien modèle → formats neutres pour les 33 bases ; miroir → vue ; anti-cycle par trigger sur `recipe_format_components` (parcours complet) ; `recalcParents` sur les composants ; audit étendu ; `updated_by` partout | Moyen-Élevé | Moyen (365 fiches en prod, à tester sur `kalum_test`) |
| **L3 — interface** | supprimer les 2 500 lignes mortes en **réintégrant** versions, allergènes, paramètres de pâte et édition avancée des étapes dans les pages vivantes ; fiche unique sous `ModuleShell` avec onglets ; saisie de `perte_pct` ; `ConfirmDialog` ; extracteur d'erreur et conversion d'unités partagés ; explosion par format ; responsive | Moyen | Faible |
| **L4 — procédé** | `initializeForItem` par format, copie darija et `ingredient_refs` (repointés sur les composants de format) ; relevés de procédé (cf. architecture labo L2) | Moyen | Faible |

L0 se fait en une demi-journée et supprime les pertes de données ; L1 et L2 sont le cœur de la dette ; L3 peut avancer en parallèle de L2 sur les composants non touchés.

### Réserve
Comptages sur la base locale (52 fiches actives), qui diffère de la production (365 fiches). Les points *(lecture)* n'ont pas été rejoués contre une base ; le plan de remise à plat doit être validé sur `kalum_test` avec les fiches de production avant toute migration.
