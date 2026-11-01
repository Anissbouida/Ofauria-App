# Laboratoire de pâtisserie-boulangerie — architecture cible (DDD) ⇄ état de Kalum

> **Date :** 2026-10-31 · **Périmètre :** flux physique du laboratoire, de la réception des matières au produit fini en vitrine.
> **Méthode :** la cible est écrite du point de vue du chef de production (vocabulaire du fournil) et traduite en contextes bornés, agrégats et règles. Chaque feature est ensuite confrontée au code de Kalum (migrations 001→406, routes `server/src/routes`, features `client/src/features`).
> **Légende :** 🟢 couvert · 🟡 partiel · 🔴 absent · *(à vérifier)* = non confirmé par lecture du code.
> **Compléments :** [COMPARAISON_ERPNEXT_PRODUCTION.md](COMPARAISON_ERPNEXT_PRODUCTION.md) (vision atelier/ERP), [ECARTS_RESTANTS_ERPNEXT.md](ECARTS_RESTANTS_ERPNEXT.md). Ce document prend l'angle inverse : **la réalité physique du labo**, pas le référentiel ERP.

---

## 0. Lecture exécutive

**Kalum est déjà un WMS/MES de laboratoire, pas un simple ERP.** Les trois invariants d'un labo artisanal sont en place et vérifiés dans le code :

1. **La matière est pesée, pas « backflushée »** : bon de sortie interne (BSI) strict, choix du lot, DLC, dérogation tracée, tolérance de pesée, historique de pesée (mig 084/113/270/300/339).
2. **La nomenclature est gigogne et par format** : composants récursifs anti-cycle, formats avec poids cru/cuit, pièces par fournée, densité, rôles de composant, explosion matérialisée (mig 200/205/215/266/400).
3. **Le lot est tracé de bout en bout** : lot fournisseur → pesée → lot de semi-fini → lot de produit → vitrine → ticket client → rappel (mig 056/105/300/316/337).

**Les écarts qui restent sont ceux du « physique fin » du labo**, là où Kalum raisonne encore en quantités et en étapes nommées plutôt qu'en masse, température et emplacement :

| # | Écart structurant | Epic | Priorité |
|---|---|---|---|
| 1 | **Pas de référentiel d'emplacements** (enceinte → étagère → bac) ni de cartographie : un lot est dans « ÉCONOMAT » ou « PESAGE », jamais dans « CF-02, étagère 3 » | E2 | P0 |
| 2 | **Paramètres de procédé sans relevé réel** : l'étape porte une température cible, mais aucune mesure réelle par fournée (température de pâte en fin de pétrissage, couple temps/température de cuisson, cœur au refroidissement) | E5/E8 | P0 |
| 3 | **Freinte par étape non modélisée** : la perte est un % par composant ou une catégorie saisie à la fin ; pas de bilan massique cru → pâtons → cuit → ressué | E3/E5 | P1 |
| 4 | **Température de base** (eau + farine + fournil) non calculée | E3 | P1 |
| 5 | **État congelé / décongelé** absent du lot de semi-fini ; DLC non recalculée à la décongélation, recongélation non interdite | E6 | P1 |
| 6 | **Rétro-planning** : le plan a une date, pas un enchaînement contraint par les temps de repos, de pousse et de surgélation jusqu'à l'heure de mise en vitrine | E4 | P2 |
| 7 | **Contrôle qualité à réception non bloquant** : la fiche existe (température, visuel, emballage, étiquettes) mais ne verrouille pas le lot | E1 | P2 |
| 8 | **Contenant scellé non individualisé** : le lot est une quantité, pas N contenants numérotés | E1/E9 | P3 |

Le reste du document détaille les 10 epics, puis propose 6 lots de livraison.

---

## 1. Contextes bornés (bounded contexts) et correspondance Kalum

