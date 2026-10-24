# Audit — Production & Fiches techniques (regard métier boulangerie / pâtisserie / viennoiserie)

Date : 2026-10-23 · Branche : `claude/audit-production-fiches-techniques-17020b` (dérivée de `main`, dernier commit `9ce3560`)
Périmètre : `server/src/{controllers,repositories,routes}/production*`, `bon-sortie*`, `stock-frigo*`, `recipe*`, migrations `recipe_*` / `production_*`, `client/src/features/{production,recipes}`.

---

## 0. Avertissement préalable : ce que cette branche ne contient pas

Les migrations présentes sautent de **269 à 318**. Tout l'intervalle **270-317 est absent** ici. Cela veut dire que les travaux suivants, connus par ailleurs, **ne sont pas dans le code audité** :

- catalogue des 365 fiches techniques (280-290) et import masterclass avec champs darija (291-303) ;
- correctif du coût densité `v_recipe_component_cost` (288/289) ;
- lots de production / verrous (298, 313, 333) et modules prioritaires (314-317).

Conséquence : plusieurs manques listés ci-dessous sont peut-être déjà traités sur une autre branche. **Le premier risque technique est donc la divergence des branches** : des numéros de migration sont réutilisés (ex. 333 renumérotée 337 pour la traçabilité) et la base locale a déjà cassé sur 266. Avant de livrer quoi que ce soit, fusionner et renuméroter.

---

## 1. Verdict global

| Module | Couverture fonctionnelle | Fiabilité | Verdict |
|---|---|---|---|
| **Fiches techniques** | Riche sur le **coût** (matière, MO, énergie, structure, marge, formats, nomenclature récursive), **pauvre sur le procédé** : une fiche technique de boulanger n'est pas modélisée. | Coût faux en silence dès qu'une ligne mélange poids et volume. | Outil de **costing**, pas encore une fiche technique de laboratoire. |
| **Production** | Très complet sur le **flux magasin** (BSI, FEFO, prélèvement, transferts). Chaînon manquant sur le **flux fournil** (four, pousse, capacité) et sur le **bouclage stock** (frigo, emballages, écarts). | **2 bugs bloquants** confirmés sur la remise en brouillon ; aucun test. | Solide pour sortir la matière, fragile pour piloter la fabrication et fermer la boucle. |

---

## 2. Fiches techniques — manquements MÉTIER

Ce qu'un chef de laboratoire attend d'une fiche, et ce que le modèle stocke réellement (`recipes`, mig 005 → 266).

### 2.1 Aucun paramètre de procédé structuré (P0 métier)

Les étapes (`recipes.etapes` JSONB, mig 093) ne portent que : `ordre, nom, duree_estimee_min, est_bloquante, timer_auto, controle_qualite, checklist_items, est_repetable, nb_repetitions, responsable_role` ([EtapesPanel.tsx:22-39](../client/src/features/production/EtapesPanel.tsx:22)).

Tout le reste est **du texte libre dans `nom`** — les seeds le prouvent : `"Apprêt — armoire fermentation 26°C / 75% HR"`, `"Cuisson 240°C — 18 min"` ([115_seed_recipes_croissante_baguettes.sql:97-101](../server/migrations/115_seed_recipes_croissante_baguettes.sql:97)). Donc **ni requêtable, ni contrôlable, ni affichable sur un écran four**.

Champs absents, par ordre d'importance pour le métier :

| Paramètre | Pourquoi c'est indispensable | État |
|---|---|---|
| **Température + durée de cuisson** (four à sole / ventilé, buée) | C'est la ligne la plus lue de toute fiche ; sans elle pas de planning four ni d'écran de cuisson | texte libre |
| **Température de pâte cible** (24-26 °C) + T° de base pour calcul d'eau | Pilote la fermentation ; un pétrissage sans T° cible n'est pas reproductible | absent |
| **Taux d'hydratation / pourcentage boulanger** | Le langage universel du fournil ; permet de rescaler une pâte sans erreur | absent |
| **Pointage / apprêt / pousse** (durée, T°, HR, pousse contrôlée nuit) | Détermine le planning J-1 ; la viennoiserie en dépend totalement | texte libre |
| **Repos / détente / tourage** (nb de tours, temps froid) | Feuilletage, pâte à croissant | texte libre |
| **Allergènes de la recette** | Obligatoire sur étiquette ; existe sur `ingredients.allergens` (mig 004) mais **jamais agrégé** au niveau recette/produit | absent |
| **DLC / conservation / T° de stockage** de la recette | Nécessaire à l'étiquette et au frigo ; seul `products.shelf_life_days` existe | absent |
| **Matériel** (pétrin, laminoir, cercle Ø, moule, plaque, four) | Capacité et séquencement ; seul le `contenant` existe | absent |
| **Photo de la recette / du montage** | L'éditeur renvoie à « Photo via la fiche produit » ([NomenclatureEditor.tsx:670](../client/src/features/recipes/NomenclatureEditor.tsx:670)) | emprunté |

