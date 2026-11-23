# Production multi-industries — analyse de Kalum et plan d'action

Date : 2026-11-22. Référence : le « prompt maître » de refonte du module de production (noyau universel, profils industriels à héritage, capacités réutilisables, workflows et interfaces configurables).

Méthode : trois audits en lecture seule du code au commit `e1d0412d` (couche de configuration, moteur de production serveur et base, interfaces client), recoupés avec les écrans « Secteur et modules ». Tout constat cité ci-dessous a été lu dans le code ; rien n'a été modifié ni exécuté. Ce document prend la suite de `PLAN_PRODUCTION_GENERIQUE.md` (lots P0-P11 terminés) et de la partie production de `FEUILLE_DE_ROUTE_MULTI_SECTEUR.md`.

---

## 1. Verdict

Kalum n'est plus un logiciel de boulangerie : c'est un moteur de production à **parcours unique, réglable par des données**. Le socle de configuration demandé par le prompt existe déjà en grande partie. Ce qui manque, ce sont les trois pièces qui font passer de « un parcours réglable » à « n'importe quel parcours » :

1. **Le processus est figé.** Les statuts et transitions d'un ordre sont codés deux fois (`server/src/services/production-state.ts:17-39` et la fonction SQL de la migration 299). Aucun moteur de workflow, aucune étape parallèle ou conditionnelle.
2. **L'héritage est une copie.** Les profils `process`, `discret`, `atelier` ont recopié `fabrication` à leur création (mig 586) ; il n'y a ni profil Agroalimentaire parent de la boulangerie, ni spécialisations activables (pâtisserie, viennoiserie, traiteur, beldi…).
3. **Les écrans ne s'adaptent que par masquage et renommage.** Sept options booléennes et dix-huit libellés ; aucun formulaire, tableau ou tableau de bord piloté par métadonnées. Les écrans opérationnels (`ProductionLaunchModal` 2 481 lignes, `PlanDetailPage` 2 099, `RendementPanel`) portent les concepts boulangerie dans leur modèle de données.

Ordre de grandeur : sur les 20 critères d'acceptation du prompt, **3 sont atteints, 11 partiellement, 6 absents** (détail § 3).

La fiche technique fait l'objet d'un constat à part (§ 4 bis) : sa structure est déjà celle d'un industriel, mais six verrous l'empêchent de servir l'agroalimentaire conditionné.

---

## 2. Ce qui existe déjà (à ne pas reconstruire)