| Contexte borné | Langage du chef | Agrégat racine cible | Où c'est dans Kalum |
|---|---|---|---|
| **Approvisionnement & réception** | « réceptionner, contrôler, mettre en quarantaine » | `LotMatière` (lot fournisseur) | `ingredient_lots`, `reception_vouchers`, `reception_quality_checks` ; routes `ingredient-lot`, `reception-voucher` |
| **Entreposage** | « économat, chambre froide positive/négative, pesage » | `Emplacement`, `Mouvement` | `ingredient_stock_zone_transfers` (2 zones), `inventory_transactions`, `stock_counts`, `stock_closings` |
| **Fiches techniques** | « recette, sous-recette, format, pièce, fournée » | `Recette` + `Format` | `recipes`, `recipe_components`, `recipe_formats`, `recipe_format_components`, `v_recipe_explosion` |
| **Planification** | « plan du jour, besoins, semi-finis à faire la veille » | `PlanDeProduction` | `production_plans`, `production_plan_dependencies`, MRP (`/mrp/*`), `work_centers` |
| **Exécution labo** | « BSI, pesée, pétrissage, pousse, cuisson, ressuage » | `Fournée` (plan item) | `production_bons_sortie*`, `production_item_etapes`, `production_rendement`, `production_item_outputs` |
| **Froid & durée de vie** | « DLC, DLUO, surgélation, décongélation, vitrine » | `LotProduit`, `LotSemiFini` | `product_lots`, `semi_finished_lots`, `stock_semifini_frigo`, `unsold_decisions` |
| **Traçabilité** | « d'où vient ce lot, où est-il parti » | `GrapheDeLots` | `production_lot_usage`, `semi_finished_lot_usage`, `product_lot_movements`, `sale_item_lots`, `product_recalls` |
| **Qualité & HACCP** | « relevé frigo, nettoyage, non-conformité » | `RelevéCCP`, `NonConformité` | `haccp_*` (315), `quality_templates/inspections` (384), `quality_nonconformities` (385) |
| **Unités & contenants** | « sac de 25 kg, brique de 1 L, seau » | `UnitéDeMesure`, `TypeDeContenant` | `container_types` (ref_entries), `ingredients.qty_per_container`, `densite_kg_l`, `poids_piece_kg` |
| **Coût de revient** | « coût matière, main-d'œuvre, énergie, écart » | `CoûtRéel` | `production_cout_reel`, CMUP, `v_production_mo_ecart`, `production_item_outputs.cost_share` |

Règle d'architecture conservée : **le lot de matière ne sort jamais du contexte Entreposage sans un mouvement**, et **la consommation n'existe que par pesée** (jamais par calcul théorique). Ces deux règles sont déjà celles de Kalum ; les lots proposés plus bas les respectent.

---

## 2. Epics, features et état Kalum

### E1 — Réception des matières premières et lot fournisseur

*Réalité labo :* un sac de farine T55 arrive avec un numéro de lot fournisseur, une DLUO, parfois une température à contrôler (beurre, crème, œufs). Le lot est accepté, mis en quarantaine ou refusé, puis rangé à un emplacement. Un contenant entamé a une DLC secondaire.