### 2.2 Rendement de cuisson amorcé puis abandonné

`poids_cru_g` / `poids_cuit_g` existent sur `recipe_formats` (mig 199), sont saisissables, mais **la perte de cuisson n'est jamais calculée** ni réutilisée. Une pâtisserie perd 10-20 % au four : cette donnée est la base du coût au gramme vendu et elle dort.

### 2.3 Gestion documentaire incomplète

- **Versioning** ([recipe.repository.ts:595](../server/src/repositories/recipe.repository.ts:595)) ne snapshote que le legacy (`ingredients`, `sub_recipes`) : une recette en mode composé donne une version **vide**. Étapes, frais indirects et BOM par format ne sont pas versionnés. Pas de restauration ni de diff.
- **Pas d'archivage** : `DELETE` physique en cascade ([recipe.repository.ts:873](../server/src/repositories/recipe.repository.ts:873)). Seuls les formats ont `is_active`. Une fiche supprimée emporte son historique de coût.
- **1 recette ↔ 1 produit** (`recipes.product_id UNIQUE`, mig 005). Un même produit ne peut pas avoir une recette d'hiver et une d'été, ni une recette « rapide » de dépannage.
- **Import Excel** solide mais **sans les étapes** ([recipe-excel.service.ts:20](../server/src/services/recipe-excel.service.ts:20)) ; auto-crée des ingrédients à coût 0 et des produits à prix 0 (données fantômes à repasser).
- **Pas de darija** sur recettes/étapes (seule `recon_darija`, mig 234, traduit des noms de produits POS). Un fournil marocain travaille avec des équipes où l'arabe à l'écran compte.

---

## 3. Fiches techniques — manquements TECHNIQUES

### 3.1 Coût faux en silence sur mélange poids/volume (P0)

`fn_unit_conv` ne convertit qu'au sein d'une même famille et **renvoie 1 pour deux unités incompatibles** ([203_compose_cost_views.sql:13-14](../server/migrations/203_compose_cost_views.sql:13)). Même comportement côté JS `unitConversionFactor` ([recipe.repository.ts:24-30](../server/src/repositories/recipe.repository.ts:24)). Exemple concret : 1 l de lait saisi sur un composant alors que l'ingrédient est stocké au kg → coût compté comme 1 kg, ni plus ni moins, **sans aucun signalement**.

Or le calcul des **besoins** (TypeScript, [recipe-composition.helper.ts](../server/src/repositories/recipe-composition.helper.ts)) gère, lui, la densité et remonte un drapeau `conv_incertaine` — testé dans [recipe-composition.test.ts:229-269](../server/src/__tests__/recipe-composition.test.ts:229). **Les besoins et le coût divergent donc sur les mêmes lignes.** Le correctif densité (288/289) existe ailleurs mais pas ici.

### 3.2 Deux modèles de données qui cohabitent sans fin

Le plan de bascule de [AUDIT_FORMATS_A2_INVENTAIRE_LEGACY.md](AUDIT_FORMATS_A2_INVENTAIRE_LEGACY.md) prévoyait 3 phases. Les phases 1-2 ont eu lieu (202/217/218/220, vues 204/205) ; **la phase 3 (suppression du legacy) n'a jamais été faite**. Résultat :

- `recipe_ingredients` + `recipe_sub_recipes` (legacy) ET `recipe_components` + `recipe_format_components` (composé) vivent ensemble, avec des fallbacks dans chaque lecteur ;
- `contenant_id` 1:1 marqué « deprecated » depuis la mig 157 toujours lu ;
- **deux détecteurs de cycle** redondants (`detectCycle` [recipe.repository.ts:852](../server/src/repositories/recipe.repository.ts:852) et `detectComponentCycle` [recipe-component.repository.ts:448](../server/src/repositories/recipe-component.repository.ts:448)) + garde DB (mig 215) + garde runtime profondeur 12 ;
- **deux chemins financiers** qui peuvent diverger : `computeFinance` (par pièce, [recipe-component.repository.ts:42](../server/src/repositories/recipe-component.repository.ts:42)) vs `v_recipe_format_cost` v3 (prorata poids, mig 169).

### 3.3 Coût multi-format approximatif

`v_recipe_total_cost` ne développe que le format `is_default`. Si un entremets 6 parts et un 10 parts n'ont pas la même BOM, le coût des autres formats est faux ; un badge `costed_on_default_format` ([recipe-component.repository.ts:400](../server/src/repositories/recipe-component.repository.ts:400)) l'affiche mais rien ne le résout.

---

## 4. Production — manquements MÉTIER

### 4.1 Rien ne pilote le fournil