| Responsabilité du prompt (§ 22) | État dans Kalum | Où |
|---|---|---|
| Configuration Engine | Secteur = préréglage + écarts société, pilote par rôle, fermeture par établissement, versions et restauration, aperçu d'impact | `sector.repository.ts`, mig 507-509 |
| Capability Registry | Modules en code avec dépendances ; 8 options en base, toutes du module Production | `shared/.../module-activation.ts:23-29`, table `app_features` |
| Workflow Engine | **Absent.** Machine à états codée ; approbations génériques mais seulement pour `bom_change` | `production-state.ts`, `approval.service.ts` |
| Business Rules Engine | Politiques à 5 niveaux (article → type d'ordre → atelier → établissement → société), 13 clés de production | `services/policies.ts`, `parameters-catalog.ts` |
| Dynamic UI Engine | **Absent.** Registre de panneaux en code, masquage de 12 éléments sur 2 écrans | `planPanelRules.ts`, mig 591 |
| Production Engine | Types d'ordre (bon de sortie, mode de consommation, sous-traitance, série), ateliers, postes, calendriers, gammes | mig 546, 511, 388, 566-568 |
| BOM & Recipe Engine | Versions figées sur l'ordre, alternatives, substituts, co-produits, fantôme, désassemblage, unités en référentiel | mig 554-564, 588-589, 593-595 |
| Inventory Integration | 3 modes de consommation, lots FEFO, séries, transferts partiels ; zones Économat/Pesage en dur | `bon-sortie.repository.ts`, mig 570 |
| Costing Engine | Coût réel (matière FIFO, emballage, main-d'œuvre, énergie, pertes, charges, sous-traitance), écarts, clé de répartition | `production-cout.repository.ts` |
| Quality Engine | Plan de contrôle, inspections, libération de lot, quarantaine, non-conformités, HACCP | mig 572-576 |
| Audit & Traceability | Piste d'audit sur 278 tables, journal des transitions, rappel de lot | mig 578, 299 |
| Event & Notification | `emitEvent` sûr, 3 événements de production, règles de notification marche/arrêt | `services/events.ts` |

Autres acquis utiles : modèle exportable `kalum.config` v2, bilan de santé, mise en route par module, assistant en langage naturel, 1 045 gardes `can()` par action, test `never-sector-guard` qui interdit au code de comparer le code du secteur, jeu de référence de non-régression (`server/scripts/reference-snapshot.ts`, 7 familles, tolérance nulle).

---

## 3. Les 20 critères d'acceptation, aujourd'hui

| # | Critère | État | Écart principal |
|---|---|---|---|
| 1 | Configurer une entreprise sans code | Partiel | Vrai pour modules, vocabulaire, types d'ordre, politiques ; faux pour le parcours et les écrans |
| 2 | Plusieurs industries, un noyau | Partiel | 7 profils, mais un seul parcours possible |
| 3 | Héritage des profils | Absent | Copie à la création ; un niveau, vocabulaire seul (`sector.repository.ts:222-232`) |
| 4 | Capacités transversales réutilisables | Partiel | Lots, DLC, allergènes, traçabilité, pesage, qualité ne sont pas des capacités du catalogue : toujours actifs |
| 5 | Workflows configurables | Absent | Voir § 1 |
| 6 | Documents paramétrables | Partiel | Titre, colonnes, signatures oui ; caractère obligatoire, déclenchement, approbation non |
| 7 | Nomenclatures flexibles | Partiel | Versions, alternatives, substituts, co-produits présents ; format lié au contenant de boulanger, emballage hors nomenclature, pas de lot standard (§ 4 bis) ; variantes d'article inexistantes |
| 8 | Interfaces réellement adaptées | Absent | Masquage et renommage seulement |
| 9 | Formulaires et tableaux selon le processus | Absent | Tables écrites à la main dans chaque écran ; champs personnalisés relégués en bas de fiche |
| 10 | Écrans adaptés au rôle | Partiel | Droits par action oui ; aucune vue ni tableau de bord par rôle |
| 11 | Boulangerie hérite de l'agroalimentaire | Absent | `boulangerie` n'a pas de profil parent (mig 468) |
| 12 | Spécialisations activables | Absent | Elles existent sous forme de **rôles** en dur (`shared/.../roles.ts:1-90`) |
| 13 | Configurations isolées entre entreprises | Partiel | Aucun `tenant_id` ; `company_settings` est une ligne unique. Isolées seulement si une base par client |
| 14 | Mouvements exacts et traçables | Atteint | Idempotence HTTP absente des routes de production (protégée par verrous) |
| 15 | Coûts cohérents avec la comptabilité | Partiel | Aucune écriture comptable de production (inventaire intermittent) ; pas de coût machine réel |
| 16 | Configurations versionnées | Partiel | Une version couvre secteur, modules, options, diffusion, politiques ; pas les 8 autres couches |
| 17 | Historiques préservés | Partiel | Nomenclature figée sur l'ordre ; drapeaux du type d'ordre et politiques relus en direct |
| 18 | Processus existants préservés | Atteint | Garanti tant que chaque réglage a pour défaut le comportement boulangerie |
| 19 | Non-régression vérifiée | Partiel | ~100 fichiers de test production ; 2 scénarios abandonnés en `.wip` ; jeu de référence lancé à la main |
| 20 | Performant, maintenable | Atteint | Monolithe modulaire ; à conserver |

---

## 4. Écarts structurants, par ordre d'importance

**E1 — Parcours figé.** `PLAN_TRANSITIONS`, `BON_TRANSITIONS`, `fn_production_transition_allowed`. Deux drapeaux du type d'ordre (`requires_weighing`, `requires_quality_check`) sont stockés mais lus par aucune garde.

**E2 — Héritage par copie, pas de spécialisations.** Modifier `fabrication` ne change pas ses profils enfants. Les métiers de bouche vivent dans les rôles `baker`, `pastry_chef`, `viennoiserie`, `beldi_sale`, la table `ROLE_CATEGORY_SLUGS`, un CHECK sur `roles.base_role` (mig 330:37), `chefRoles` en dur (`notification.repository.ts:190`) et les suffixes BOUL/PAT/VIEN/BELD (`replenishment.repository.ts:202`).

**E3 — Catalogue de capacités trop étroit.** Huit options, aucune dépendance entre elles, aucune notion de capacité obligatoire ou réglementaire.

**E4 — Écrans figés.** 677 occurrences de termes de boulangerie côté client ; « ingrédient » jamais sectorisé (374 occurrences) ; `RendementPanel` enregistre `masse_petrie_kg`, `patons_nombre` ; coût « par fournée » dans `NomenclatureEditor` ; `report_keys` stocké mais consommé par aucun écran ; aucun écran opérateur tactile.

**E5 — Magasin structuré autour de la boulangerie.** `economat_quantity` / `pesage_quantity` en colonnes (~140 références), destinations `MAGASIN` / `FRIGO` en dur, stock produit fini à deux compartiments vitrine / réserve. `stock_locations` existe mais n'est qu'un miroir (mig 570).

**E6 — Versionnement incomplet et pas de gel sur l'ordre.** Un changement de politique ou de type d'ordre s'applique aux ordres en cours (signalé, non bloqué, sauf les étapes du type d'ordre).

**E7 — Documents non pilotables.** Rendement, transfert, non-conformité sont imposés par le code ; aucune approbation sur l'ordre, le démarrage, la clôture, la libération.

**E8 — Comptabilité de production absente.** Voulu aujourd'hui (inventaire intermittent), mais bloquant pour un industriel en inventaire permanent.

**E9 — Variantes d'article inexistantes.** Bloquant pour le textile uniquement.

**E10 — Isolation multi-entreprise.** Aucune colonne d'entreprise sur les tables de configuration.

**E11 — Fiche technique verrouillée sur la boulangerie.** Détail au § 4 bis.

---

## 4 bis. Fiche technique : boulangerie-pâtisserie face à l'agroalimentaire

Source : lecture du schéma et des données de la base de développement `ofauria_db` (migration 630), en lecture seule, le 2026-11-22. Cette base est issue d'une simulation (30 fiches, 32 formats, 21 articles, 38 matières) : les chiffres d'usage sont à confirmer sur la production avant tout retrait.

### Ce qui est déjà bon

- **Le modèle à deux niveaux existe et c'est le seul utilisé.** 26 fiches actives sur 27 sont en mode `compose` : une composition de base (`recipe_components`, 127 lignes sur 29 fiches) et une nomenclature par format (`recipe_format_components`, 133 lignes sur 31 formats). C'est le schéma « vrac + présentation » de l'agroalimentaire. Il n'est pas à reconstruire.
- Les deux métiers décrivent le même objet avec des mots différents :

| Boulangerie / pâtisserie | Agroalimentaire conditionné | Objet commun |
|---|---|---|
| Recette de base (pâte, crème) | Vrac, semi-fini | Fiche de niveau intermédiaire (`recipes.is_base`) |
| Format (cadre, moule, pièce de 80 g) | Présentation (pot 250 g, carton de 12) | Format de sortie (`recipe_formats`) |
| Fournée | Lot standard | Quantité de référence de la fiche |
| Entremets = plusieurs bases par format | Produit fini = vrac + emballages | Nomenclature par format |

- **Les champs propres à la boulangerie sont presque vides**, donc les sortir du tronc commun ne déplace presque aucune donnée :

| Champ | Renseigné |
|---|---|
| `recipes.pieces_par_fournee` | 0 fiche sur 27 |
| `recipes.hydratation_pct`, `temperature_pate_cible_c` | 1 fiche |
| `recipe_formats.poids_cru_g`, `poids_cuit_g` | 0 format sur 32 |
| Étapes structurées (`recipes.etapes`) | 3 fiches, 12 étapes |
| `recipe_outputs`, `recipe_line_substitutes` | 0 ligne |
| `role` des lignes de composition | vide sur les 260 lignes |

### Dette à solder d'abord

- Quatre tables de l'ancien modèle sont vides : `recipe_ingredients`, `recipe_sub_recipes`, `recipe_packaging`, `produit_profil_production`. Les vues de coût et d'allergènes (`v_recipe_allergens`, `v_recipe_explosion`…) les lisent encore.
- Deux historiques de versions coexistent : `recipe_versions` (71 lignes) et `bom_versions` (24 lignes, le seul figé sur l'ordre).
- Les vues de première génération (`v_recipe_total_cost`, `v_recipe_component_cost`…) subsistent à côté des `_v2`.

### Les six verrous

| # | Verrou | Preuve | Conséquence pour l'agroalimentaire |
|---|---|---|---|
| V1 | Le format est lié à un contenant de boulanger | Les 32 formats ont un `contenant_id` ; `production_contenants` porte des dimensions en cm, `type_production` de 1 à 5 (CHECK), `unite_lancement` = cercle, cadre, fournee, kg_pate | Un pot, un sachet ou un carton ne se décrit pas |
| V2 | L'emballage est un coût, pas un composant | `recipe_formats.cout_emballage_unitaire` ; `recipe_packaging` vide | Pots, opercules et cartons ne sont ni réservés ni consommés en stock |
| V3 | Durée de vie plafonnée à 365 jours | CHECK `products_shelf_life_days_range` ; aucune nature de date sur l'article (DLC / DDM n'existe que sur `ingredient_lots`, mig 428) | Un produit sec ou une conserve à 24 mois est refusé |
| V4 | Rendement et quantités figés | `recipe_formats.rendement_unite` ∈ {unit, kg} ; `quantite_par_format_unite` limitée par CHECK ; `recipes.yield_unit` = unit ou kg | Pas de rendement en litres, pas de lot standard, pas de formule en pourcentage |
| V5 | Étiquetage amorcé mais vide | `products.legal_name`, `storage_conditions`, `label_mentions` renseignés sur 0 article sur 21 ; allergènes et traces sur la matière ; aucune colonne nutritionnelle dans le schéma | Pas de liste d'ingrédients générée, pas de déclaration nutritionnelle |
| V6 | Mode de vente de l'article figé | CHECK `sale_type` ∈ {jour, dlv, commande}, `sale_unit` ∈ {unit, weight, person} | Cycle de vie pensé pour la vitrine |

### Cible : une fiche, des facettes

Le tronc commun reste : en-tête, composition, formats, sorties, étapes ou gamme, versions, coût. Ce qui diffère devient une **facette** — un bloc de champs et un panneau d'écran activés par une capacité, jamais par le nom du secteur.

| Facette | Portée par | Contenu |
|---|---|---|
| Allergènes et traces | Agroalimentaire (héritée) | Déjà en place |
| Date limite | Agroalimentaire (héritée) | Durée, nature DLC ou DDM |
| Étiquetage | Agroalimentaire (héritée) | Dénomination, conservation, liste d'ingrédients, nutrition |
| Procédé et points critiques | Agroalimentaire (héritée) | Paramètres d'étape, limites critiques |
| Conditionnement | Agroalimentaire, éteinte par défaut en boulangerie | Niveaux unité, carton, palette ; emballages en composants |
| Contenant de cuisson | Boulangerie | Cadre, moule, plaque, découpe |
| Cru / cuit | Boulangerie | Poids cru, poids cuit, freinte par étape |
| Pâte | Boulangerie | Hydratation, température de base |
| Fiche bilingue | Boulangerie | Champs darija |

## 5. Choix d'architecture recommandés

1. **Rester en monolithe modulaire.** Les douze « moteurs » du prompt deviennent des services du serveur actuel, pas des microservices.
2. **Le workflow n'est pas un BPMN.** Un « modèle de processus » par type d'ordre : une liste d'étapes versionnée, chacune avec prédécesseurs (d'où le parallélisme), gardes et actions prises dans un **catalogue fermé** écrit en code. L'administrateur compose ; il n'écrit jamais de règle libre. C'est ce qui garde les mouvements de stock sûrs.
3. **Les statuts techniques restent.** `draft / confirmed / in_progress / completed / cancelled` deviennent des catégories ; chaque étape configurée se rattache à une catégorie. Rapports, intégrations et comptabilité ne voient pas la différence.
4. **Héritage + composition.** Un profil = parent + capacités ajoutées − capacités retirées, résolu à la lecture. Une spécialisation = paquet de capacités, d'ateliers, de catégories, de types d'étape et de vocabulaire, cumulable.
5. **Écrans : définitions en données, panneaux métier en code.** Listes, colonnes, filtres, sections, ordre et visibilité par rôle sont des métadonnées. Les panneaux réellement métier (bilan massique de pâte, température de base, coupe de cadre, matrice taille × couleur) restent des composants écrits à la main, **enregistrés par capacité**. C'est la seule façon d'obtenir des écrans vraiment spécialisés sans réécrire un générateur d'interface complet.
6. **Règle déjà en vigueur, à étendre** : tout réglage a pour valeur par défaut le comportement actuel d'Ofauria ; le code ne teste jamais le secteur.