| Feature | User story | État Kalum | Écart |
|---|---|---|---|
| F1.1 Lot fournisseur | *En tant que magasinier, je réceptionne N contenants d'un lot fournisseur avec sa DLC pour que chaque pesée future sache d'où vient la matière.* | 🟢 `ingredient_lots` : n° interne unique, `supplier_lot_number`, `manufactured_date`, `expiration_date`, `quantity_remaining`, CMUP à la réception ; réception par contenant (mig 226/308) | — |
| F1.2 Contrôle à réception | *Je relève la température du camion et l'état des emballages, et un lot non conforme ne peut pas être pesé.* | 🟡 `reception_quality_checks` (température, visuel, emballage, étiquettes, conformité globale) + `POST /ingredient-lots/:id/quarantine` ; modèles de contrôle génériques (384) | 🔴 le contrôle n'est pas **structurellement bloquant** : la non-conformité ne verrouille pas le lot ; les modèles 384 ne sont pas liés à la réception (texte libre) |
| F1.3 DLC / DLUO | *Je distingue une date limite de consommation (sanitaire) d'une date de durabilité minimale (qualité) pour que la dérogation soit possible sur l'une et pas sur l'autre.* | 🟡 un seul champ `expiration_date` ; `requires_dlc` par ingrédient ; dérogation DLC tracée au BSI (339) | 🔴 pas de type de date (DLC vs DLUO) ; la dérogation ne sait pas si elle est sanitaire |
| F1.4 DLC secondaire | *Un contenant ouvert prend une nouvelle date limite (œufs 7 j, beurre 30 j).* | 🟢 `shelf_life_after_opening_days`, `effective_expiry_after_opening`, ouverture = transfert vers pesage (`open-to-pesage`) | — |
| F1.5 Allergènes | *Chaque matière déclare ses allergènes pour que la fiche produit les hérite.* | 🟢 `ingredients.allergens` normalisé (344), vues `v_recipe_allergens` / `v_product_allergens` (343) | 🟡 pas d'étiquette produit imprimable avec allergènes + DLC *(à vérifier)* |
| F1.6 Contenant scellé | *Je trace le contenant n° 3 du lot, pas seulement 75 kg restants.* | 🔴 le lot est une quantité + un nombre de contenants ; pas d'identité par contenant | Utile si audit « contenant entamé », sinon P3 |

### E2 — Entreposage, zones froides et cartographie

*Réalité labo :* économat sec, chambre froide positive (0-4 °C), chambre froide négative (-18 °C), zone de pesage, frigo de repos des pâtes, vitrine. Chaque enceinte a une sonde, un relevé matin/soir, et une capacité. Le chef veut voir **où** est le lot, pas seulement combien.

| Feature | User story | État Kalum | Écart |
|---|---|---|---|
| F2.1 Zones de stock | *Je transfère un lot de l'économat vers le pesage et je sais ce qui est dans chaque zone.* | 🟢 zones `ECONOMAT` / `PESAGE`, transferts tracés par lot avec nombre de contenants, retour économat, casse pesage | 🔴 modèle à **2 zones codées en dur** (CHECK SQL) ; pas de chambre froide comme zone de stock de matière |
| F2.2 Référentiel d'emplacements | *Je déclare CF-01 (positive), CF-02 (négative), étagères et bacs, et chaque lot a un emplacement courant.* | 🔴 absent : `ingredient_lots` n'a pas d'emplacement ; `production_equipements` connaît `frigo` / `surgele` mais comme **équipement coûté**, pas comme lieu de stockage | **P0** — socle de tout le reste (HACCP par enceinte, capacité froid, inventaire par zone) |
| F2.3 Cartographie visuelle | *Je vois le plan du labo avec les enceintes, leur taux de remplissage et leur dernier relevé de température.* | 🔴 absent | Dépend de F2.2 |
| F2.4 Relevés de température | *Je relève la température de chaque enceinte et une sortie de plage ouvre une action corrective.* | 🟢 `haccp_temperature_readings` par équipement, plages `frigo` 0-4 / `surgele` -40/-18, `in_range` calculé, `haccp_corrective_actions` | 🟡 relevé manuel seulement ; pas de lien relevé → lots présents dans l'enceinte (rupture de chaîne du froid non propagée aux lots) |
| F2.5 Inventaire et clôture | *Je compte à l'aveugle par zone, je valide les écarts, je clôture le mois.* | 🟢 `stock_counts` (aveugle, partiel, écarts valorisés), `stock_closings`, vieillissement (`StockAgingTab`) | 🟡 comptage par catégorie, pas par emplacement (dépend de F2.2) |
| F2.6 Règles chambre négative | *Un lot qui sort du négatif plus de X minutes est bloqué ou requalifié.* | 🔴 absent | Lié à F6.2 (état congelé/décongelé) |

### E3 — Fiches techniques et nomenclature gigogne