Le module sait **sortir la matière** (BSI exemplaire : FEFO, Pesage → Économat → rupture, substitutions, écarts, 21 méthodes toutes câblées). Mais une fois la matière sortie, il n'y a **aucun outil de conduite de fabrication** :

- **Pas de planning four** : aucune notion de fournée, de température de four, de séquencement (on enchaîne les 240 °C avant de descendre à 170 °C, pas l'inverse). L'optimisation « chariots de 18 plaques » existe mais dans le module Contrôle des ventes, pas ici.
- **Pas de planning de fermentation / J-1** : la viennoiserie et le pain au levain se préparent la veille (pousse contrôlée, tourage au froid). Le plan est « daily/weekly » sans horodatage d'étape ni rétro-planning depuis l'heure de mise en rayon.
- **Pas de capacité** : pétrin (kg de pâte), four (plaques), étuve, main-d'œuvre présente. `production_equipements` (mig 090) existe pour le coût, pas pour la planification.
- **Étapes déclaratives** : les timers et checklists de `production_item_etapes` sont bien faits, mais sans T°/HR structurées (cf. §2.1) l'écran ne peut pas guider un ouvrier.

### 4.2 La boucle stock ne se ferme pas

| Constat | Où | Effet au fournil |
|---|---|---|
| **Production possible sans stock** : déduction clampée à 0 + warning, jamais bloquante ([production.repository.ts:662-668, 1035](../server/src/repositories/production.repository.ts:662)) | `complete`, `produceItems` | Quantité produite ≠ matière déduite → inventaire mensuel faux, coût réel faux |
| **Lots périmés utilisables** : allocation BSI sur `status IN ('active','expired')` ([bon-sortie.repository.ts:75](../server/src/repositories/bon-sortie.repository.ts:75)), seul un libellé « ⚠ DLC dépassée » | BSI | Risque sanitaire ONSSA ; devrait être bloquant sauf dérogation tracée |
| **Lot produit fini seulement si `shelf_life_days` renseigné** ([production.repository.ts:807, 1188](../server/src/repositories/production.repository.ts:807)) | `complete`, `produceItems` | Traçabilité descendante incomplète (contredit l'exigence projet et le P2.7 de [AUDIT_CYCLE_VIE.md](AUDIT_CYCLE_VIE.md)) |
| **Surplus → frigo jamais automatique** : `vers_frigo` (rendement) et `surplus_frigo` (calcul inverse) sont de simples nombres ; `addSurplus` n'est appelé que par la route manuelle `/stock-frigo/surplus` | rendement, calcul inverse | Les crèmes/pâtes du frigo n'existent dans le système que si quelqu'un y pense |
| **Emballages consommés uniquement dans `complete()`** ([production.repository.ts:742-773](../server/src/repositories/production.repository.ts:742)), pas dans `produceItems` | auto-complétion | Un plan auto-complété ne décrémente jamais les emballages |
| **Réception avec écart sans correction** : `received_with_discrepancy` posé mais stock déjà incrémenté non ajusté ([production.repository.ts:1341](../server/src/repositories/production.repository.ts:1341)) | transfert magasin | Stock fantôme en boutique |
| **Rendement purement déclaratif** | `production_rendement` | Pertes saisies mais sans mouvement de stock ni valorisation |
| **`qty_from_frigo`** écrit mais jamais consommé à la déduction | `sourcing.helper.ts:225` | Le prélèvement frigo n'est pas réconcilié |

### 4.3 Coût réel amputé

`production_cout_reel` promet 4 composantes (mig 090) ; `calculateAndSave` force **`cout_energie = 0` et `cout_pertes = 0`** ([production-cout.repository.ts:289-290](../server/src/repositories/production-cout.repository.ts:289)) alors que l'usage équipement est enregistré et que les pertes sont dans le rendement. Le « coût réel » affiché est donc matières + MO + un forfait de charges fixes. Pour une pâtisserie où le four est le premier poste d'énergie, l'écart réel/prévu est trompeur.

### 4.4 Cycle de vie du plan incomplet

- **Aucune annulation de plan entier** : `cancelled` est dans le CHECK (mig 126) mais seule l'annulation par item existe ; `DELETE` n'est permis qu'en `draft`.
- **Feature flags ignorés** : `production_frigo_enabled`, `_calcul_inverse_enabled`, `_steps_enabled`, `_yield_enabled`, `_cost_enabled` sont mappés ([settings.repository.ts:82-87](../server/src/repositories/settings.repository.ts:82)) mais jamais lus ; seul `production_steps_blocking` l'est. Le calcul inverse et le coût s'exécutent toujours.

---

## 5. Production — BUGS confirmés (P0 technique)

Tous relus dans le code, pas seulement rapportés.

1. **`revertToDraft` plante** : `DELETE FROM production_bons_sortie_lignes WHERE bs_id = $1` ([production.repository.ts:565](../server/src/repositories/production.repository.ts:565)) — la colonne est **`bon_id`** ([084_production_bons_sortie.sql:34](../server/migrations/084_production_bons_sortie.sql:34), 40 usages corrects ailleurs). Toute remise en brouillon d'un plan ayant un BSI `genere` lève « column bs_id does not exist » et rollback. **La fonctionnalité est inutilisable.**
2. **`revertToDraft` laisse repasser en brouillon un plan dont la matière est déjà sortie** : la garde teste `status IN ('preleve','verifie','cloture')` ([:549-551](../server/src/repositories/production.repository.ts:549)) ; or `preleve` est un statut de **ligne** ; l'en-tête est **`prelevement`** ([084:15](../server/migrations/084_production_bons_sortie.sql:15), [103](../server/migrations/103_bons_sortie_workflow_statuts.sql)). Un BSI `prelevement` (stock décrémenté) n'est pas détecté → on revient en draft, les besoins sont supprimés, la matière reste sortie.
3. **`production_plans.warnings` n'existe dans aucune migration** (écrite à [:439](../server/src/repositories/production.repository.ts:439), lue à `:1261, :1527`). Soit ajoutée à la main en prod (schéma non reproductible), soit le `confirm` échoue sur une base fraîche.
4. **Trace de consommation incohérente** : `complete` déduit `GREATEST(current − besoin, 0)` mais journalise `−besoin` plein dans `inventory_transactions` ([:718-727](../server/src/repositories/production.repository.ts:718)) ; `produceItems` journalise le réel. En rupture, le journal surdéclare.
5. **Pas de verrou sur les transitions** : `confirm`/`start`/`complete` lisent le statut puis écrivent sans `SELECT … FOR UPDATE` (seuls `revertToDraft` et `generate` en ont). Deux clics « Lancer » simultanés peuvent doubler la déduction.

---

## 6. Qualité et tests

- **0 test sur la production** (15 fichiers de test au total, tous paie/RH sauf deux). Le workflow le plus sensible du stock (BSI → prélèvement → produceItems → lot) n'a aucun filet.
- 2 tests recettes ([recipe-composition.test.ts](../server/src/__tests__/recipe-composition.test.ts), [units-densite.test.ts](../server/src/__tests__/units-densite.test.ts)) : bons sur les besoins et la densité TS, **rien sur les vues SQL de coût** — là où est le bug §3.1.
- `production.repository.ts` fait **97 Ko** : confirm, start, complete, produceItems, transferts, semi-finis, lots, le tout dans un seul fichier.

---

## 7. Priorisation

| Prio | Action | Effort | Pourquoi d'abord |
|---|---|---|---|
| **P0** | Corriger `revertToDraft` (`bon_id`, statut `prelevement`) + migration `warnings` + verrou `FOR UPDATE` sur confirm/start/complete | S | Bugs confirmés, correction locale, zéro débat métier |
| **P0** | Rapatrier le correctif densité (288/289) ou faire remonter `conv_incertaine` dans les vues de coût ; afficher le badge coût incertain | S-M | Coût faux en silence = prix de vente faux |
| **P0** | Interdire les lots `expired` au BSI (dérogation explicite tracée) | S | Conformité ONSSA |
| **P1** | Lot produit fini **systématique** (DLC = jour même par défaut) — P2.7 de l'audit cycle de vie | M | Traçabilité descendante à 100 % |
| **P1** | Étapes structurées : `temperature_c`, `duree_min`, `humidite_pct`, `type` (pétrissage/pointage/tourage/apprêt/cuisson/refroidissement) + T° pâte cible et hydratation sur la recette | M | Prérequis de tout écran four / planning |
| **P1** | Fermer la boucle stock : surplus → frigo automatique, emballages dans `produceItems`, écart réception ajuste le stock, rendement valorisé | M | Inventaire mensuel enfin juste |
| **P1** | Coût réel complet : énergie depuis `production_equipement_usage`, pertes depuis le rendement | S | Le coût réel devient crédible |
| **P2** | Allergènes agrégés recette → produit → étiquette ; DLC/conservation sur la recette | M | Étiquetage |
| **P2** | Archivage + versioning complet (BOM, étapes, frais) + restauration | M | Historique de coût |
| **P2** | Terminer la phase 3 legacy → composé ; un seul détecteur de cycle ; un seul chemin financier | L | Dette qui coûte à chaque évolution |
| **P2** | Planning four / fermentation J-1 / capacité | L | Vraie conduite de fabrication (à spécifier avec le chef) |
| **P2** | Tests : workflow BSI → produceItems → lot ; vues SQL de coût | M | Filet avant toute refonte |
| **Transverse** | Fusionner les branches et renuméroter 270-337 | S | Sans quoi rien de ce qui précède ne se livre proprement |