---

## 6. Plan d'action

> Résumé. La version à suivre pour l'exécution — directives permanentes, détail de chaque étape (données, serveur, écran, tests, acceptation), jalons, décisions et tableau de suivi — est dans `PLAN_EXECUTION_PRODUCTION_MULTI_INDUSTRIES.md`. Maquettes des écrans cibles : https://claude.ai/artifact/Ts1aYnDbKw1atoUqtPjkrC

Chaque lot se termine par : suite de tests verte, jeu de référence à zéro écart sur la base Ofauria, et une configuration effective d'Ofauria identique avant et après. Aucune migration destructive ; aucun déploiement en production sans validation.

Taille : S (1-3 jours), M (1-2 semaines), L (3-5 semaines), XL (2 mois et plus), en temps de travail effectif.

### Étape 0 — Filet de sécurité · S

- Brancher `reference-snapshot.ts` sur une commande `npm` et l'exiger avant fusion.
- Réécrire les deux scénarios abandonnés (`scenarios-production`, `scenarios-stock` en `.wip`).
- Figer le parcours Ofauria complet (plan → bon de sortie → pesage → production → transfert → invendus) comme **scénario A**, test de base rejoué à chaque lot.
- Acceptation : un changement volontaire d'une transition fait échouer le scénario A.