*Réalité labo :* un croissant aux amandes = pâte levée feuilletée (détrempe + beurre de tourage) + crème d'amandes + sirop + finition. Chaque sous-recette a son rendement, ses pertes, sa température de pâte cible, son hydratation. Un format (entremets 6 parts, 8 parts, cadre 60×40) change les quantités.

| Feature | User story | État Kalum | Écart |
|---|---|---|---|
| F3.1 BOM multi-niveaux | *Une recette contient des recettes, sans cycle, et le coût remonte.* | 🟢 `recipe_components` récursif + contrainte anti-cycle (215) + explosion matérialisée `v_recipe_explosion` (400) + remplacement A→B annulable (401) | — |
| F3.2 Formats et pièces | *Pour le format « cadre 60×40 », je sais le poids cru, le poids cuit, le nombre de parts et de pièces par fournée.* | 🟢 `recipe_formats` : `poids_cru_g`, `poids_cuit_g`, `nb_parts`, `pieces_par_fournee`, `piece_weight_kg`, lien produit, mode « par personne » (377) | — |
| F3.3 Rôles de composant | *Je lis une fiche par couches : fond, biscuit, croustillant, insert, glaçage.* | 🟢 référentiel `component_roles` (197) | — |
| F3.4 Étapes de procédé | *Chaque étape a un type (pétrissage, pointage, tourage, détaillage, apprêt, cuisson, ressuage, montage, finition), une durée, une température, une humidité.* | 🟢 étapes typées (342 : 10 types), `temperature_c`, `humidite_pct`, `duree_estimee_min`, checklist, bloquante, répétable, rôle ; étapes base vs produit (masterclass) | 🟡 étapes en **JSONB** sur la recette (pas de table) ; pas de **tolérance** par paramètre (24 °C ± 1) ; pas de distinction consigne / mesure |
| F3.5 Paramètres boulangers | *La fiche porte l'hydratation et la température de pâte cible.* | 🟢 `hydratation_pct`, `temperature_pate_cible_c` (342) | 🔴 **température de base** non calculée (T° base = T° pâte cible × 3 − T° farine − T° fournil → T° eau) |
| F3.6 Pertes standard | *Je déclare une perte de 3 % au laminage et 12 % de perte de poids à la cuisson.* | 🟡 `perte_pct` par composant (265), `perte_standard_pct`, poids cru/cuit par format, catégories de pertes par contenant (`pertes_cuisson`, `pertes_laminage`, `pertes_demoulage`…) | 🔴 la perte n'est pas **rattachée à l'étape** ; pas de bilan massique attendu étape par étape |
| F3.7 Pâtons | *Une pâte de 12 kg donne 40 pâtons de 300 g qui donnent 40 baguettes de 250 g cuites.* | 🟡 implicite via `pieces_par_fournee` + poids cru/cuit du format | 🔴 pas d'entité « pâton » (masse intermédiaire, division, repos) ; pas de calcul inverse pièces → pâtons → masse de pétrissage |
| F3.8 Nomenclature fantôme | *Un pré-mélange éclate dans la recette sans stock intermédiaire.* | 🔴 absent (cf. ERPNext) | P3, selon usage des pré-mélanges |
| F3.9 Versions et archivage | *Je modifie une fiche sans casser les plans passés.* | 🟢 `recipe_versions`, snapshot à l'archivage (346), journal BOM (264) | — |

### E4 — Planification et calcul des besoins

*Réalité labo :* on part de l'heure de vitrine (7 h) et on remonte : cuisson 6 h, apprêt 2 h avant, tourage la veille, détrempe J-1 soir. Les semi-finis (crèmes, feuilletage) se font en amont. Le four et la chambre de pousse sont les goulets.

| Feature | User story | État Kalum | Écart |
|---|---|---|---|
| F4.1 Plan journalier multi-formats | *Je planifie 120 croissants + 3 entremets 8 parts et le système calcule la matière.* | 🟢 `production_plans` + items par format, machine à états (299), relance, BSI généré | — |
| F4.2 Semi-finis et dépendances | *Le plan détecte qu'il faut 4 kg de crème pâtissière et crée la dépendance la veille.* | 🟢 détection automatique, `production_plan_dependencies`, stock intermédiaire `semi_finished_stock` | — |
| F4.3 MRP et appros | *Les besoins nets déclenchent les demandes d'achat.* | 🟢 horizon, plan directeur, génération d'appros (403) | 🟡 MPS non persisté |
| F4.4 Capacité four / chambre de pousse | *Je vois la charge du four en plaques/heure face au plan.* | 🟢 `work_centers` capacité + calendrier + charge (398), OEE (402) | — |
| F4.5 Rétro-planning par temps de procédé | *À partir de 7 h en vitrine, le système me dit quand pétrir, en respectant pointage, tourage, apprêt et surgélation.* | 🔴 absent : les dates sont au niveau plan ; les durées d'étapes ne contraignent pas le planning | P2 — les durées (`duree_estimee_min`) et la capacité existent, il manque l'ordonnanceur |

### E5 — Exécution au laboratoire (fournée)

*Réalité labo :* le BSI dit quoi peser ; on pèse sur balance, on choisit le lot le plus proche de la DLC, on note l'écart. Puis le chef déroule les étapes, mesure la pâte à 25 °C, divise, façonne, met en pousse, enfourne 18 min à 175 °C, ressue, compte les pertes, et envoie en magasin ou au frigo.

| Feature | User story | État Kalum | Écart |
|---|---|---|---|
| F5.1 Pesée réelle au lot | *Je pèse 2,480 kg sur une cible de 2,500 kg, dans la tolérance, sur le lot proposé en FEFO.* | 🟢 BSI strict : lot, tolérance symétrique + plancher (270), tare, source balance/manuel, historique (300), préparation partielle (108), dérogation DLC (339), aperçu FEFO des lots matière par plan (`fefo-preview`), balance connectée (WebSerial) | — |
| F5.2 Suivi d'étapes | *Je démarre l'apprêt, un minuteur me prévient, je coche le contrôle visuel.* | 🟢 `production_item_etapes` : statut, timer, checklist, répétition, poste, opérateur, pause (399), tableau d'atelier live | — |
| F5.3 Relevés de procédé par fournée | *Je saisis la température réelle de la pâte en fin de pétrissage et le couple temps/température de cuisson, comparés à la consigne.* | 🔴 `temperature_c` sur l'étape d'exécution provient de la fiche (consigne) ; aucune colonne « mesuré » ; les relevés HACCP ne portent que sur les équipements | **P0 qualité** : c'est le CCP cuisson et la preuve de maîtrise du process |
| F5.4 Bilan massique | *Je saisis la masse de pâte, le nombre et le poids des pâtons, la masse cuite ; la freinte réelle se calcule par étape et se compare au standard.* | 🟡 `production_rendement` : pièces vers magasin / frigo + pertes par catégorie (JSONB) ; coût réel et écart de mix (268) | 🔴 pas de masse en entrée/sortie d'étape ; la freinte reste une catégorie déclarée, pas une mesure |
| F5.5 Sorties multiples (coupe) | *Un cadre donne 24 tranches et 2 entremets, chacun avec son coût.* | 🟢 `production_item_outputs` + allocation de coût (397) | — |
| F5.6 Retours de pesage | *Je rends le reste du seau à l'économat ou je déclare la casse.* | 🟢 `return-to-economat`, `pesage-waste`, remise avec manquants | — |
| F5.7 Numéro de lot produit | *Chaque fournée reçoit un lot daté séquentiel.* | 🟢 `production_lot_numbers` (065), `product_lots` créé à la clôture | — |

### E6 — Froid, surgélation et durée de vie des produits

*Réalité labo :* les croissants crus sont surgelés en cellule puis stockés à -18 °C ; on sort 60 pièces la veille pour pousse ; un entremets monté est surgelé, décongelé en vitrine avec une DLC de 48 h après décongélation. On ne recongèle jamais.