### Étape 1 — Catalogue de capacités · M

- Étendre `app_features` en catalogue : `requires[]`, `kind` (fonction, réglementaire), `module_key`, portée.
- Y inscrire les capacités aujourd'hui implicites : lots, séries, DLC/DDM, allergènes, traçabilité amont/aval, pesage, contrôle qualité, quarantaine, rappel, températures, rendements, pertes et rebuts, sous-traitance, co-produits, semi-finis, FIFO/FEFO.
- Toutes actives pour la boulangerie (aucun changement). Brancher les gardes une à une, en commençant par `requires_weighing` et `requires_quality_check`, aujourd'hui décoratifs.
- Dépendances entre capacités vérifiées côté serveur ; une capacité réglementaire ne se désactive pas si un produit ou une juridiction l'exige.
- Risque : faible (déclaratif d'abord). Retour arrière : restauration de la version de configuration.

### Étape 2 — Héritage vivant, Agroalimentaire, spécialisations · M

- Résolution récursive de `base_sector` pour modules, capacités, vocabulaire, couche `profile` et données de départ. Les profils `process`, `discret`, `atelier` cessent d'être des copies.
- Créer le profil **Agroalimentaire** (lots, DLC, allergènes, HACCP, températures, quarantaine, rappel, FEFO). `boulangerie` devient son enfant ; `process` se scinde en agroalimentaire conditionné et cosmétique/chimie.
- Table des **spécialisations** : boulangerie, pâtisserie, viennoiserie, biscuiterie, traiteur et salé, beldi, chocolaterie. Sélection multiple. Chaque spécialisation apporte ateliers, catégories, types d'étape, vocabulaire.
- Acceptation : la configuration effective d'Ofauria (modules, options, libellés) est identique avant et après ; ajouter une capacité au parent la fait apparaître chez l'enfant.

### Étape 2 bis — Fiche technique générique · L, en six pas

Corrige l'écart E11 et les verrous V1 à V6 du § 4 bis. Dépend de l'étape 2 (profil Agroalimentaire et capacités). Les fiches Ofauria gardent leur comportement : chaque nouveauté a pour valeur par défaut l'état actuel.

- **2b-1. Solder la dette.** Compter les lignes des quatre tables vides sur la production ; si elles y sont vides aussi, les retirer des vues de coût et d'allergènes, puis les archiver (pas de suppression dans ce lot). Désigner `bom_versions` comme seul historique ; `recipe_versions` passe en lecture seule. Retirer les vues de première génération une fois sans appelant. *Acceptation : jeu de référence `recipe-costs` à zéro écart ; vue des allergènes identique fiche par fiche.*
- **2b-2. Séparer le contenant du format (V1).** `recipe_formats.contenant_id` devient facultatif ; le format porte lui-même quantité, unité et article produit. Le contenant de boulanger devient la facette « contenant de cuisson », active sous la capacité `contenants_cru_cuit`. Le CHECK `type_production` et la liste `unite_lancement` passent en référentiel. *Acceptation : un format sans contenant se crée, se chiffre et se lance en fabrication ; les 32 formats existants sont inchangés.*
- **2b-3. Emballage en composant (V2).** Rôle `emballage` sur les lignes de nomenclature de format, pointant vers les consommables en stock ; réservé et consommé comme une matière. Les rôles de ligne (aujourd'hui vides) deviennent obligatoires à la saisie : matière, semi-fini, emballage. `cout_emballage_unitaire` reste le repli quand aucune ligne d'emballage n'existe. *Acceptation : coût de revient identique pour Ofauria ; une fiche avec lignes d'emballage décrémente le stock d'emballages à la déclaration.*
- **2b-4. Quantité de référence et unités (V4).** Mode de la fiche au choix du profil : fournée (défaut boulangerie), lot standard, ou pourcentage ramené à une taille de lot. `yield_unit`, `rendement_unite` et `quantite_par_format_unite` lisent le référentiel d'unités au lieu d'un CHECK. *Acceptation : une formule saisie en pourcentage pour un lot de 500 kg donne les mêmes besoins que la même fiche saisie en quantités.*
- **2b-5. Date limite et cycle de vie (V3, V6).** Lever le plafond de 365 jours ; ajouter la nature de la date (DLC ou DDM) sur l'article, reprise sur le lot produit ; `sale_type` et `sale_unit` en référentiel. *Acceptation : un article à 730 jours en DDM se crée ; un lot périmé en DDM est signalé sans être bloqué à la vente, un lot en DLC reste bloqué.*
- **2b-6. Facette étiquetage (V5).** Valeurs nutritionnelles pour 100 g sur la matière ; calcul sur la fiche à partir de la composition et du rendement ; liste d'ingrédients générée par ordre pondéral décroissant, allergènes mis en évidence ; contrôle de complétude avant impression. Règles d'étiquetage portées par le pack pays, à faire valider par une personne compétente. *Acceptation : l'étiquette d'un produit composé de deux semi-finis liste les matières des deux niveaux dans le bon ordre.*
- Écrans : l'éditeur de fiche (`NomenclatureEditor`, 1 334 lignes) est découpé en panneaux par facette ; ce découpage est le premier cas d'usage du pas 10c.
- Risque : moyen. Les pas 2b-1 et 2b-3 touchent le calcul du coût ; le jeu de référence est la garde. Retour arrière : chaque pas est additif, sauf 2b-1 qui n'archive qu'après un cycle d'observation.

### Étape 3 — Sortir les métiers des rôles · M

- Retirer le CHECK de `roles.base_role`, les usages restants de `ROLE_GROUPS` (client : `ProductionLayout.tsx:23`, `OuvertureTab`, `JourneeBoutiquePage`), `ROLE_CATEGORY_SLUGS`, `chefRoles`, les suffixes de numéros.
- Tout passe par atelier + `can()` + spécialisation.
- Risque : moyen (touche les droits). Filet : l'instantané `route-rights.snapshot.json` existant.

### Étape 4 — Version complète et gel sur l'ordre · M

- Une version de configuration couvre les dix couches (aujourd'hui deux sur dix), avec états brouillon → publié et comparaison de deux versions.
- À la confirmation, l'ordre enregistre un instantané : drapeaux du type d'ordre, politiques résolues, version du modèle de processus. L'exécution lit l'instantané.
- Aperçu d'impact étendu aux couches production.
- Acceptation (scénario E du prompt) : publier une nouvelle configuration ne change rien à un ordre démarré.

### Étape 5 — Moteur de processus · XL, en cinq pas

- **5a.** Extraire les gardes et actions du code actuel en deux catalogues nommés, sans changer le comportement.
- **5b.** Tables `process_models`, `process_stages`, `process_stage_links`, versionnées ; générer en données le modèle « boulangerie standard » qui reproduit exactement les transitions actuelles.
- **5c.** Mode ombre : le moteur calcule la décision en parallèle de la machine à états et journalise tout écart. Bascule quand l'écart est nul sur le scénario A et sur une période réelle.
- **5d.** Éditeur : liste ordonnée d'étapes par type d'ordre (nom, responsable, document requis, champs obligatoires, gardes, actions, notifications, délai). Pas de canevas graphique à ce stade.
- **5e.** Étapes parallèles, embranchements conditionnels, reprise et annulation par étape.
- Acceptation : le parcours « mécanique » du prompt (commande → ordre → réservation → usinage → assemblage → contrôle → entrée en stock) se configure sans code et s'exécute de bout en bout.
- Risque : élevé. Retour arrière : la machine à états reste en place jusqu'à la fin de 5c.

### Étape 6 — Documents pilotables · M

- Registre des documents : activé, obligatoire, automatique ou manuel, étape de rattachement, approbation, série, gabarit.
- Étendre le moteur d'approbation (déjà générique) à l'ordre, au démarrage, à la clôture, à la libération, à la non-conformité.
- Règle écrite et testée : désactiver un document ne désactive jamais l'enregistrement dont l'intégrité dépend.

### Étape 7 — Qualité · S

- Points de contrôle « avant transfert » et « avant livraison » (aujourd'hui réception, en cours, final).
- Plans de contrôle exportables dans un profil (par famille plutôt que par article).

### Étape 8 — Magasin générique · L, le plus risqué

- Inverser la source de vérité : `ingredient_lot_locations` devient la table écrite ; `economat_quantity` et `pesage_quantity` deviennent des valeurs dérivées, conservées le temps d'un cycle.
- Économat et Pesage deviennent deux emplacements typés (« réserve » et « en-cours ouvert ») livrés par le profil boulangerie : le fonctionnement actuel est préservé, mais n'est plus dans le code.
- Destinations de produits finis et compartiments vitrine / réserve : emplacements typés.
- Réservation de matière par ordre ; idempotence sur les routes de production.
- Acceptation : jeu de référence `stock-lots` à zéro écart avant et après, sur la base Ofauria.

### Étape 9 — Coûts et comptabilité · M

- Coût machine réel (taux du poste × temps réel) ; composantes de coût en catalogue.
- Écritures de production en option (inventaire permanent). **Décision comptable préalable** : l'inventaire intermittent reste le défaut.

### Étape 10 — Interfaces adaptatives · XL, en sept pas

- **10a.** Composants `DataTable` et `FormLayout` dans le design system, pilotés par une définition.
- **10b.** Définitions d'écran en base : profil → société → rôle. Commencer par les listes Plans et Fiches techniques, puis la fiche d'ordre (les règles de `planPanelRules.ts` passent en données, ordre configurable).
- **10c.** Découper les écrans géants par capacité : rendement générique + panneau « bilan massique » ; fenêtre de lancement en étapes enregistrées (température de base, coupe, séries).
- **10d.** Vocabulaire : passer de 18 clés à la couverture complète (« ingrédient », « fournée », unités de coût).
- **10e.** Tableaux de bord par profil et par rôle, à partir du générateur de rapports existant ; consommer enfin `report_keys`.
- **10f.** Écran opérateur tactile plein écran pour l'atelier.
- **10g.** Configurateur : colonnes, filtres, sections, champs personnalisés placés dans une section, vues par rôle, aperçu, publication.
- Les droits et règles d'intégrité restent appliqués côté serveur.

### Étape 11 — Assistant de configuration et simulation · M

- Parcours en huit étapes du prompt, assemblé à partir de l'existant (choix du profil, spécialisations, modes de production, capacités, processus, aperçu des écrans).
- Simulation : dérouler un ordre fictif dans une transaction annulée (technique déjà utilisée par la migration 593).
- Publication = version de l'étape 4.

### Étape 12 — Profils de référence et scénarios B, C, D · L

- Agroalimentaire conditionné, mécanique/assemblage, cosmétique/chimie, menuiserie : un test de base par profil, plus une relecture par une personne du métier.
- Textile : dépend de l'étape 13.
- Pharmaceutique : hors périmètre tant qu'un client ne l'impose pas (signature électronique, dossier de lot, validation).

### Étape 13 — Variantes d'article · L, sur demande

- Attributs et variantes (taille, couleur, modèle, collection), matrice de saisie. À lancer seulement pour un client textile.

### Étape 14 — Isolation multi-entreprise · décision

- Une base par client : l'isolation est acquise, sans travail. Recommandé tant que le nombre de clients est faible.
- Base partagée avec `tenant_id` et sécurité par ligne (l'équivalent d'une VPD Oracle) : chantier de plusieurs mois, déjà cadré dans le plan de 2026-09.

### Ordre et dépendances

```
0 → 1 → 2 → 3
        2 → 2 bis → 12
        2 → 4 → 5 → 6 → 11 → 12
        1 → 7
        4 → 8 → 9
        1 → 10a-10d, puis 10e-10g après 5
13 et 14 : hors chemin critique
```

Chemin critique : 0, 1, 2, 4, 5. Les étapes 2 bis, 3, 7 et 10a-10d peuvent avancer en parallèle. L'étape 2 bis est un préalable au profil agroalimentaire conditionné de l'étape 12.

---

## 7. Décisions à prendre

1. **Isolation** : une base par client, ou base partagée ? (étape 14)
2. **Comptabilité de production** : rester en inventaire intermittent par défaut ? (étape 9, avec le comptable)
3. **Éditeur de processus** : la liste ordonnée d'étapes suffit-elle, ou faut-il un canevas graphique ? (étape 5d)
4. **Premier client hors boulangerie** : son secteur fixe l'ordre des étapes 12 et 13.
5. **Spécialisations** : la liste de l'étape 2 est celle du prompt ; à valider avec le métier.
6. **Étiquetage** : quelles règles appliquer (pas 2b-6) et qui les valide.
7. **Tables de l'ancien modèle de fiche** : accord pour les archiver si elles sont vides en production (pas 2b-1).

## 8. Limites de cette analyse

- Aucun écran n'a été ouvert ni aucun test lancé : l'analyse porte sur le code et sur les captures fournies.
- Le § 4 bis s'appuie en plus sur la base de développement, lue sans rien y écrire. Elle sort d'une simulation : l'usage réel des champs et des tables est à mesurer sur la production.
- Les décomptes d'occurrences incluent commentaires et identifiants.
- Les tailles sont des ordres de grandeur, pas des engagements.
- Les migrations 507 à 630 ne sont pas toutes en production ; ce plan suppose qu'elles le seront avant l'étape 2.