| Feature | User story | État Kalum | Écart |
|---|---|---|---|
| F6.1 DLC produit et DLV vitrine | *Un produit a une durée de vie et une durée d'exposition ; la vente suit FEFO.* | 🟢 `shelf_life_days`, `display_life_hours`, `product_lots` (backroom / vitrine / vendu / perdu / recyclé), FEFO vente, ré-exposition plafonnée, recyclage en ingrédient | — |
| F6.2 État congelé / décongelé | *Un lot de semi-fini ou de produit est « surgelé » ou « décongelé » ; la DLC est recalculée à la décongélation ; la recongélation est interdite.* | 🔴 `semi_finished_lots` et `product_lots` ont `expires_at` mais aucun état thermique ; le type d'étape `refroidissement` couvre surgélation et ressuage sans distinction | **P1** |
| F6.3 Stock frigo de semi-finis | *Je vois les crèmes et pâtes disponibles au frigo avec leur DLC.* | 🟢 `semi_finished_lots` (FEFO, expiré, épuisé), `stock_semifini_frigo` (produits), onglet Semi-finis | 🟡 deux modèles historiques (081 et 083) coexistent *(à rationaliser)* |
| F6.4 Invendus et décisions | *En fin de journée, je décide : réexposer, recycler, perdre.* | 🟢 `unsold_decisions`, module Boutique | — |

### E7 — Traçabilité ascendante et descendante

*Réalité labo :* un fournisseur rappelle un lot de poudre d'amandes. Il faut lister en minutes toutes les fournées, tous les produits et tous les tickets concernés (descendante), et pour un ticket client, remonter jusqu'au sac (ascendante).

| Feature | User story | État Kalum | Écart |
|---|---|---|---|
| F7.1 Chaîne complète | *Lot matière → pesée → lot semi-fini → lot produit → mouvement → ticket.* | 🟢 `production_lot_usage`, `semi_finished_lot_usage`, `product_lot_movements`, `sale_item_lots`, `GET /ingredient-lots/:id/traceability` | — |
| F7.2 Rappel | *J'ouvre un rappel sur un lot, les produits sont bloqués, les clients identifiés.* | 🟢 `product_recalls` / `product_recall_items` (open → blocked → closed), endpoint `/traceability/recall`, écran Contrôle | 🟡 export réglementaire (ONSSA) *(à vérifier)* |
| F7.3 Emballage primaire | *Je trace le lot de boîte / film en contact avec le produit.* | 🟡 `packaging_items` gérés en stock et au BSI, mais sans lot *(à vérifier)* | P3 |

### E8 — Qualité, HACCP et conformité

| Feature | État Kalum | Écart |
|---|---|---|
| F8.1 PRP : nettoyage, températures d'enceintes | 🟢 tâches de nettoyage par zone et fréquence, journaux, relevés, actions correctives (315) | — |
| F8.2 CCP par fournée (cuisson, refroidissement) | 🔴 aucun relevé rattaché à une fournée (cf. F5.3) | **P0** |
| F8.3 Plan HACCP formalisé (danger → CCP → limite critique → surveillance) | 🔴 absent ; les plages existent sur les équipements seulement | P2, s'appuie sur F5.3 |
| F8.4 Non-conformités et CAPA | 🟢 `quality_nonconformities` (385), modèles d'inspection (384) | 🟡 inspection non reliée à la réception ni à l'étape |
| F8.5 Étiquetage DLC / allergènes / lot | 🟡 vues allergènes + lot produit existent | 🔴 impression d'étiquette produit *(à vérifier)* |

### E9 — Unités de mesure et contenants

| Feature | État Kalum | Écart |
|---|---|---|
| Unité saisie conservée à l'affichage, conversion interne en base (kg / L / pièce) | 🟢 règle projet ; signal de mauvaise conversion (260) | — |
| Densité poids ↔ volume | 🟢 `densite_kg_l` sur ingrédient et format (227/266/341) | — |
| Poids par pièce (œuf, pièce ↔ kg) | 🟢 `poids_piece_kg` + `fn_ingredient_weight_kg` (392) | — |
| Types de contenant et quantité par contenant | 🟢 `container_types` éditable, `qty_per_container`, saisie par contenant à la réception et au transfert | — |
| Contenant scellé individualisé | 🔴 cf. F1.6 | P3 |

### E10 — Coût de revient réel

| Feature | État Kalum | Écart |
|---|---|---|
| Coût matière CMUP, coût théorique figé au plan (261) | 🟢 | — |
| Coût réel : matière pesée + énergie équipement + temps de travail + écart de mix (090/268) | 🟢 | — |
| Main-d'œuvre standard (gammes) vs réel (396) | 🟢 | — |
| Coût des co-produits (397), OEE (402) | 🟢 | — |
| Coût de la freinte par étape | 🔴 dépend de F5.4 | P1 |

---

## 3. Modèle cible des écarts P0/P1 (langage commun chef ⇄ développeur)

### 3.1 Emplacement (E2)

```
Emplacement
├─ code           "CF-02"                 (unique par magasin)
├─ type           sec | positif | negatif | pesage | vitrine | labo
├─ parent         Emplacement?            (CF-02 → étagère 3 → bac A)
├─ equipement     production_equipements? (lie la sonde HACCP à l'enceinte)
├─ plage_temp     [min, max] héritée de l'équipement
└─ capacite       {unite: "bac" | "plaque" | "kg", valeur}

LotMatière.emplacement_courant → Emplacement
Mouvement(lot, de, vers, quantité, contenants, motif, par, à)
```

Règles : un transfert change l'emplacement **et** garde la zone logique (économat / pesage) pour ne pas casser le BSI ; un relevé hors plage sur une enceinte marque les lots présents « chaîne du froid à vérifier ».

### 3.2 Relevé de procédé par fournée (E5 / E8)

```
ÉtapeExécutée (production_item_etapes)
└─ relevés[]  RelevéProcédé
   ├─ parametre   temp_pate | temp_four | duree_cuisson | temp_coeur | humidite | poids
   ├─ consigne    25.0   (copiée de la fiche)
   ├─ tolerance   ±1.0   (de la fiche)
   ├─ mesure      26.4   (saisie ou balance / sonde)
   ├─ conforme    calculé
   ├─ est_ccp     true   (cuisson, refroidissement)
   └─ mesure_par, mesure_a
```

Règles : une étape marquée CCP ne se clôture pas sans relevé ; un relevé non conforme ouvre une `haccp_corrective_actions` (source `process`) et bloque la mise en lot produit tant qu'elle n'est pas validée.

### 3.3 Bilan massique et pâtons (E3 / E5)

```
Fournée (plan item)
├─ masse_petrie_kg        12.000   ← somme des pesées BSI (déjà connue)
├─ patons { nombre: 40, poids_unitaire_g: 300 }   ← division
├─ masse_cuite_kg         10.000   ← pesée ou pièces × poids cuit du format
└─ freinte[] par étape    { etape: cuisson, attendu_pct: 15, reel_pct: 16.7 }
```

Règle : freinte attendue = `poids_cru_g` → `poids_cuit_g` du format, ventilée par type d'étape ; l'écart réel alimente le coût réel (E10) et le rendement.

### 3.4 Température de base (E3)

```
T°_eau = T°_base − T°_farine − T°_fournil
T°_base = 3 × T°_pâte_cible   (pétrin spiral : ajuster d'un coefficient d'échauffement)
```

Entrée du jour : T° fournil et T° farine (relevés HACCP ambiants ou saisie au lancement) ; sortie : T° d'eau affichée sur le BSI. Aucun nouveau modèle : `temperature_pate_cible_c` existe déjà.

### 3.5 État thermique du lot (E6)

```
LotSemiFini / LotProduit
├─ etat_thermique   frais | surgele | decongele
├─ surgele_a, decongele_a
└─ dlc_effective    = decongele_a + duree_vie_apres_decongelation
```

Règles : `surgele → decongele` autorisé une fois ; `decongele → surgele` refusé ; la DLC affichée et le FEFO utilisent `dlc_effective`.

---

## 4. Lots de livraison proposés

| Lot | Objet | Epics | Priorité | Effort | Dépend de | Tables / migrations (indicatif, vérifier le dernier numéro sur `main` : 406) |
|---|---|---|---|---|---|---|
| **L1** | **Référentiel d'emplacements** + localisation des lots + lien enceinte ↔ sonde HACCP + inventaire par emplacement | E2 | P0 | Moyen | — | `stock_locations`, `ingredient_lots.location_id`, `stock_location_moves` ; relâcher le CHECK 2 zones en gardant la zone logique |
| **L2** | **Relevés de procédé par fournée** (consigne / tolérance / mesure, CCP bloquant, action corrective) + **température de base** sur le BSI | E5, E8, E3 | P0 | Moyen | — | `production_step_readings` ; tolérances dans le JSONB `etapes` ; calcul T° eau côté service |
| **L3** | **Bilan massique et pâtons** : masse pétrie / pâtons / masse cuite par fournée, freinte réelle par étape vs standard, coût de la freinte | E3, E5, E10 | P1 | Moyen | L2 (relevé poids) | colonnes sur `production_rendement`, `recipe_formats.freinte_par_etape` JSONB |
| **L4** | **État thermique des lots** (surgelé / décongelé), DLC recalculée, interdiction de recongélation, règle de sortie du négatif | E6, E2 | P1 | Faible-Moyen | L1 (emplacement négatif) | `semi_finished_lots` / `product_lots` : `etat_thermique`, `decongele_a`, `dlc_effective` |
| **L5** | **Contrôle à réception bloquant** (modèle 384 rattaché à la réception, lot verrouillé tant que non conforme) + **DLC vs DLUO** + étiquette produit (lot, DLC, allergènes) | E1, E8 | P2 | Faible-Moyen | — | `ingredient_lots.date_kind`, `reception_quality_checks.template_id`, statut `blocked` |
| **L6** | **Rétro-planning labo** : à partir de l'heure de vitrine, calcul des heures de démarrage par étape avec temps de repos / pousse / surgélation, confronté à la capacité four et chambre de pousse | E4 | P2 | Élevé | L2 (durées fiabilisées), 398 | `production_item_etapes.planned_start/end`, vue Gantt |

Hors chemin critique : nomenclature fantôme (F3.8), contenant scellé individualisé (F1.6), lot d'emballage primaire (F7.3), rationalisation des deux modèles de stock frigo (F6.3).

**Séquencement conseillé :** L1 + L2 en parallèle (aucune dépendance, les deux sont le socle « physique » manquant), puis L3 et L4, puis L5, et L6 en dernier quand les durées d'étapes auront été mesurées pendant quelques semaines par L2.

---

## 5. Ce qu'il faut préserver

- **Pesage réel comme seule source de consommation** : L3 ajoute des masses de sortie, jamais une consommation calculée.
- **Unité saisie = unité affichée** ; les bilans massiques se font en kg en interne.
- **Lot = agrégat de traçabilité** : L1 et L4 ajoutent des attributs au lot, ils ne créent pas un second identifiant.
- **Étapes JSONB sur la fiche** : L2 enrichit le JSON (tolérances) sans migrer vers une table ; la table de relevés est côté exécution, là où les requêtes sont nécessaires.
- **Flag `company_settings` par lot** pour un déploiement progressif, comme pour les lots Production 396→403.

### Réserve
État Kalum établi par lecture des migrations, des routes et des features (pas d'exécution). Les points *(à vérifier)* — impression d'étiquettes, export rappel ONSSA, lots d'emballage — demandent une confirmation ciblée avant chiffrage.
