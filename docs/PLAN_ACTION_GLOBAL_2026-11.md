# Plan d'action global Kalum — 2026-11

Ce document traduit en tâches l'audit `docs/AUDIT_GLOBAL_ERP_2026-11.md` (constats) et le plan « Production paramétrable » M0-M9 (section 8 de l'audit).
État de référence du code : `main` @ 620dc67, dernière migration `518`.

**Deux objectifs.** Fiabiliser l'existant (lots G) et rendre le module Production **paramétrable et configurable selon l'industrie** (lots M et tâches C). Le second est décrit en section 2 ter : résultat attendu, profil d'industrie, matrice par industrie, parcours de l'administrateur, critère de réussite.

## Sommaire

1. [Mode d'emploi](#1-mode-demploi)
2. [Vue d'ensemble et dépendances](#2-vue-densemble-et-dépendances)
   - [2 bis. Module Production : diagnostic, principes et plan M0-M9](#2-bis-module-production--diagnostic-principes-et-plan-m0-m9)
   - [2 ter. **L'objectif central : une Production paramétrable et configurable selon l'industrie**](#2-ter-lobjectif-central--une-production-paramétrable-et-configurable-selon-lindustrie)
3. [Lot 1 — G0 + M0 : sécuriser l'existant](#3-lot-1--g0--m0--sécuriser-lexistant)
4. [Lot 2 — G1 + M1 : allumer, planifier, paramétrer](#4-lot-2--g1--m1--allumer-planifier-paramétrer)
5. [Lot 3 — G2 : données maîtres et étiquetage](#5-lot-3--g2--données-maîtres-et-étiquetage)
6. [Lot 4 — G3 : exploitation](#6-lot-4--g3--exploitation)
7. [Lot 5 — G4 : trésorerie](#7-lot-5--g4--trésorerie)
8. [Lot 6 — M2 + rôles configurables](#8-lot-6--m2--rôles-configurables)
9. [Lot 7 — G5 : planification et stock](#9-lot-7--g5--planification-et-stock)
10. [Lot 8 — M3 : unités et mesures](#10-lot-8--m3--unités-et-mesures)
11. [Lot 9 — M4 à M7 : production industrielle](#11-lot-9--m4-à-m7--production-industrielle)
12. [Lot 10 — G6 : socle multi-client](#12-lot-10--g6--socle-multi-client)
13. [En continu — M8, G7, M9](#13-en-continu--m8-g7-m9)
14. [Documents à mettre à jour](#14-documents-à-mettre-à-jour)
15. [Tableau de suivi](#15-tableau-de-suivi)

---

## 1. Mode d'emploi

### Lecture d'une tâche

Chaque tâche porte un identifiant (`G0-07`, `M2-03`…) et suit la même trame :

- **Constat** : ce qui ne va pas, avec le fichier et la ligne.
- **Étapes** : dans l'ordre d'exécution.
- **Base** : ce qui change dans le schéma (migration).
- **Tests** : ce qui doit être écrit ou rejoué.
- **Fini quand** : le critère vérifiable.
- **Impact client** : ce que l'utilisateur de la boulangerie verra changer.

### Niveau de confiance des constats

- **[relu]** : constat relu deux fois dans le code.
- **[1 lecture]** : constat issu d'une seule analyse. La première étape de la tâche est de le relire et de le reproduire.
- **[non relu]** : constat repris de l'audit Production sans relecture. Même règle.

Les numéros de ligne datent du commit 620dc67 : à recaler au moment de commencer.

### Règles communes à toutes les tâches

1. **Numéro de migration** : prendre le suivant libre au moment d'écrire, après avoir vérifié les migrations déjà sur `main` (pas seulement le dossier de travail). Aujourd'hui : 519.
2. **Fonctions SQL anciennes** : jamais de `CREATE OR REPLACE` sur une fonction créée avant le changement de propriétaire en production. Créer une nouvelle fonction (`fn_xxx_v2`) et basculer les appels.
3. **SQL sensible** : tester la fonction ou la requête en `pg_temp` avec `ROLLBACK` sur l'instance locale 5432 avant d'écrire la migration.
4. **Paramètres numériques PostgreSQL** : caster `$N::numeric` dans `GREATEST`, `LEAST` et les comparaisons.
5. **Unités à l'écran** : toujours l'unité saisie ; la conversion en unité de base reste interne.
6. **Écrans** : gabarits existants (`ui-timeline`, `odoo-table`, `StatusBanner`, `SearchSelect` pour les listes longues), boutons `odoo-btn-*`, style Apple.
7. **Git** : n'indexer que les fichiers de la tâche (jamais `git add -A`), commit direct sur `main`, pas de PR. Le push vers `origin` se demande.
8. **Données de production** : toute correction de données (rattrapage) est préparée en lecture seule, chiffrée, puis soumise pour accord avant exécution.
9. **Jeu de référence** (tâche `G0-00`) : rejoué avant et après chaque tâche marquée « change des chiffres ».
10. **Une tâche = un commit** contenant le code, la migration et les tests.

---

## 2. Vue d'ensemble et dépendances

| Ordre | Lot | Objet | Nb de tâches | Dépend de |
|---|---|---|---|---|
| 1 | G0 + M0 | Corriger les défauts de l'existant | 28 | — |
| 2 | G1 + M1 | Allumer les contrôles, planifier, paramétrer | 16 | G0 |
| 3 | G2 | Données maîtres, étiquetage | 10 | — |
| 4 | G3 | Exploitation | 11 | — |
| 5 | G4 | Trésorerie | 3 | — (parallèle) |
| 6 | M2 + rôles | Ordre de fabrication, droits | 8 | G3 |
| 7 | G5 | Stock à la date, point de commande, besoins phasés | 6 | M2 |
| 8 | M3 | Unités et mesures | 6 | G2, G0-00 |
| 9 | M4 à M7 | Nomenclature, gamme, consommation, qualité | 16 | G2 ; G5 pour M6 |
| 10 | G6 | Socle multi-client | 8 | G3 |
| continu | M8, G7, M9 | Écrans pilotés, finitions, plus tard | liste | — |

G2, G3 et G4 ne dépendent de rien : ils peuvent avancer en parallèle du lot 1.

---

## 2 bis. Module Production : diagnostic, principes et plan M0-M9

Cette section reprend la revue « Production paramétrable et multi-industrie » telle qu'elle a été rendue, puis indique où chaque élément est traité dans ce document.

### Diagnostic

Le plan P0-P11 a neutralisé l'enveloppe : activation des modules, ateliers, référentiels de procédé, vocabulaire des menus. Le cœur reste un « plan de fournée du jour ».

| # | Constat | Détail | Traité par |
|---|---|---|---|
| D1 | L'ordre de fabrication n'existe pas vraiment | `production_plans` n'a ni numéro, ni type d'ordre, ni priorité, et une seule date. Son seul type est `daily` / `weekly` | M2-01, M2-02 |
| D2 | Le flux est figé deux fois | Les 30 transitions sont en TypeScript (`production-state.ts`) et en SQL (migration 299). L'étape bon de sortie est obligatoire ; les statuts de ligne n'ont aucune contrainte | M2-03 |
| D3 | Les droits passent par les rôles boulangerie | `ROLE_GROUPS.PRODUCTION` garde presque toutes les routes ; les actions sur un plan ne vérifient pas l'appartenance à l'atelier | M2-04 à M2-07 |
| D4 | Les unités sont masse / volume seulement | `fn_unit_conv` renvoie 1 pour toute autre unité, sans erreur. Colonnes en `_g` / `_kg` ; coût réparti au ratio de poids | G0-26, M3-01 à M3-06 |
| D5 | Une seule nomenclature par article | Pas de version figée sur l'ordre, ni validité, ni alternative, ni co-produit déclaré | M4-01 à M4-06 |
| D6 | Les gammes sont décoratives | `routing_id` n'est jamais écrit par le serveur : les étapes exécutées viennent du JSON `recipes.etapes` | M5-01 à M5-05 |
| D7 | Une vingtaine de constantes métier en dur | Rendement 90 / 85 / 70, charges 0,40, 191 h / mois, kWh 1,50, marge ×3, horizon 14 jours, vitrine 07:00, équipe coupée à 14 h, « DH », fuseau | M1-01 à M1-04 |
| D8 | Les écrans ne sont pas pilotés par la configuration | `PlanDetailPage.tsx` n'a aucun panneau conditionné ; `ProductionLaunchModal.tsx` ne lit ni option ni vocabulaire ; le coût est recalculé dans le navigateur | G0-23, M8-01 à M8-06 |
| D9 | Ni champs personnalisés ni lien qualité | `quality_inspections` n'a aucune clé vers un ordre ou un lot | M4-07, M7-01 à M7-05 |

### Principes d'architecture

1. **Paramètres à héritage** : société → établissement → atelier → type d'ordre → article. C'est l'équivalent des *profile options* d'Oracle (Site / Application / Responsibility / User) : la valeur la plus précise gagne. Le niveau « établissement » est ajouté par rapport à la revue d'origine, parce que le paramétrage par établissement existe déjà.
2. **États canoniques figés, parcours paramétrable.** Pas de workflow libre : le stock, le coût et la traçabilité s'accrochent aux états. Le type d'ordre décide des étapes sautées.
3. **Le code lit une politique ou une option, jamais le secteur.** Règle déjà en place, à ne pas enfreindre.
4. **Le spécifique boulangerie devient des extensions, pas des colonnes du socle** : pâtons, température de base, vitrine, darija.
5. **Chaque lot est additif** : la boulangerie doit tourner à l'identique.

### Les dix lots et leur effort

| Lot | Contenu | Effort | Où dans ce document |
|---|---|---|---|
| M0 Assainissement | Corriger les anomalies ci-dessous | faible | Lot 1, G0-22 à G0-28 et G1-05 |
| M1 Politiques de production | Table de paramètres à héritage, un seul écran ; toutes les constantes en dur y passent | moyen | Lot 2, M1-01 à M1-04 |
| M2 Type d'ordre et flux | Table des types d'ordre (étapes requises, mode de consommation, séquence, atelier par défaut) ; numéro d'ordre via `document_sequences` ; priorité, dates de début et de fin ; machine à états des lignes ; droits par action selon l'atelier | élevé | Lot 6, M2-01 à M2-08 |
| M3 Unités et mesures | Conversions pilotées par données (nouvelle fonction, sans toucher `fn_unit_conv` en production), conversions par article, quantité + unité à la place des `_g`, clé de répartition du coût au choix, devise par helper | élevé | Lot 8, M3-01 à M3-06 |
| M4 Nomenclature industrielle | Versions avec statut et validité, version figée sur l'ordre, plusieurs nomenclatures par article, substituts, co-produits déclarés (généralise la coupe), champs personnalisés sur fiches, ordres et lots | élevé | Lot 9, M4-01 à M4-07 |
| M5 Gamme réelle | Opérations de gamme (réglage, exécution, poste, contrôle) instanciées sur l'ordre, reprise de `recipes.etapes`, calendrier des postes | élevé | Lot 9, M5-01 à M5-05 |
| M6 Consommation et stock | Sortie préalable, à la déclaration ou manuelle selon le type d'ordre ; emplacements à la place des zones économat / pesage et magasin / frigo ; motifs de rebut en référentiel unique | moyen | Lot 9, M6-01 à M6-04 |
| M7 Qualité liée | Inspections rattachées à l'ordre, l'opération et le lot ; plan de contrôle par article ; le CCP devient un cas particulier ; libération du lot bloquante | moyen | Lot 9, M7-01 à M7-05 |
| M8 Écrans pilotés | Panneaux de la fiche et du lancement sur registre (type d'ordre + options), une seule source de statuts, vocabulaire complet avec écran d'édition, gabarits d'impression, calculs remontés au serveur | élevé | En continu, M8-01 à M8-06 |
| M9 Plus tard | Sous-traitance, numéros de série, MRP multi-niveaux avec délais, lien ligne de commande ↔ ligne d'ordre | — | Voir ci-dessous |

Ordre conseillé par la revue : M0 → M1 → M2 → M3, puis M4 à M7 selon la première industrie visée, et M8 au fil de l'eau.

**Deux éléments de M9 sont avancés** par rapport à la revue d'origine, suite au croisement avec l'audit global :
- le MRP multi-niveaux avec délais passe en G5-04 (lot 7), parce que l'audit global le classe prioritaire ; ses défauts actuels sont corrigés dès G0-27 ;
- le lien ligne de commande ↔ ligne d'ordre passe en M2-08, parce que G5-06 (date promise) en dépend.

Restent en M9 : sous-traitance et numéros de série.

### Les huit anomalies de M0

| # | Anomalie | Tâche |
|---|---|---|
| 1 | Emballages consommés deux fois quand la production est déclarée par `produceItems` (`production.repository.ts:1590` et `:1620`) | G0-22 |
| 2 | Trois interrupteurs sans effet : Étapes, Rendement, Coût de revient | G1-05 |
| 3 | Charges saisies mais ignorées : loyer, énergie, autres charges | G0-23 |
| 4 | Saisies perdues au lancement : observations et quantités de bases | G0-24 |
| 5 | Pertes hors transaction, créées par des appels séparés | G0-24 |
| 6 | Coût incohérent : le tableau de bord exclut l'énergie, le calcul du plan l'inclut | G0-23 |
| 7 | Numéros fabriqués côté client : lot de repli, numéro de bon imprimé | G0-25 |
| 8 | Réglages en double : majoration et étapes bloquantes modifiables sur deux écrans | G1-05 |

### Impact de chaque lot sur la boulangerie en exploitation

Aucune table n'est supprimée ni renommée ; aucune donnée existante n'est réécrite de façon destructive. Le modèle boulangerie devient le premier paramétrage du socle : ce qui est en dur devient une ligne de configuration dont la valeur initiale est la valeur actuelle.

| Lot | Impact sur le modèle actuel | Risque |
|---|---|---|
| M0 | Corrige des comportements : le stock d'emballages ne baisse plus deux fois ; le coût affiché change si l'énergie et les charges sont enfin comptées | faible, mais des chiffres bougent |
| M1 | Une table de paramètres en plus ; les constantes y sont reprises à l'identique | faible |
| M2 | Colonnes ajoutées sur `production_plans`. Les 917 plans existants reçoivent un type « Plan du jour » qui reproduit le flux actuel. Les droits passent des rôles aux permissions et aux ateliers | moyen : une reprise fausse des droits peut bloquer un chef |
| M3 | Les colonnes `poids_cru_g`, `poids_cuit_g`… restent ; on ajoute quantité + unité à côté. Les vues de coût et de rendement sont recréées | élevé : c'est là que se calculent prix de revient et marges |
| M4 | La contrainte « une seule fiche par produit » est levée ; chaque fiche reçoit une version 1 active. Les plans passés ne sont pas rattachés à une version | moyen |
| M5 | Les étapes JSON des 52 fiches actives sont copiées en opérations de gamme. Le JSON reste lu tant que la bascule n'est pas validée | moyen |
| M6 | Économat et pesage deviennent deux emplacements ; « vers magasin / vers frigo » deviennent des destinations. Le mode de consommation actuel reste le défaut | élevé : touche aux mouvements de stock |
| M7 | Clés ajoutées sur les inspections ; les CCP et relevés actuels continuent tels quels | faible |
| M8 | Les grands écrans sont découpés en panneaux ; en boulangerie tous les panneaux actuels restent affichés | moyen (régression visuelle) |

**Trois points de vigilance.**
1. **Coût et marge (M3)** : toute recréation de vue de coût est comparée fiche par fiche, avant et après. Un écart d'un centime est un défaut.
2. **Stock (M6)** : le passage aux emplacements laisse les quantités par lot strictement identiques.
3. **Piège de production** : jamais de `CREATE OR REPLACE` sur une fonction ancienne. On crée une nouvelle fonction et on bascule les appels.

**Ce que la boulangerie y gagne.** Les réglages aujourd'hui inopérants fonctionnent ; les ordres ont un numéro et une priorité ; les quantités « vers magasin / frigo » acceptent les décimales ; les fiches techniques sont versionnées, donc un plan garde la recette avec laquelle il a été lancé.

**Décision sur les noms de tables.** Garder `production_plans` et `recipes` et ne changer que les libellés : un renommage toucherait environ 18 000 lignes côté serveur pour un gain nul.

---

## 2 ter. L'objectif central : une Production paramétrable et configurable selon l'industrie

C'est le but des lots M0 à M9. Tout le reste du plan Production est un moyen. Cette section dit ce que « configurable selon l'industrie » veut dire concrètement, ce qui existe déjà, ce qui manque, et comment on vérifie qu'on y est.

### 2 ter.1 Le résultat attendu

> Un administrateur installe Kalum pour une menuiserie, un laboratoire cosmétique ou un atelier de métallerie **sans qu'un développeur écrive une ligne de code** : il choisit un profil d'industrie, ajuste des réglages dans des écrans, et la Production se comporte comme son métier l'exige.

**Critère de réussite, vérifiable.** Sur une base vide en staging :
1. on charge un profil d'industrie autre que la boulangerie ;
2. on déroule un ordre de fabrication complet (création, lancement, consommation, déclaration, contrôle, clôture, coût) ;
3. aucun écran n'affiche un terme, un champ ou une étape de boulangerie ;
4. aucun fichier de code n'a été modifié pour y arriver.

Ce test est automatisé (tâche C-06) et rejoué à chaque lot.

### 2 ter.2 Ce qui existe déjà (plan P0-P11, livré)

Le socle de configuration est en place. Il ne faut pas le refaire, il faut l'étendre.

| Brique | Ce qu'elle fait | Où |
|---|---|---|
| Profil de secteur | Un secteur porte la liste de ses modules et de ses options par défaut | `sector_packs` (migrations 468, 507, 510) |
| Secteurs personnalisés | Une configuration peut être enregistrée comme nouveau secteur | migration 517, `config-templates.ts` (`saveModelAsSector`) |
| Activation des modules | Par société, puis par établissement, avec déploiement pilote | `company_module_settings`, `store_module_settings` (migrations 507, 509) |
| Options d'un module | Fonctions activables à l'intérieur d'un module (`dlc_jour`, `vitrine`, `contenants_cru_cuit`…) | `app_features`, `company_feature_settings`, `featureOn()` |
| Aperçu d'impact et retour arrière | Chaque changement de configuration est prévisualisé, versionné, annulable | `config_versions` (migration 508) |
| Ateliers | Ateliers paramétrables | migration 511, `WorkshopsCard.tsx` |
| Quantités décimales, unités libres | L'ordre n'est plus limité aux entiers | migrations 512, 515 |
| Référentiels de procédé | Types d'étape, d'équipement en données | migration 513 |
| Vocabulaire | Libellés des menus selon le secteur | migration 514 |
| Bilan de santé | Contrôles de cohérence de la configuration | migration 516 |
| Export / import d'une configuration | Modèle JSON réutilisable | `config-templates.ts` (`exportCurrentConfig`, `parseConfigModel`) |
| Données de départ | Catégories et articles d'exemple par secteur | `sector-starter.service.ts` |
| Garde serveur | Un module éteint refuse ses routes | `module-guard.middleware.ts` |

**Conclusion.** On sait déjà *allumer et éteindre* selon l'industrie. On ne sait pas encore *faire se comporter différemment* ce qui est allumé.

### 2 ter.3 Ce qui manque : les neuf axes de configuration

Chaque axe est une question à laquelle l'administrateur doit pouvoir répondre dans un écran, et à laquelle le code répond aujourd'hui tout seul, en boulangerie.

| Axe | Question de l'administrateur | Aujourd'hui | Après | Lot |
|---|---|---|---|---|
| A1 Règles de gestion | « Quel rendement cible, quel taux de charges, quel horizon de planification ? » | Une vingtaine de constantes dans le code | Politiques à héritage, réglables par société, établissement, atelier, type d'ordre, article | M1 |
| A2 Nature de l'ordre | « Je fabrique au jour le jour, sur commande, par lot, en continu ? » | Un seul type : plan du jour | Types d'ordre paramétrables : numérotation, étapes requises, priorité, dates | M2 |
| A3 Parcours | « Faut-il un bon de sortie, un pesage, un contrôle avant de produire ? » | Parcours unique, bon de sortie obligatoire | États fixes, étapes sautées selon le type d'ordre | M2 |
| A4 Droits | « Qui a le droit de lancer, de clôturer, dans quel atelier ? » | Rôles boulangerie en dur | Permissions par action, appartenance à l'atelier | M2 |
| A5 Mesures | « Je compte en kilos, en mètres, en pièces, en heures ? » | Masse et volume ; le reste vaut 1 en silence | Unités par dimension, conversions par article, clé de répartition du coût | M3 |
| A6 Composition | « Un article a-t-il plusieurs compositions, des versions, des substituts, plusieurs sorties ? » | Une fiche par article, sans version figée | Versions datées, alternatives, substituts, co-produits | M4 |
| A7 Procédé | « Par quels postes passe la fabrication, en combien de temps ? » | Étapes en texte libre, gammes non utilisées | Gammes avec opérations, postes, calendriers, instanciées sur l'ordre | M5 |
| A8 Matière et stock | « La matière sort avant, pendant ou après ? Où va le produit fini ? » | Sortie avant, zones économat / pesage, destinations magasin / frigo | Mode de consommation par type d'ordre, emplacements libres | M6 |
| A9 Qualité | « Que dois-je contrôler, quand, et qu'est-ce qui bloque ? » | Relevés CCP, inspections sans lien | Plan de contrôle par article, libération du lot | M7 |
| A10 Présentation | « Quels mots, quels blocs à l'écran, quels documents imprimés ? » | Écrans et termes de boulangerie | Panneaux sur registre, vocabulaire complet, gabarits | M8 |

### 2 ter.4 Le profil d'industrie

Le profil d'industrie est l'objet qui rassemble les réponses aux dix axes. Il prolonge le modèle de configuration existant (`ConfigModel` de `config-templates.ts`) : une configuration complète s'exporte en un fichier, s'importe ailleurs, et peut devenir un secteur proposé aux clients suivants.

Contenu du profil, dans l'ordre où il s'applique :

| Couche | Contenu | État |
|---|---|---|
| 1. Modules | Modules actifs | existe |
| 2. Options | Fonctions actives dans chaque module | existe |
| 3. Ateliers | Ateliers types et leur atelier par défaut | existe |
| 4. Référentiels | Types d'étape, d'équipement, motifs de rebut | existe en partie (motifs : M6-03) |
| 5. Politiques | Valeurs des règles de gestion (axe A1) | à ajouter (M1) |
| 6. Types d'ordre | Types, étapes requises, mode de consommation, séquence (A2, A3, A8) | à ajouter (M2, M6) |
| 7. Rôles | Rôles types et leurs permissions (A4) | à ajouter (M2) |
| 8. Unités | Unités actives, clé de répartition du coût (A5) | à ajouter (M3) |
| 9. Options de composition | Versions exigées ou non, approbation, co-produits (A6) | à ajouter (M4) |
| 10. Gammes types | Postes et calendriers types (A7) | à ajouter (M5) |
| 11. Emplacements | Emplacements types par établissement (A8) | à ajouter (M6) |
| 12. Plans de contrôle | Contrôles types par famille d'article (A9) | à ajouter (M7) |
| 13. Champs personnalisés | Champs propres au métier sur fiches, ordres, lots | existe (à brancher : M4-07) |
| 14. Vocabulaire | Tous les termes du module (A10) | existe pour les menus (à compléter : M8-03) |
| 15. Panneaux et gabarits | Blocs affichés, documents imprimés (A10) | à ajouter (M8) |
| 16. Numérotation | Séquences des ordres, des lots, des bons | existe (`document_sequences`) |
| 17. Données de départ | Catégories, articles et fiches d'exemple | existe |

**La boulangerie devient le premier profil.** Chaque valeur aujourd'hui en dur devient la valeur de ce profil. Rien ne change pour le client actuel.

### 2 ter.5 Matrice de paramétrage par industrie

Valeurs **proposées**, à valider avec un vrai client de chaque industrie avant de livrer le profil.

| Réglage | Boulangerie (actuel) | Process (cosmétique, agroalimentaire) | Discret sur stock (meuble en série) | Atelier à la commande (métallerie, sur-mesure) |
|---|---|---|---|---|
| Type d'ordre par défaut | Plan du jour | Ordre de lot | Ordre de série | Ordre à l'affaire |
| Déclencheur | Prévision + commandes du jour | Plan directeur | Stock mini / plan directeur | Commande client |
| Bon de sortie | Obligatoire | Obligatoire, avec pesée | Facultatif | Facultatif |
| Mode de consommation | Au bon de sortie | Au bon de sortie | À la déclaration | Manuelle, par affaire |
| Unités | kg, g, L, pièce | kg, L, pièce, flacon | pièce, m, m², panneau | pièce, m, kg, heure |
| Clé de répartition du coût | Poids | Poids ou quantité | Quantité | Manuelle ou heures |
| Nomenclature | Une fiche, par format | Formule versionnée et approuvée | Nomenclature multi-niveaux, alternatives | Nomenclature propre à l'affaire |
| Co-produits | Coupe d'un cadre | Fréquents | Chutes valorisées | Rares |
| Substituts | Rares | Encadrés (approbation) | Fréquents | Fréquents |
| Gamme | Étapes simples | Phases de procédé avec relevés | Opérations par poste, temps standard | Opérations par poste, temps réels |
| Planification | Du jour, vitrine à 07:00 | Par lot, capacité de cuve | Charge par poste, capacité finie | Par affaire, date promise |
| Traçabilité | Lot + DLC du jour | Lot + DLC + libération | Lot ou aucune | Numéro de série ou affaire |
| Contrôle qualité | CCP (températures) | Plan de contrôle, libération bloquante | Contrôle final par échantillon | Contrôle par opération |
| Emplacements | Économat, pesage, magasin, frigo | Matières, quarantaine, produits finis | Magasin, encours, expédition | Magasin, atelier, chantier |
| Vocabulaire | Fournée, pâton, vitrine | Lot, cuve, formule | Série, poste, nomenclature | Affaire, débit, pose |
| Options propres | DLC du jour, vitrine, contenants cru / cuit, darija | Allergènes, étiquetage réglementaire | Variantes, finitions | Devis technique, temps passés |
| Lots nécessaires | — (déjà en service) | M1, M2, M3, M4, M7 | M1, M2, M3, M4, M5, M6 | M1, M2, M3, M5 |

La dernière ligne donne le **jalon d'ouverture** de chaque industrie : c'est elle qui fixe l'ordre des lots M4 à M7.

### 2 ter.6 Parcours de l'administrateur : configurer une industrie pas à pas

Ce que fera un administrateur une fois les lots livrés. Chaque étape est un écran ; chaque écran affiche l'aperçu d'impact et reste annulable (mécanisme existant).

1. **Choisir le profil d'industrie** — Paramètres › Secteur. Un profil livré ou un fichier importé.
2. **Vérifier les modules et les options** — écran d'activation existant.
3. **Créer les ateliers** — carte Ateliers existante.
4. **Définir les types d'ordre** — nouveau (M2-01) : pour chacun, étapes requises, mode de consommation, numérotation, atelier par défaut.
5. **Régler les politiques** — nouveau (M1-04) : rendement cible, taux de charges, horizon, clé de répartition ; surcharges par atelier ou par type d'ordre.
6. **Choisir les unités** — nouveau (M3-01) : dimensions utilisées, unités actives.
7. **Attribuer les droits** — nouveau (M2-07) : rôles types du profil, à ajuster ; rattacher les personnes aux ateliers.
8. **Décrire le procédé** — nouveau (M5) : postes, calendriers, gammes types.
9. **Définir les emplacements** — nouveau (M6-02).
10. **Définir les contrôles** — nouveau (M7-02) : plans de contrôle par famille d'article.
11. **Ajuster les mots et les écrans** — vocabulaire (M8-03), panneaux affichés (M8-01), documents (M8-04), champs personnalisés (existant).
12. **Charger les données de départ** — existant.
13. **Lancer le bilan de santé** — existant, enrichi (C-04) : il signale ce qui manque avant de produire.
14. **Enregistrer la configuration comme profil réutilisable** — existant (`saveModelAsSector`), étendu (C-01).

### 2 ter.7 Règles de conception, à respecter dans chaque tâche

1. **Le code ne lit jamais le secteur.** Il lit une option (`featureOn`), une politique (`resolvePolicy`) ou un attribut du type d'ordre. Un test échoue si le code compare le code du secteur (C-07).
2. **Tout réglage a une valeur par défaut égale au comportement actuel.**
3. **Tout réglage passe par l'aperçu d'impact et l'historique de versions.**
4. **Tout réglage est exportable** dans le modèle de configuration. Un réglage non exportable n'est pas terminé.
5. **Tout réglage est contrôlé par le bilan de santé** quand il peut être incohérent (type d'ordre sans séquence, article sans unité convertible, contrôle bloquant sans rôle pour libérer).
6. **Aucune table par industrie.** Une industrie est un jeu de lignes dans des tables communes.
7. **Le spécifique d'un métier est une extension activable**, jamais une colonne lue sans condition par le socle.

### 2 ter.8 Tâches propres à la configuration par industrie

Ces tâches traversent les lots M1 à M8. Elles sont ce qui transforme une suite de fonctions en un produit configurable.

#### C-01 — Étendre le modèle de configuration

**Constat.** `config-templates.ts` exporte secteur, modules, options, vocabulaire, ateliers et référentiels. Les objets des lots M n'y sont pas.

**Étapes.**
1. Ajouter un numéro de version de schéma au modèle (`schema_version`).
2. À chaque lot, ajouter sa couche : politiques (M1), types d'ordre et rôles (M2), unités (M3), options de composition (M4), gammes et calendriers types (M5), emplacements et motifs (M6), plans de contrôle (M7), panneaux et gabarits (M8).
3. `parseConfigModel` valide chaque couche et renvoie des avertissements lisibles.
4. L'import d'un modèle d'une version antérieure reste accepté (couches absentes = valeurs par défaut).
5. Ne jamais exporter d'identifiants propres à la société (établissements, utilisateurs).

**Tests.** `config-templates.db.test.ts` : exporter, vider, importer → configuration identique.

**Fini quand.** Un export contient les 17 couches du profil.

#### C-02 — « Exportable et livré dans un profil » dans la définition de fini

**Étapes.** Ajouter à chaque tâche des lots M1 à M8 trois critères de fin : le réglage est dans le modèle de configuration ; il a sa valeur dans le profil boulangerie ; il a une valeur différente dans au moins un autre profil de référence (C-05), ce qui prouve qu'il est réellement paramétrable.

#### C-03 — Écran « Profil d'industrie »

**Constat.** `SectorTab.tsx` montre le secteur, les modules et les options.

**Étapes.**
1. Transformer l'onglet en page de pilotage : une tuile par couche du profil (section 2 ter.4), avec son état (configuré, par défaut, à compléter) et un lien vers l'écran de réglage.
2. Indicateur d'avancement de la configuration.
3. Actions : comparer avec le profil d'origine, exporter, enregistrer comme nouveau profil, revenir à une version antérieure.
4. Même style que l'accueil de configuration existant (`SetupHome.tsx`).

#### C-04 — Bilan de santé enrichi

**Étapes.** Ajouter aux contrôles de la migration 516 : type d'ordre sans séquence ou sans atelier ; étape requise par un type d'ordre mais module éteint ; article dont l'unité de fabrication ne se convertit pas vers l'unité de stock ; nomenclature sans version active ; gamme sans poste ou poste sans calendrier ; contrôle bloquant sans personne habilitée à libérer ; terme de vocabulaire resté sur la valeur boulangerie dans un autre profil.

#### C-05 — Trois profils de référence

**Étapes.**
1. Livrer trois profils en plus de la boulangerie : « Process », « Discret sur stock », « Atelier à la commande », selon la matrice 2 ter.5.
2. Chaque profil arrive avec ses données de démonstration (une dizaine d'articles, trois fiches, deux ateliers), sur le modèle de `sector-starter.service.ts`.
3. Les faire relire par une personne du métier avant de les proposer à un client.
4. Un profil n'est proposé dans l'écran que lorsque ses lots nécessaires sont livrés (dernière ligne de la matrice).

#### C-06 — Test d'acceptation automatisé par profil

**Étapes.**
1. Script `server/scripts/e2e-profil-industrie.ts` : base vide, chargement du profil, création d'un ordre, déroulé complet jusqu'au coût.
2. Vérifications : l'ordre suit le parcours du type d'ordre ; les unités sont celles du profil ; le coût est réparti selon la clé du profil ; aucun libellé de boulangerie dans les réponses de l'API.
3. Un test Playwright par profil vérifie qu'aucun panneau ni terme de boulangerie n'apparaît à l'écran.
4. Lancé en CI à chaque commit, pour les quatre profils.

**Fini quand.** Les quatre profils passent, et le profil boulangerie rend le jeu de référence à l'identique.

#### C-07 — Garde « jamais le secteur »

**Étapes.** Test qui parcourt `server/src` et `client/src` et échoue sur toute comparaison au code d'un secteur (`'boulangerie'`, `sector ===`, `sectorCode ==`) hors des fichiers de configuration ; liste blanche vide au départ, chaque exception se justifie par écrit.

#### C-08 — Mise en route guidée étendue

**Étapes.** Compléter les listes de tâches de mise en route par module (existant) avec les nouveaux objets : créer un type d'ordre, régler les politiques, déclarer les unités, créer une gamme, un plan de contrôle ; chaque tâche se coche seule quand la donnée existe. L'assistant en langage naturel (existant) propose aussi le type d'ordre, la clé de répartition et le mode de consommation.

#### C-09 — Aperçu d'impact étendu

**Étapes.** Étendre l'aperçu d'impact (existant pour les modules et les options) aux politiques, aux types d'ordre et aux unités : « ce changement touche N ordres ouverts, N fiches, N articles » ; refuser un changement qui rendrait un ordre ouvert incohérent.

#### C-10 — Guide « Configurer une industrie »

**Étapes.** Rédiger `docs/GUIDE_CONFIGURATION_INDUSTRIE.md` : le parcours 2 ter.6 avec captures, la matrice, un exemple complet par profil ; le relier à l'aide en ligne de l'écran Profil d'industrie.

### 2 ter.9 Jalons : quand une industrie devient vendable

| Jalon | Lots livrés | Ce qui devient possible |
|---|---|---|
| J0 | G0 + M0 | Boulangerie fiabilisée |
| J1 | M1 + M2 + C-01 à C-04, C-07 | Types d'ordre, règles et droits réglables. Un fabricant simple (assemblage, conditionnement) qui compte en kilos ou en pièces entières peut démarrer |
| J2 | M3 + M5 | **Atelier à la commande** : unités libres, gammes réelles, temps passés |
| J3 | M4 + M7 | **Process** : formules versionnées, co-produits, plan de contrôle, libération |
| J4 | M6 | **Discret sur stock** : consommation à la déclaration, emplacements |
| J5 | M8 + C-05, C-06, C-08 à C-10 | Écrans et documents entièrement pilotés ; profils livrés et testés |

L'ordre de J2, J3 et J4 s'inverse selon l'industrie visée en premier.

### 2 ter.10 Au-delà de la Production

Le même mécanisme (profil, options, politiques) s'applique aux autres modules couplés au métier d'origine : rôles en dur, caisse orientée restauration, catalogue et unités. Ils sont décrits dans `docs/AUDIT_COUPLAGE_SECTORIEL.md` et `docs/FEUILLE_DE_ROUTE_MULTI_SECTEUR.md`, et traités ici par M2-04 à M2-07 (droits), M3 (unités) et G6 (traductions, pays).

---

## 3. Lot 1 — G0 + M0 : sécuriser l'existant

Aucune fonction nouvelle. Chaque tâche ferme un défaut ouvert aujourd'hui.

### G0-00 — Construire le jeu de référence

**Constat.** Plusieurs tâches changent des chiffres (coût, stock, amortissements, TVA, paie). Rien ne permet aujourd'hui de comparer avant et après.

**Étapes.**
1. Créer `server/scripts/reference-snapshot.ts` avec deux commandes : `capture <nom>` et `compare <nomA> <nomB>`.
2. `capture` écrit un fichier JSON par famille dans `server/scripts/reference/<nom>/` :
   - `recipe-costs.json` : coût de chaque fiche active via `fn_recipe_cost`, par format.
   - `plan-yields.json` : pour 30 plans clôturés (10 récents, 10 avec semi-finis, 10 avec coupe), quantités prévues, produites, pertes, coût réel.
   - `stock-lots.json` : quantité par lot de matière, par lot de produit fini, par article d'emballage.
   - `trial-balance.json` : balance générale par compte à la date de capture.
   - `depreciation.json` : plan d'amortissement complet de chaque immobilisation.
   - `vat.json` : déclaration de TVA de chacun des 12 derniers mois.
   - `payroll.json` : brut, cotisations, IR et net de chaque bulletin des 3 derniers mois.
3. `compare` liste les écarts ligne par ligne, avec une tolérance nulle (un centime d'écart est signalé).
4. Ajouter le dossier `reference/` au `.gitignore` (données réelles).
5. Capturer l'état `avant-g0` sur la base locale.

**Tests.** Lancer `capture` deux fois de suite : `compare` doit rendre zéro écart.

**Fini quand.** `compare avant-g0 avant-g0-bis` rend zéro écart et le script est documenté en tête de fichier.

---

### Sécurité et données

### G0-01 — API publique de commande : prix imposé [relu]

**Constat.** `server/src/services/public-order.service.ts:66` utilise `it.unitPrice` tel quel s'il est fourni (négatif possible). Pas de validation, pas de clé d'idempotence, `taxAmount: 0` (ligne 91), `store_id` de la clé ignoré, pas de contrôle de crédit ni de réservation de stock.

**Étapes.**
1. Créer `server/src/validators/public-order.validator.ts` : schéma zod de la commande (articles 1 à 200, quantité > 0, références bornées en longueur).
2. Retirer `unitPrice` du schéma par défaut. Le prix vient toujours de `resolveSalePrice`.
3. Ajouter une portée de clé `orders:price_override`. Seule une clé qui la porte peut envoyer `unitPrice`, borné à `>= 0` et au prix plancher de l'article.
4. Lire l'en-tête `Idempotency-Key`. Créer la table `api_idempotency_keys (api_key_id, key, response_body, created_at)` avec unicité sur `(api_key_id, key)`. Une clé rejouée renvoie la réponse enregistrée.
5. Calculer la TVA par ligne avec le même helper que `order.controller.ts` au lieu de `taxAmount: 0`.
6. Forcer `store_id` à celui de la clé d'API.
7. Appeler le contrôle de blocage crédit (`credit_hold`) et la réservation de stock (migration 389) comme le fait la prise de commande interne.
8. Brancher `validate()` sur les trois routes de `public.routes.ts`.

**Base.** Migration : table `api_idempotency_keys`, portée ajoutée au référentiel des portées.

**Tests.** `public-order.db.test.ts` : prix négatif refusé ; prix envoyé sans portée ignoré ; même clé d'idempotence rejouée = une seule commande ; TVA non nulle ; client bloqué refusé.

**Fini quand.** Les cinq cas passent et aucune route de `/public` n'accepte une charge sans schéma.

**Impact client.** Aucun (l'API n'est pas encore utilisée par un tiers, à confirmer).

### G0-02 — Limiteur de débit sur `/public` et `/portal` [relu]

**Constat.** `server/src/app.ts:125-127` monte ces routes sans limiteur. Seules l'authentification et les clients en ont un.

**Étapes.**
1. Créer deux limiteurs dans le middleware existant : `publicApiLimiter` (par clé d'API, 120 requêtes / minute) et `portalLimiter` (par adresse IP, 60 / minute).
2. Les monter avant les routeurs dans `app.ts`.
3. Ajouter un limiteur global de dernier recours sur `/api/v1` (par IP, seuil large : 1 200 / minute).

**Tests.** Test d'intégration : la 121ᵉ requête de la minute reçoit 429.

**Fini quand.** Les trois limiteurs sont actifs et leurs seuils sont des variables d'environnement.

### G0-03 — Jeton de portail sans expiration [1 lecture]

**Constat.** `migrations/499_customer_portal.sql:8-17` : pas de `expires_at`. Le jeton est gardé en `localStorage` (`PortalPage.tsx:12-23`).

**Étapes.**
1. Migration : colonnes `expires_at` (défaut : création + 90 jours) et `last_used_at`.
2. Refuser un jeton expiré dans `portal.routes.ts` ; mettre à jour `last_used_at`.
3. Ajouter le bouton « Régénérer le lien » sur la fiche client et l'expiration au choix (30, 90, 365 jours).
4. Rattrapage : donner 90 jours aux jetons existants.

**Fini quand.** Un jeton expiré reçoit 401 et la fiche client affiche la date d'expiration.

### G0-04 — Fichiers sur disque éphémère, servis sans authentification [relu]

**Constat.** `multer.diskStorage` dans `accounting.routes.ts:40`, `products.routes.ts:20`, `upload.routes.ts:12` et `:48`. `app.ts:168` sert `/uploads` en statique, sans authentification. Sur Cloud Run, le disque est vidé à chaque révision.

**Étapes.**
1. Créer `server/src/services/storage.service.ts` avec une interface `put / get / delete / signedUrl` et deux pilotes : `local` (développement) et `gcs` (production).
2. Créer la table `files` : `id`, `bucket_key`, `original_name`, `mime`, `size`, `sha256`, `owner_type`, `owner_id`, `store_id`, `uploaded_by`, `created_at`. Elle servira aussi de socle aux pièces jointes génériques (G7).
3. Passer les quatre `multer` en `memoryStorage` avec taille maximale, puis écrire via `storage.service`.
4. Refuser `.svg` et vérifier le type réel du fichier par ses premiers octets (reliquat V9).
5. Créer la route `GET /api/v1/files/:id` : authentifiée, contrôle du droit sur l'objet propriétaire, puis redirection vers une URL signée de 5 minutes.
6. Remplacer dans le client toutes les URL `/uploads/...` par `/api/v1/files/:id`.
7. Retirer `express.static('/uploads')` de `app.ts`.
8. Créer le bucket privé, donner au compte de service de Cloud Run le rôle d'écriture, ajouter les variables `STORAGE_DRIVER` et `STORAGE_BUCKET`.
9. Rattrapage : lister les lignes dont l'URL pointe vers un fichier absent (factures fournisseurs, photos de pertes, de réclamations, de produits). Produire le rapport ; les fichiers perdus ne se récupèrent pas, ils devront être téléversés à nouveau.

**Base.** Migration : table `files`, colonnes `file_id` à côté des colonnes d'URL existantes.

**Tests.** Téléversement puis lecture avec et sans droit ; `.svg` refusé ; fichier d'un autre établissement refusé.

**Fini quand.** Un redéploiement ne fait plus disparaître une pièce jointe, et une URL de fichier copiée dans une fenêtre privée renvoie 401.

**Impact client.** Les pièces déjà perdues apparaîtront comme « à téléverser à nouveau ».

### G0-05 — Déploiement non conditionné à la CI [relu]

**Constat.** `.github/workflows/deploy.yml:3-6` se déclenche sur tout push `main`, indépendamment de `ci.yml`.

**Étapes.**
1. Remplacer le déclencheur par `workflow_run` sur la réussite de `ci.yml` (branche `main`), en gardant `workflow_dispatch`.
2. Ajouter à `ci.yml` une étape `npm audit --omit=dev --audit-level=high`.
3. Faire tester la base par `/health` (`SELECT 1` avec délai de 2 s) et ajouter `/health/live` sans dépendance.
4. `Dockerfile` : ajouter `USER node` et vérifier les droits des dossiers écrits (reliquat V7).

**Fini quand.** Un commit qui casse un test ne se déploie plus.

### G0-06 — Connexion par PIN [1 lecture]

**Constat.** `user.repository.ts:48-57` compare le PIN au hachage de chaque utilisateur, un par un. PIN de 4 chiffres accepté (reliquat V4).

**Étapes.**
1. Changer le parcours : l'utilisateur choisit d'abord son nom (tuile), puis saisit son PIN. Le serveur ne compare qu'un seul hachage.
2. Porter le minimum à 6 chiffres pour les nouveaux PIN ; signaler à l'administrateur les PIN de 4 chiffres existants.
3. Verrouiller le compte 15 minutes après 5 échecs (réutiliser le verrouillage du mot de passe) et journaliser dans `auth_events`.
4. Forcer le changement de mot de passe à la prochaine connexion pour les comptes antérieurs à la politique (colonne `must_change_password`).

**Base.** Migration : `must_change_password`, compteur d'échecs de PIN s'il n'existe pas.

**Fini quand.** Une tentative de PIN ne déclenche qu'une seule comparaison bcrypt et le sixième échec est refusé.

**Impact client.** Les caissiers choisissent leur nom avant de taper leur PIN.

### G0-07 — Factures fournisseurs sans validation d'entrée [1 lecture]

**Constat.** `accounting.routes.ts:122-123` (`POST` et `PUT /invoices`) et `/merge` n'ont pas de schéma. Sur l'ensemble du serveur, 61 mutations sur 420 passent par `validate()`.

**Étapes.**
1. Écrire `invoice.validator.ts` : en-tête, lignes, montants ≥ 0, taux de TVA dans le référentiel, dates cohérentes.
2. Le brancher sur les trois routes.
3. Générer la liste des mutations sans schéma avec `server/scripts/audit-droits-routes.ts` (l'étendre pour signaler l'absence de `validate`).
4. Traiter d'abord celles qui touchent l'argent ou le stock : règlements, encaissements, ajustements de stock, réceptions, paie.
5. Ajouter un test qui échoue si une nouvelle mutation est ajoutée sans schéma (liste blanche des exceptions).

**Fini quand.** Toutes les mutations des domaines argent et stock ont un schéma ; le test de garde est dans la CI.

### G0-08 — Reliquats de l'audit de sécurité

**Constat.** Dans `docs/AUDIT_SECURITE.md` : V2 (factures exposées, traité par G0-04), V3 (`xlsx 0.18.5`), V4 (traité par G0-06), V5 partiel, V7 (traité par G0-05), V9 (traité par G0-04), V11, V12, V13.

**Étapes.**
1. V3 : remplacer `xlsx` par `exceljs` pour la lecture des fichiers téléversés (import générique, import de relevés).
2. V5 : ajouter `authorize` sur `production-cout.routes.ts:17-27` et `products.routes.ts:50`.
3. V11 : élargir le `.gitignore` racine (`.env*`, `uploads/`, exports).
4. V12 : retirer le mot de passe par défaut de pgAdmin dans `docker-compose.yml`, n'exposer les ports que sur `127.0.0.1`.
5. V13 : supprimer le repli `Bearer` dans `client/src/api/client.ts:19`.
6. Mettre à jour `AUDIT_SECURITE.md` : état de chaque point.

**Fini quand.** Les treize points portent un état « corrigé » ou « accepté, raison ».

---

### Paie

### G0-09 — Pointages exclus de la paie après ré-enregistrement du planning [relu]

**Constat.** `employee.repository.ts:548` : à chaque enregistrement du planning, `is_expected` repasse à `true` pour tout pointage sans heure d'arrivée. Ces lignes sont exclues du calcul (`payroll-config.repository.ts:279`). Un salarié pointé « présent » sans heure perd son jour.

**Étapes.**
1. Reproduire : pointer un salarié présent sans heure, ré-enregistrer le planning, générer la paie.
2. Remplacer le `DO UPDATE` par `DO NOTHING` : le planning ne crée que les lignes manquantes et ne touche jamais une ligne existante.
3. Ajouter `updated_by` et `updated_at` sur l'upsert de pointage (`employee.repository.ts:620-640`).
4. Rattrapage en lecture seule : lister les pointages `is_expected = true`, sans heure, dont la date tombe dans une période déjà payée. Sortir la liste par salarié et par mois, avec le montant de jour en jeu.
5. Soumettre la liste ; décider avec le gérant d'une régularisation sur le bulletin suivant.

**Tests.** `attendance-planning.db.test.ts` : un pointage manuel sans heure survit à deux ré-enregistrements du planning et compte dans la paie.

**Fini quand.** Le test passe et le rapport de rattrapage est remis.

**Impact client.** Change des chiffres de paie à l'avenir (jours qui étaient perdus). Rejouer le jeu de référence.

### G0-10 — Paie générée sur un mois non terminé [1 lecture]

**Constat.** `employees.validator.ts:152-155` n'empêche pas de générer la paie d'un mois en cours : bulletin amputé, mais payable.

**Étapes.**
1. Dans le service de génération, refuser si la fin de période est postérieure à la date du jour.
2. Prévoir une dérogation explicite réservée à l'administrateur (`allowOpenPeriod`), qui marque le bulletin « provisoire » et interdit son paiement.
3. Afficher à l'écran la raison du refus et la date à partir de laquelle la génération sera possible.
4. Appliquer la même garde à l'hebdomadaire et à la quinzaine.

**Tests.** Génération refusée la veille de la fin de mois ; acceptée le lendemain ; bulletin provisoire non payable.

### G0-11 — Contrôle du SMIG [1 lecture]

**Constat.** Aucune trace d'un contrôle du salaire minimum.

**Étapes.**
1. Ajouter au barème de paie daté (`effective_from`) deux valeurs : SMIG horaire et SMIG mensuel. Les valeurs sont saisies par le client et validées par son comptable ; ne rien coder en dur.
2. À la génération, comparer le salaire de base ramené au temps travaillé au SMIG en vigueur à la date du bulletin.
3. Paramètre de politique : `avertir` (défaut) ou `bloquer`.
4. Afficher l'alerte sur le bulletin et dans le tableau de bord RH.

**Tests.** Salarié sous le SMIG : avertissement ; en mode bloquant : refus.

### G0-12 — Livre de paie [1 lecture]

**Constat.** Aucune édition du livre de paie.

**Étapes.**
1. Créer `server/src/services/payroll-book.service.ts` : une ligne par salarié et par mois (matricule, CNSS, jours, base, heures supplémentaires, primes, brut, CNSS, AMO, CIMR, IR, avances, net), totaux en pied.
2. Sorties PDF (paysage) et Excel, par mois ou par année.
3. Route `GET /payroll/book` réservée aux rôles de paie.
4. Entrée dans Personnel › Rapports.
5. Faire valider la présentation par le comptable du client avant diffusion.

**Tests.** Les totaux du livre égalent la somme des bulletins du mois.

### G0-13 — Barème IR modifiable en place [1 lecture]

**Constat.** Seul `PUT /tax-scales/:id` existe : une nouvelle loi de finances écrase le barème courant et fausse le recalcul des bulletins passés.

**Étapes.**
1. Ajouter `POST /tax-scales` qui crée une version datée (`effective_from`).
2. Interdire `PUT` dès qu'un bulletin a été calculé avec la version.
3. Écran : bouton « Nouvelle version » qui duplique la version courante, à modifier puis à dater.
4. Vérifier avec le comptable que le barème en base est bien celui de l'exercice en cours.

**Tests.** Un bulletin de l'an passé recalculé donne le même IR après création d'une nouvelle version.

### G0-14 — Paiement d'un bulletin hors transaction [1 lecture]

**Constat.** `employee.repository.ts:919-1052` enchaîne réservation, paiement et retenue sans transaction unique, avec compensation manuelle. Logique dupliquée dans `weekly-payroll.repository.ts:244` et `biweekly-payroll.repository.ts:210`.

**Étapes.**
1. Créer le helper `withTransaction(fn)` dans la couche base de données (il servira ensuite à remplacer les 282 `BEGIN` manuels, voir G3-09).
2. Extraire `payPayslip(client, { kind, payslipId, ... })` dans un service commun.
3. Y placer dans une seule transaction : verrou de la ligne (`FOR UPDATE`), contrôle `paid = false`, sortie de caisse, retenue des avances, écriture comptable.
4. Faire appeler ce service par les trois fréquences ; supprimer le code de compensation.
5. Remplacer les `console.error` des lignes 1045 et 1061 par le journal structuré.

**Tests.** Échec provoqué au milieu : rien n'est écrit. Double clic : un seul paiement.

**Impact client.** Aucun changement visible.

---

### Finance et stock

### G0-15 — Amortissement dégressif sans prorata [relu]

**Constat.** `depreciation.service.ts:94-126` : la première annuité est calculée sur une année entière puis étalée sur les mois restants. Le plan se termine trop tôt. Aucun test sur `computeSchedule`.

**Étapes.**
1. Faire confirmer la règle par l'expert-comptable (prorata en mois la première année, complément la dernière).
2. Écrire d'abord les tests avec des cas chiffrés à la main : acquisition en janvier, en juillet, en décembre ; durées 3, 5 et 10 ans ; bascule vers le linéaire.
3. Corriger : première annuité = base × taux × mois restants / 12 ; ajouter l'exercice de fin qui solde le reste.
4. Recalculer les plans des immobilisations dont aucune dotation n'est comptabilisée.
5. Pour celles qui ont déjà des dotations comptabilisées : produire l'écart cumulé par immobilisation et le soumettre. La régularisation passe par une écriture décidée par le comptable, jamais par une modification des écritures passées.

**Tests.** La somme du plan égale la base amortissable ; le nombre d'exercices est durée + 1 pour une acquisition en cours d'année.

**Impact client.** Change des chiffres. Jeu de référence `depreciation.json`.

### G0-16 — Régime de TVA [relu]

**Constat.** `ledger.repository.ts:841-866` prend la TVA collectée à la date d'écriture (facturation). Le paramètre `sales.vat_regime` (`migrations/485`, lignes 27-32) est informatif.

**Étapes.**
1. Décision à obtenir de l'expert-comptable : régime des débits ou des encaissements.
2. Si débits : rien à coder ; documenter le choix dans l'écran de paramétrage et retirer la mention « informatif ».
3. Si encaissements :
   1. Créer un compte de TVA facturée en attente et y diriger la TVA des factures à crédit.
   2. À l'encaissement, basculer la part de TVA correspondante vers le compte de TVA collectée, au prorata du règlement.
   3. Faire lire `sales.vat_regime` par `declaration()`.
   4. Ventes de caisse : inchangées (encaissement immédiat).
   5. Rattrapage : calculer la TVA des créances ouvertes à la date de bascule et proposer l'écriture de transfert.

**Tests.** Facture à crédit de janvier payée en mars : TVA déclarée en mars en régime encaissement, en janvier en régime débits.

**Impact client.** Change la déclaration si le régime bascule. Jeu de référence `vat.json`.

### G0-17 — TVA déductible non filtrée par établissement [1 lecture]

**Constat.** `ledger.repository.ts:873-889` : la requête de TVA déductible ignore `storeId`, alors que la collectée est filtrée (ligne 852).

**Étapes.**
1. Ajouter le filtre d'établissement aux trois sous-requêtes (déductible, en attente, exclue).
2. Vérifier que les factures sans établissement restent comptées dans la vue « tous établissements ».

**Tests.** Deux établissements : la somme des deux déclarations égale la déclaration globale.

### G0-18 — Sorties de stock écrêtées à zéro en silence [1 lecture]

**Constat.** `GREATEST(…, 0)` dans `production.repository.ts:1124` et `:1565`, `product-stock.helper.ts:35`, `product-lot.repository.ts:736` et `:946`. Une sortie supérieure au stock disparaît sans trace.

**Étapes.**
1. Relever toutes les occurrences (`grep "GREATEST("` dans `repositories/` et `services/`) et classer : écrêtage de stock ou autre usage.
2. Créer la table `stock_anomalies` : article, lot, établissement, quantité demandée, quantité disponible, manque, origine (type et identifiant du document), utilisateur, date, état (`ouverte`, `traitée`).
3. Créer le paramètre `stock.negative_policy` par famille d'article : `bloquer` ou `autoriser_et_tracer`. Valeur initiale : `autoriser_et_tracer` (comportement actuel, mais tracé).
4. Remplacer chaque écrêtage par un appel au helper `applyStockOut()` qui applique la politique et écrit l'anomalie.
5. Écran Stock › Anomalies : liste, filtre, bouton « Régulariser » (ouvre un ajustement motivé).
6. Notification au responsable de stock à chaque anomalie.

**Tests.** Sortie de 10 sur un stock de 6 : en mode tracé, stock à 0 et anomalie de 4 ; en mode bloquant, erreur.

**Impact client.** Apparition d'une liste d'anomalies. Prévenir le responsable de stock avant la mise en production.

### G0-19 — Remise en caisse sans plafond par rôle [relu]

**Constat.** `sale.controller.ts:177-183` borne la remise au sous-total seulement. Le plafond par rôle existe pour les commandes (`order.controller.ts:83`) et les devis (`quote.repository.ts:128`).

**Étapes.**
1. Extraire le calcul du plafond d'`order.controller.ts` dans `services/discount-policy.ts`.
2. L'appeler dans `sale.controller.ts` : remise en pourcentage du sous-total après promotions, comparée au plafond du rôle.
3. Au-delà du plafond : demander la validation d'un responsable par son PIN (dérogation tracée, comme pour les commandes).
4. Caisse : afficher le plafond sous le champ de remise et ouvrir la fenêtre de validation en cas de dépassement.

**Tests.** Caissier à 10 % : 8 % accepté, 15 % refusé, 15 % accepté avec PIN de responsable.

**Impact client.** Les caissiers qui dépassaient le plafond devront appeler un responsable.

### G0-20 — Compteur d'utilisation des promotions non atomique [relu]

**Constat.** `services/promotions.ts:49` lit `uses_count < max_uses`, puis la ligne 211 incrémente sans condition. Deux caisses simultanées peuvent dépasser le maximum.

**Étapes.**
1. Remplacer l'incrément par `UPDATE promotions SET uses_count = uses_count + 1 WHERE id = $1 AND (max_uses IS NULL OR uses_count < max_uses) RETURNING id`.
2. Si aucune ligne n'est renvoyée pour une promotion appliquée : annuler la transaction de vente et renvoyer « promotion épuisée ».
3. Caisse : recalculer le ticket sans la promotion et prévenir le caissier.

**Tests.** Deux ventes concurrentes sur une promotion à une utilisation restante : une seule l'obtient.

### G0-21 — File hors ligne de la caisse bloquée par la première erreur [relu]

**Constat.** `client/src/features/pos/offlineQueue.ts:41-43` : toute erreur arrête le rejeu. Une vente refusée (session fermée, stock) bloque toutes les suivantes. Le ticket n'est pas imprimé hors ligne (`POSPage.tsx:823-830`).

**Étapes.**
1. Distinguer les erreurs : réseau ou 5xx (on arrête et on réessaiera) ; 4xx (la vente est rejetée par le serveur).
2. Déplacer une vente rejetée dans une seconde liste locale « à traiter », avec le motif.
3. Continuer le rejeu des suivantes.
4. Caisse : pastille « N ventes à traiter » et écran qui permet de corriger et renvoyer, ou d'abandonner avec motif.
5. Imprimer le ticket hors ligne avec la mention « hors ligne » et la clé d'idempotence comme référence provisoire.
6. Vérifier que chaque vente mise en file porte bien une `idempotencyKey` (`sale.validator.ts:39`).

**Tests.** Test unitaire de la file : trois ventes dont la deuxième reçoit 400 ; la première et la troisième passent, la deuxième est dans « à traiter ».

**Fini quand.** Le test passe ; c'est aussi le premier test du client (voir G3-10).

---

### Production (M0)

### G0-22 — Emballages consommés deux fois [relu]

**Constat.** Dans `produceItems`, `production.repository.ts:1588-1615` consomme les emballages, puis `:1617-1646` les consomme à nouveau. Le second bloc n'a pas de point de sauvegarde : une erreur de stock y invalide la transaction.

**Étapes.**
1. Reproduire sur la base locale : déclarer une production par `produceItems` et lire les mouvements d'emballage du plan.
2. Garder un seul bloc : celui avec point de sauvegarde, avec les deux conditions réunies (`recipe.yield_quantity > 0` et `!isSemiFinishedPlan`).
3. Vérifier le cas « un bon de sortie existe » : le commentaire dit que les emballages ont déjà été consommés au prélèvement. Ajouter la condition si elle manque, sinon la consommation est double par un autre chemin.
4. Vérifier que `complete()` ne consomme pas une troisième fois un plan déjà passé par `produceItems`.
5. Rattrapage en lecture seule : mouvements d'emballage de type `consumption` en double pour un même plan (notes « Production: » et « Production partielle: »). Chiffrer la sur-consommation par article.
6. Soumettre le chiffrage ; l'ajustement correctif ne se passe qu'après accord.

**Tests.** `production-workflow.db.test.ts` : un plan de 100 pièces avec 1 emballage par pièce consomme 100 emballages, pas 200.

**Impact client.** Le stock d'emballages baissera deux fois moins vite sur ce chemin.

### G0-23 — Charges ignorées et coût incohérent [non relu]

**Constat.** Loyer, énergie et autres charges sont saisis mais non lus par le coût réel. Le tableau de bord exclut l'énergie, le calcul du plan l'inclut.

**Étapes.**
1. Relire et confirmer : `production-cout.repository.ts:151` et la requête du tableau de bord.
2. Écrire une seule fonction serveur `computePlanCost(planId)` qui rend le détail : matière, emballage, main-d'œuvre, énergie, charges indirectes.
3. Faire appeler cette fonction par le tableau de bord, la fiche du plan et les rapports.
4. Brancher les charges saisies selon la clé de répartition existante.
5. Supprimer le recalcul du coût dans le navigateur.

**Tests.** `sql-cost-views.db.test.ts` : le coût du tableau de bord égale celui de la fiche pour dix plans.

**Impact client.** Le coût de revient affiché augmente. Jeu de référence `plan-yields.json`. À annoncer.

### G0-24 — Saisies perdues au lancement, pertes hors transaction [non relu]

**Constat.** Les observations et les quantités de bases saisies dans `ProductionLaunchModal.tsx` ne sont pas envoyées. Les pertes sont créées par des appels séparés après la déclaration.

**Étapes.**
1. Relire la charge utile envoyée par la fenêtre de lancement et confirmer les champs manquants.
2. Ajouter ces champs au schéma et au stockage (colonnes ou table d'observations du plan).
3. Faire accepter les pertes dans l'appel de déclaration ; les créer dans la même transaction.
4. Retirer les appels séparés du client.

**Tests.** Une déclaration avec perte qui échoue ne laisse ni production ni perte.

### G0-25 — Numéros fabriqués dans le navigateur [non relu]

**Constat.** Le numéro de lot de repli et le numéro de bon imprimé ne viennent pas du serveur.

**Étapes.**
1. Repérer les deux fabrications côté client.
2. Les remplacer par un appel à `document_sequences` (types `lot` et `bon_production`).
3. Retirer tout repli local : sans numéro du serveur, l'impression est refusée avec un message clair.

**Fini quand.** Aucun numéro imprimé ne peut exister en double.

### G0-26 — Conversion d'unité qui renvoie 1 en silence [non relu]

**Constat.** `fn_unit_conv` renvoie 1 pour toute unité hors masse et volume.

**Étapes.**
1. Relire la fonction et lister ses appelants (vues de coût, besoins, rendement).
2. Requête de contrôle : lignes de composition dont l'unité n'est ni masse ni volume et diffère de l'unité de l'article. Résultat attendu en boulangerie : vide ou très court.
3. Créer `fn_unit_conv_strict` (nouvelle fonction) qui renvoie `NULL` pour une conversion inconnue.
4. Ajouter au tableau de bord de qualité des données la liste des conversions impossibles.
5. Ne pas toucher `fn_unit_conv` : la bascule des appelants se fait en M3.

**Fini quand.** La liste des conversions impossibles est visible et vide pour le client actuel.

### G0-27 — Défauts du calcul des besoins existant [1 lecture]

**Constat.** `mrp.repository.ts:360` choisit la recette par `ORDER BY id LIMIT 1` ; `:290` ne filtre pas les recettes archivées ; `:303-313` ne descend qu'un niveau ; `:387-405` génère les demandes d'achat en boucle sans transaction, avec un anti-doublon limité au statut `pending`.

**Étapes.**
1. Sélection de recette : prendre la fiche active de l'article (`archived_at IS NULL`), la même règle que la production.
2. Filtrer les recettes archivées dans les besoins de semi-finis.
3. Descendre toute la nomenclature en réutilisant l'explosion multi-niveaux de la migration 400.
4. Envelopper la génération des demandes d'achat dans `withTransaction`.
5. Étendre l'anti-doublon à tous les statuts ouverts (en attente, approuvée, en demande de prix).

**Tests.** Article à deux niveaux de semi-finis : besoins du niveau 2 présents ; génération relancée deux fois : aucune demande en double.

### G0-28 — Divers [1 lecture]

- `maintenance.repository.ts:291` : `toISOString()` sur une date peut décaler d'un jour. Formater la date sans passer par UTC. Test au fuseau `Africa/Casablanca`.
- `scheduler.ts:88` : `userId: null as unknown as string`. Créer un utilisateur technique « Système » et l'utiliser pour toutes les tâches planifiées.
- `routing.repository.ts:160-190` : le temps planifié du TRS ignore les jours d'arrêt total. Prendre le calendrier du poste comme base ; filtrer les arrêts sur leur chevauchement avec la période, pas sur `from_time` seul.

---

## 4. Lot 2 — G1 + M1 : allumer, planifier, paramétrer

### Contrôles livrés mais éteints

### G1-01 — Séparation des tâches : passer d'« avertir » à « bloquer »

**Constat.** `migrations/442_sod_document.sql:61` : mode `warn`.

**Étapes.**
1. Sortir la liste des avertissements des 60 derniers jours, par règle et par utilisateur.
2. Avec le gérant : pour chaque cas, soit changer l'organisation, soit inscrire une exception nommée (petite équipe).
3. Fixer une date pivot et l'annoncer.
4. Basculer règle par règle, en commençant par « créer et approuver le même bon de commande ».
5. Suivre les blocages pendant deux semaines.

**Fini quand.** Toutes les règles sont en `block` ou portent une exception écrite.

### G1-02 — Cloisonnement par établissement

**Constat.** `feature-flags.ts:62` : `RLS_STORE_SCOPE` à `false` ; la migration 436 ne couvre que les tables comptables.

**Étapes.**
1. Prérequis : staging (G3-01). Ne rien activer en production avant.
2. Vérifier l'application de `server/scripts/l0-pg-roles-separation.sql` : le rôle de l'application ne doit pas être super-utilisateur, sinon les règles ne s'appliquent pas.
3. Activer le drapeau en staging et rejouer les scripts `e2e-*.ts`.
4. Étendre les règles par vagues : ventes, achats, stock, production, RH. À chaque vague : migration, tests de fuite entre deux établissements.
5. Activer en production.

**Tests.** Pour chaque table couverte : un utilisateur de l'établissement A ne lit ni n'écrit une ligne de B.

### G1-03 — Suggestions d'achat

**Constat.** Tâche `purchase_suggestions` désactivée (migration 464).

**Étapes.** Après G0-27 : l'activer en staging une semaine, comparer les suggestions aux achats réels, puis l'activer en production à fréquence quotidienne.

### G1-04 — Écritures de réévaluation et de frais d'approche

**Constat.** `landed-cost.repository.ts:236` : écritures différées.

**Étapes.**
1. Valider le schéma d'écriture avec le comptable.
2. Écrire les générateurs dans `journal-generator.service.ts`.
3. Date pivot : seules les pièces postérieures génèrent une écriture.
4. Tests d'équilibre et d'idempotence.

### G1-05 — Interrupteurs de production sans effet

**Constat.** `settings.repository.ts:82-87` : `production_yield_enabled`, `production_cost_enabled`, `production_steps_enabled`, `production_frigo_enabled`, `production_calcul_inverse_enabled` sont enregistrés, lus nulle part.

**Étapes.**
1. Pour chacun, décider : le brancher ou le retirer de l'écran.
2. Pour ceux gardés : condition côté serveur (refus ou saut de l'étape) et côté écran (panneau masqué).
3. Supprimer les réglages en double (majoration, étapes bloquantes) : un seul écran d'édition, l'autre en lecture avec lien.

**Fini quand.** Aucun interrupteur de `ProductionSettingsPage.tsx` n'est sans effet.

### G1-06 — Garde des modules en mode strict

**Étapes.** Lire le journal du mode `log` sur 30 jours ; corriger les appels légitimes refusés ; passer en `enforce`.

### Traitements périodiques

Chaque tâche ci-dessous suit le même gabarit : fonction dans `scheduler.ts`, entrée dans `JOBS`, ligne dans `scheduled_jobs` par migration (clé, libellé, domaine, intervalle), exécution idempotente, message de résultat, test.

| Tâche | Clé | Fréquence | Ce qu'elle fait | Garde d'idempotence |
|---|---|---|---|---|
| G1-07 | `depreciation_monthly` | mensuelle, le 1ᵉʳ | Comptabilise les dotations du mois écoulé | une dotation par immobilisation et par mois |
| G1-08 | `prepaid_recognition` | mensuelle, le 1ᵉʳ | Constate les charges constatées d'avance (`prepaid-charge.repository.ts:181`) | une constatation par charge et par mois |
| G1-09 | `recurring_entries` | quotidienne | Instancie les modèles d'écritures dotés d'une périodicité | date de dernière exécution sur le modèle |
| G1-10 | `lots_expire` | quotidienne, la nuit | Appelle `markExpiredLots` (aujourd'hui jamais appelé) | statut du lot |
| G1-11 | `dlc_alerts` | quotidienne | Notifie les lots de matières et de produits finis qui expirent sous N jours | une alerte par lot et par seuil |
| G1-12 | `hr_documents_due` | quotidienne | Notifie les échéances : CIN, visite médicale, fin de CDD, fin d'essai | une alerte par document et par seuil |

Compléments :
- **G1-09** demande une migration : colonnes `recurrence`, `next_run_on`, `end_on` sur les modèles d'écritures, et l'écran pour les renseigner.
- **G1-10** : retirer l'appel `autoExpireDueLots` de `product.controller.ts:23-25` une fois la tâche en place.
- **G1-11 et G1-12** : seuils réglables dans les paramètres ; e-mail en plus de la notification.

### Paramètres de production (M1)

### M1-01 — Inventaire des constantes en dur

**Étapes.** Relever chaque constante métier de la production, avec fichier, ligne, valeur et sens. Liste de départ : rendements 90 / 85 / 70, taux de charges 0,40, 191 h par mois, kWh à 1,50, marge ×3, horizon de 14 jours, vitrine à 07:00, coupure d'équipe à 14 h, devise « DH », fuseau. Sortie : un tableau dans ce document.

**Résultat de l'inventaire (2026-11-16).** Relevé sur `server/src` et `client/src/features/production`, hors tests. « Clé » est le nom de la politique proposée pour M1-03.

| # | Constante | Valeur | Où (fichier:ligne) | Sens | Déjà réglable ? | Clé proposée |
|---|---|---|---|---|---|---|
| 1 | Rendement cible par défaut d'un contenant | 90 % | `production-rendement.repository.ts:211`, `production-contenant.validator.ts:33`, `ContenantsPage.tsx:582,618`, défaut de colonne mig 082 | Seuil sous lequel un rendement est jugé insuffisant quand ni le contenant ni la recette n'en fixent | par contenant et par recette, pas le repli | `production.yield_target` |
| 2 | Seuil « bon rendement » des écrans | 85 % | `RendementPanel.tsx:154,194,195,312`, `PlanDetailPage.tsx:1131`, `ProductionDashboardPage.tsx:126,264` | Couleur verte / orange quand la ligne n'a pas de seuil ; diffère du repli serveur (90) | non | `production.yield_display` (champ `good`) |
| 3 | Seuil « rendement critique » | 70 % | `RendementPanel.tsx:154` | Passage au rouge | non | `production.yield_display` (champ `alert`) |
| 4 | Taux de charges fixes estimé | 0,40 | `production-cout.repository.ts:3,393` | Repli quand `production_charges_fixes_pct` est vide | oui (colonne société), le repli non | `production.fixed_charges_rate` |
| 5 | Heures légales par mois | 191 h | `production-cout.repository.ts:73,232,233,570` | Taux horaire = salaire mensuel / 191 quand l'employé n'a pas de taux | oui en paie (`monthly_legal_hours`), ignoré par la production | `production.monthly_hours` (défaut : valeur de la paie) |
| 6 | Prix du kWh | 1,50 DH | `production-cout.repository.ts:33`, `production-cout.validator.ts:9` | Valeur par défaut d'un nouvel équipement | par équipement, pas le défaut | `production.kwh_price` |
| 7 | Multiplicateur de marge | ×3 | `recipe-component.repository.ts:59`, `recipe.validator.ts:64`, `NomenclatureEditor.tsx:514`, `ProductsPage.tsx:899` | Prix conseillé = coût × multiplicateur quand la recette n'en porte pas | par recette, pas le repli | `production.margin_multiplier` |
| 8 | Horizon du plan directeur | 14 jours | `mrp.repository.ts:9` | Nombre maximal de jours calculés | non | `production.mrp_horizon_days` |
| 9 | Heure de mise en vitrine | 07:00 | `production-etapes.validator.ts:31`, `RetroPlanningPanel.tsx:48` | Heure cible du rétro-planning | saisie à chaque calcul, pas le défaut | `production.showcase_time` |
| 10 | Coupure d'équipe | 14 h | `plan-print.ts:109`, `ProductionLaunchModal.tsx:120` | Avant 14 h « Matin », après « Après-midi » sur les bons | non | `production.shift_cutoff_hour` |
| 11 | Seuils du TRS | 85 % / 60 % | `WorkCenterOeeModal.tsx:50` | Couleur du TRS d'un poste de charge | non | `production.oee_good_pct`, `production.oee_alert_pct` |
| 12 | Fenêtre d'historique de la prévision | 56 jours (8 semaines) | `forecast.repository.ts:17,107` | Ventes prises en compte pour prévoir la demande | non | `production.forecast_history_days` |
| 13 | Fenêtre de l'approvisionnement boutique | 29 jours, « même jour il y a 14 jours » | `replenishment.repository.ts:1015,1068` | Historique des ventes servant à proposer les quantités | non | `production.replenishment_history_days` |
| 14 | Devise « DH » | texte | 21 occurrences dans `client/src/features/production` | Libellé monétaire des écrans | non | traité par M3-06 (helper de devise), pas une politique |
| 15 | Fuseau « Africa/Casablanca » | texte | 47 occurrences dans `server/src` (dont `routing.repository.ts` ×3, `replenishment.repository.ts`) | Date métier du jour | constante centrale `utils/timezone.ts`, recopiée ailleurs | traité par G6 (pack pays), pas une politique |

Constats annexes : le repli serveur du rendement (90, cible d'un article) et le seuil des écrans (85, couleur d'un rendement moyen) ne sont pas la même notion — M1-03 garde les deux valeurs, chacune dans sa politique (`production.yield_target` et `production.yield_display`), pour ne changer aucun affichage ; les clés définitives sont celles de la note M1-03 de la section 15 ; les lignes 14 et 15 sortent du périmètre M1 (elles ont leur tâche) ; `CHEF_ROLES` a déjà été remplacé par `services/workshops.ts`.

### M1-02 — Résolution des paramètres à héritage

**Constat.** Le paramétrage existe au niveau société et établissement (`parameters-catalog.ts`, `company_module_settings`, `store_module_settings`, `config_versions`). Il manque les niveaux atelier, type d'ordre et article.

**Étapes.**
1. Ne pas créer de système parallèle : étendre le catalogue existant.
2. Table `policy_values` : `key`, `scope_type` (`company`, `store`, `workshop`, `order_type`, `product`), `scope_id`, `value` (JSONB), `updated_by`, `updated_at`. Unicité sur `(key, scope_type, scope_id)`.
3. Fonction `resolvePolicy(key, contexte)` : cherche du plus précis au plus général (article → type d'ordre → atelier → établissement → société → valeur par défaut du catalogue).
4. Brancher sur l'historique de versions de configuration (`config_versions`) pour garder le retour arrière.
5. Cache en mémoire invalidé à l'écriture.

**Tests.** Une valeur d'atelier l'emporte sur celle de la société ; sans valeur, le défaut du catalogue s'applique.

### M1-03 — Reprise des constantes

**Étapes.**
1. Déclarer chaque constante de M1-01 dans le catalogue, avec sa valeur actuelle comme défaut.
2. Remplacer les constantes une par une par `resolvePolicy`, un commit par constante.
3. Rejouer le jeu de référence après chaque remplacement : zéro écart attendu.

### M1-04 — Écran unique des politiques de production

**Étapes.** Un écran Production › Paramétrage › Politiques : une ligne par paramètre, valeur effective, niveau d'où elle vient, bouton « Surcharger pour cet atelier », marque « Modifié » et « Rétablir » (composants existants de Paramètres).

---

## 5. Lot 3 — G2 : données maîtres et étiquetage

Les chiffres ci-dessous viennent de la base locale. Première tâche : les mesurer en production.

### G2-01 — Mesurer la complétude en production

**Étapes.** Écrire `server/scripts/diagnose-master-data.sql` (lecture seule) : formats sans poids cuit, ingrédients sans allergène renseigné, fiches actives sans étapes, ingrédients homonymes, prix unitaires aberrants (hors de l'intervalle habituel de leur catégorie), fiches actives jamais produites. L'exécuter en production avec accord et joindre le résultat.

### G2-02 — Tableau de bord « Qualité des données »

**Étapes.** Écran Paramètres › Qualité des données qui affiche les compteurs de G2-01 en direct, avec un lien vers la liste à corriger. Il sert de suivi à tout le lot.

### G2-03 — Fusion des ingrédients en double

**Constat.** Trois « Beurre » (15 / unité, 57 et 60,07 DH / kg), deux « Sucre semoule » (10,41 et 5,42).

**Étapes.**
1. Lister toutes les tables qui référencent `ingredients.id` (par `information_schema`).
2. Écrire `mergeIngredients(sourceId, cibleId)` : dans une transaction, repointer chaque référence, additionner les stocks et les lots, recalculer le coût moyen pondéré, archiver la source, journaliser.
3. Écran : sélection de deux fiches, aperçu de l'impact (nombre de recettes, de lots, de bons de commande touchés), confirmation.
4. Pour chaque doublon : faire choisir la fiche à garder par le responsable. Attention aux noms avec espace de fin : cibler par identifiant.
5. Rejouer le jeu de référence : le coût des fiches concernées changera ; l'écart doit être expliqué ligne par ligne.

### G2-04 — Prix aberrants

**Étapes.** À partir de G2-01 : pour chaque prix suspect (« Chocolat bâton » à 6,60 DH), retrouver les trois dernières réceptions et proposer la correction. Corriger par un ajustement de coût tracé, pas par un `UPDATE` direct.

### G2-05 — Poids cuit des formats

**Constat.** Renseigné sur 0 format sur 49.

**Étapes.**
1. Écran de saisie en grille : une ligne par format, poids cru, poids cuit, perte calculée.
2. Proposition automatique à partir des pesées réelles des trois derniers mois quand elles existent.
3. Campagne de pesée avec le chef de production pour le reste.
4. Rendre le champ obligatoire à l'activation d'un nouveau format.

### G2-06 — Allergènes des ingrédients

**Constat.** Renseignés sur 0 ingrédient sur 405. Le référentiel des 14 allergènes et les vues existent (migrations 343-344).

**Étapes.**
1. Grille de saisie : ingrédients en lignes, 14 allergènes en colonnes, trois états (contient, traces, absent), plus « non renseigné ».
2. Pré-remplissage proposé par catégorie (farines → gluten, produits laitiers → lait, œufs, fruits à coque), à valider ligne par ligne.
3. Import par le module d'import générique pour les fiches fournisseurs.
4. Vérifier que les vues remontent les allergènes jusqu'au produit fini, semi-finis compris.

### G2-07 — Étapes des fiches

**Constat.** Présentes sur 14 fiches actives sur 52.

**Étapes.** Lister les 38 fiches sans étapes par volume produit ; saisir d'abord les dix plus produites ; les autres au fil de l'eau.

### G2-08 — Fiches à désactiver et données parasites

**Étapes.** Archiver « Pâte levée feuilletée nature » après confirmation ; recontrôler la température de 90 °C visée par la migration 407 ; archiver les fiches actives jamais produites après revue.

### G2-09 — Étiquette réglementaire

**Constat.** L'étiquette actuelle (`client/src/lib/niimbot/labelRenderer.ts`) porte le lot et un QR code, sans ingrédients ni allergènes.

**Étapes.**
1. Faire valider le contenu obligatoire avec le référent qualité du client (réglementation ONSSA) : dénomination, liste des ingrédients par poids décroissant, allergènes mis en évidence, poids net, DLC ou DDM, conditions de conservation, lot, fabricant.
2. Créer le point d'accès `GET /products/:id/label-data` : il compose la liste des ingrédients à partir de la nomenclature éclatée (semi-finis remplacés par leurs ingrédients), triée par poids, avec les allergènes marqués.
3. Champs à ajouter sur le produit : dénomination légale, conditions de conservation, mentions libres.
4. Gabarits d'étiquette : petit format (imprimante Niimbot) et A4 en planche, en français et en arabe.
5. Refuser l'impression si un ingrédient de la nomenclature n'a pas ses allergènes renseignés.
6. Impression depuis la fiche produit, depuis le lot et à la déclaration de production.

**Tests.** Produit à deux niveaux de semi-finis : la liste contient les ingrédients de base, dans l'ordre des poids.

### G2-10 — Valeurs nutritionnelles (optionnel)

**Étapes.** Colonnes par ingrédient pour 100 g (énergie, matières grasses, glucides, protéines, sel) ; calcul par produit sur la nomenclature et le poids cuit ; ajout au gabarit d'étiquette. À ne lancer qu'après G2-05.

---

## 6. Lot 4 — G3 : exploitation

### G3-01 — Environnement de staging

**Étapes.**
1. Second service Cloud Run et seconde instance Cloud SQL, plus petits.
2. Script d'alimentation : copie de la production avec anonymisation (noms, téléphones, RIB, salaires brouillés).
3. `deploy.yml` : déploiement automatique en staging ; production sur validation manuelle (`workflow_dispatch` ou environnement protégé).
4. Bandeau « STAGING » dans l'application ; e-mails détournés vers une boîte de test.

### G3-02 — Sauvegarde et restauration

**Étapes.**
1. Vérifier que les sauvegardes automatiques et la restauration à un instant donné sont actives sur Cloud SQL ; noter la rétention.
2. Faire une restauration réelle vers une instance temporaire ; chronométrer.
3. Écrire la procédure dans `docs/DEPLOYMENT.md` : qui, comment, combien de temps, comment vérifier.
4. Sauvegarde du bucket de fichiers (versions d'objets).
5. Refaire l'exercice tous les trimestres.

### G3-03 — Observabilité

**Étapes.**
1. Remontée des erreurs serveur et client vers un outil de suivi (Sentry ou équivalent), avec masquage des données personnelles.
2. Métriques : durée et taux d'erreur par route, durée des requêtes SQL lentes (> 500 ms), état des tâches planifiées.
3. Alertes : taux d'erreur, tâche planifiée en échec deux fois, file d'e-mails bloquée, intégrité du grand livre rompue.
4. Remplacer les 84 `console.*` restants par le journal structuré.

### G3-04 — Qualité de code en CI

**Étapes.** Ajouter ESLint et Prettier (règles minimales d'abord, sans reformater tout le dépôt) ; étape de lint dans `ci.yml` ; les 18 scripts `e2e-*.ts` lancés en CI contre la base de test.

### G3-05 — Migrations

**Étapes.**
1. Numéros en double (051, 264, 265, 426-428) : les laisser, mais faire refuser par la garde tout nouveau doublon.
2. Réparer `migrate` en local (cassé sur la 266).
3. Règle écrite : toute migration destructive est précédée d'une migration de sauvegarde de la colonne ; pas de script de retour arrière générique.
4. Test en CI : appliquer toutes les migrations sur une base vide.

### G3-06 — Helper de transaction

**Étapes.** Généraliser `withTransaction` (créé en G0-14) : remplacer les 282 `BEGIN` manuels par vagues, un dépôt de données par commit, en commençant par ceux qui touchent l'argent et le stock.

### G3-07 — SQL hors de la couche de données

**Constat.** 257 appels SQL dans 32 contrôleurs, 46 dans les routes.

**Étapes.** Règle de lint qui interdit `db.query` hors de `repositories/` ; liste d'exceptions existantes ; résorption à chaque passage sur un fichier.

### G3-08 — Fichiers géants

**Étapes.** Découper à l'occasion des lots qui y touchent, jamais comme chantier isolé : `POSPage.tsx` (5 447 lignes) avec G0-19 et G0-21 ; `production.repository.ts` (2 855) avec M2 ; `PlanDetailPage.tsx` et `ProductionLaunchModal.tsx` avec M8 ; `AccountingPage.tsx` (4 000) avec G4.

### G3-09 — Performance

**Étapes.** Activer `pg_stat_statements` ; relever les vingt requêtes les plus coûteuses ; traiter les `SELECT *` des listes ; vérifier la pagination serveur de toutes les listes de plus de 200 lignes.

### G3-10 — Tests du client et de bout en bout

**Constat.** 0 test client, 0 test dans un navigateur.

**Étapes.**
1. Installer Vitest côté client ; premier test : la file hors ligne (G0-21).
2. Installer Playwright ; cinq parcours contre le staging : connexion, vente en caisse, commande → livraison → facture, bon de commande → réception → facture, plan de production → clôture.
3. Les lancer avant chaque mise en production.

### G3-11 — Données personnelles (loi 09-08)

**Étapes.** Étendre aux salariés et aux fournisseurs ce qui existe pour les clients (migration 478) : export des données d'une personne, anonymisation à la demande, registre des traitements.

---

## 7. Lot 5 — G4 : trésorerie

### G4-01 — Paiements fournisseurs en lot

**Constat.** Le fichier de virement n'existe que pour les salaires (`salary-transfer.ts`).

**Étapes.**
1. Tables `payment_runs` (date, banque, état, total, créé par, approuvé par) et `payment_run_lines` (facture, fournisseur, RIB, montant).
2. Écran de préparation : factures échues ou à échoir à une date, issues de l'échéancier existant ; cases à cocher ; montant partiel possible ; total par fournisseur.
3. Contrôles : RIB présent, facture non bloquée, pas déjà dans une campagne ouverte.
4. Circuit : brouillon → approuvé (moteur d'approbation existant, seuil par montant) → fichier généré → exécuté.
5. Génération du fichier de virement au format de la banque et de la lettre d'ordre, en reprenant `salary-transfer.ts`.
6. À l'exécution : règlements créés, écritures comptables, lettrage automatique, avis de paiement par e-mail au fournisseur.
7. Annulation d'une ligne rejetée par la banque.

**Tests.** Campagne de trois factures : trois règlements, écritures équilibrées, factures soldées et lettrées.

### G4-02 — Rapprochement bancaire par règles

**Constat.** `bank-reconciliation.repository.ts:336-375` : montant exact à ± 7 jours, une requête par ligne.

**Étapes.**
1. Table `bank_rules` : ordre, condition (libellé contient, expression, sens, plage de montant), action (rapprocher à un tiers, générer une écriture sur un compte), tolérance de montant et de date.
2. Moteur en trois passes : référence exacte (numéro de facture ou de chèque dans le libellé), règles, montant et date avec tolérance.
3. Écritures automatiques : frais bancaires, commissions de carte, agios.
4. Regroupement : un virement reçu pour plusieurs factures, une remise de chèques.
5. Réécrire la recherche de candidats de façon ensembliste, avec verrou sur les lignes candidates.
6. Écran : propositions avec degré de confiance, validation en masse, création d'une règle à partir d'un rapprochement manuel.

**Tests.** Jeu de relevé d'essai : taux de rapprochement automatique mesuré avant et après.

### G4-03 — Prévision de trésorerie

**Étapes.**
1. Service qui projette le solde par jour sur 13 semaines : soldes de banque et de caisse, créances clients à leur échéance (pondérées par le retard moyen du client), dettes fournisseurs de l'échéancier, paie, cotisations, TVA et acomptes d'IS à leurs dates, écritures récurrentes, effets.
2. Lignes manuelles de prévision (emprunt, investissement).
3. Écran : courbe du solde, seuil d'alerte, détail par semaine, scénarios (retard de paiement des clients de N jours).
4. Lien avec G4-01 : choisir les factures à payer en voyant l'effet sur le solde.

---

## 8. Lot 6 — M2 + rôles configurables

### M2-01 — Types d'ordre

**Étapes.**
1. Table `production_order_types` : code, libellé, étapes requises (bon de sortie, pesage, contrôle), mode de consommation (`au_bon_de_sortie`, `à_la_déclaration`, `manuel`), séquence de numérotation, atelier par défaut, actif.
2. Type initial « Plan du jour » qui reproduit exactement le parcours actuel.
3. Écran de paramétrage des types.

### M2-02 — En-tête d'ordre

**Étapes.**
1. Colonnes sur `production_plans` : `order_number`, `order_type_id`, `priority`, `planned_start`, `planned_end`.
2. Type de document « ordre de fabrication » dans `document_sequences`.
3. Rattrapage : les plans existants reçoivent le type « Plan du jour », un numéro selon leur date de création, et des dates égales à leur date de plan.
4. Affichage du numéro et de la priorité dans les listes et les fiches. Aucun renommage de table.

### M2-03 — Une seule machine à états

**Constat.** Les 30 transitions existent en TypeScript (`services/production-state.ts`) et en SQL (migration 299).

**Étapes.**
1. Garder les états canoniques figés.
2. Faire porter au type d'ordre la liste des étapes sautées ; la fonction de transition la lit.
3. Générer la table SQL des transitions à partir de la définition TypeScript (test qui échoue si elles divergent).
4. Ajouter la contrainte `CHECK` sur les statuts de ligne.

**Tests.** Un type sans bon de sortie passe de « confirmé » à « en production » ; le type « Plan du jour » refuse ce saut.

### M2-04 — Référentiel des permissions

**Constat.** 610 `authorize(...)` avec des groupes de rôles en dur (`ROLE_GROUPS.SALES`, `ROLE_GROUPS.PRODUCTION`…), alors que les tables `roles`, `role_permissions` et `user_permissions` existent.

**Étapes.**
1. Définir les clés de permission par module et par action (`production.plan.confirm`, `sales.invoice.cancel`…), dans `shared`.
2. Créer le middleware `can('clé')`.
3. Migration d'amorçage : chaque rôle actuel reçoit exactement les permissions que lui donnent aujourd'hui les groupes en dur.
4. Test de non-régression : pour chaque route et chaque rôle, la décision avant et après est identique (s'appuyer sur `server/scripts/audit-droits-routes.ts`).

### M2-05 — Bascule des routes

**Étapes.** Remplacer `authorize(...)` par `can(...)` module par module, dans l'ordre : Production, Stock, Achats, Ventes, Comptabilité, Personnel, Paramètres. Un commit par module, test de M2-04 rejoué à chaque fois. En staging d'abord.

### M2-06 — Droits par atelier

**Étapes.** Table d'appartenance utilisateur ↔ atelier ; les actions sur un ordre vérifient l'appartenance à l'atelier de l'ordre (sauf permission « tous ateliers ») ; rattrapage : chaque chef est rattaché aux ateliers où il agit aujourd'hui.

### M2-07 — Écran des rôles

**Étapes.** Matrice rôle × permission regroupée par module ; duplication d'un rôle ; aperçu « ce que voit cet utilisateur ».

### M2-08 — Lien commande ↔ ordre

**Étapes.** Clé de la ligne de commande client sur la ligne d'ordre ; affichage dans les deux sens ; base de la date promise (G5).

---

## 9. Lot 7 — G5 : planification et stock

### G5-01 — Stock à la date

**Constat.** La clôture de stock est une photo de l'instant, sans rejeu ni verrou (migration 381).

**Étapes.**
1. Vérifier que tout mouvement passe par `inventory_transactions` (y compris ajustements, casse, production) ; combler les trous.
2. Fonction `fn_stock_at(date, établissement)` : quantité et valeur par article, par rejeu des mouvements.
3. Rapport « Stock valorisé au… » avec export.
4. Verrou de période de stock : aucun mouvement antidaté dans une période close.
5. Contrôle : `fn_stock_at(aujourd'hui)` égale le stock courant, article par article.

### G5-02 — Point de commande et stock de sécurité

**Étapes.**
1. Colonnes par article et par établissement : stock de sécurité, point de commande, maximum, mode (`manuel`, `calculé`).
2. Calcul : consommation moyenne journalière sur N jours × délai du fournisseur (migration 404) + stock de sécurité.
3. Tâche planifiée hebdomadaire de recalcul, avec proposition à valider (pas d'écrasement silencieux du seuil manuel).
4. La liste « À commander » lit le point de commande.

### G5-03 — Classes ABC et inventaire tournant

**Étapes.** Classement par valeur consommée sur 12 mois ; fréquence de comptage par classe ; génération automatique des campagnes de comptage dans le module Inventaires existant.

### G5-04 — Calcul des besoins phasé dans le temps

**Constat.** `mrp.repository.ts:345-384` calcule sur une seule date, sans commandes en cours ni stock de semi-finis.

**Étapes.**
1. Horizon découpé en jours ; demande = commandes fermes + prévision.
2. Disponibilités : stock, stock de semi-finis, ordres planifiés, bons de commande en cours à leur date de livraison prévue.
3. Explosion sur tous les niveaux avec décalage par les délais de fabrication et d'achat.
4. Règles de lot : minimum, multiple, conditionnement fournisseur.
5. Sorties : ordres de fabrication proposés (datés par M2-02) et demandes d'achat proposées, à valider.
6. Messages d'action : avancer, retarder, annuler.

**Tests.** Scénario à deux niveaux avec délais : les propositions tombent aux bonnes dates.

### G5-05 — Plan directeur enregistré

**Étapes.** Table du plan directeur par article et par semaine ; écran d'édition ; il alimente G5-04 à la place de la prévision brute.

### G5-06 — Date de disponibilité promise

**Étapes.** À la saisie d'une ligne de commande : date la plus proche où le stock projeté couvre la quantité (stock + ordres planifiés − réservations).

---

## 10. Lot 8 — M3 : unités et mesures

Lot à risque élevé : il touche le coût et les marges. Le jeu de référence est rejoué à chaque tâche, écart toléré : zéro.

| Tâche | Contenu |
|---|---|
| M3-01 | Référentiel des unités par dimension (masse, volume, longueur, surface, pièce, temps) avec facteurs en données |
| M3-02 | Conversions propres à l'article (1 carton = 12 pièces, 1 pièce = 0,35 kg) ; la densité existante (migration 227) devient un cas de cette table |
| M3-03 | Nouvelle fonction de conversion pilotée par ces données ; bascule des appelants de `fn_unit_conv` un par un (jamais de remplacement de l'ancienne fonction) |
| M3-04 | Colonnes `quantité + unité` ajoutées à côté des colonnes `_g` / `_kg` ; les anciennes restent lues jusqu'à validation |
| M3-05 | Clé de répartition du coût au choix par type d'ordre (poids, quantité, valeur, manuelle) |
| M3-06 | Devise par helper : remplacer les « DH » en dur du module (premier pas des 971 occurrences du client) |

Étapes communes : migration additive, double écriture pendant la transition, comparaison fiche par fiche, bascule de la lecture, retrait de l'ancien chemin dans un commit séparé.

Tous les constats de ce lot sont **[non relus]** : la première étape de chaque tâche est de relire le code concerné.

### M3-01 — Référentiel des unités par dimension

**Constat.** Les unités connues du système sont la masse et le volume ; les autres sont traitées comme « 1 pour 1 ».

**Étapes.**
1. Inventorier les unités réellement utilisées en base (ingrédients, recettes, formats, emballages, lignes d'achat et de vente) et repérer les variantes d'écriture (« Kg », « kg », « KG »).
2. Table `units` : code, libellé, dimension (`masse`, `volume`, `longueur`, `surface`, `pièce`, `temps`), facteur vers l'unité de base de la dimension, nombre de décimales d'affichage, active.
3. Amorcer avec les unités existantes et leurs facteurs actuels, à l'identique.
4. Clé étrangère « souple » : ajouter `unit_id` à côté des colonnes texte d'unité ; rattrapage par correspondance exacte ; liste des lignes non rattachées à corriger à la main.
5. Écran Paramètres › Unités (lecture pour les unités système, édition pour les unités ajoutées).

**Tests.** Chaque unité existante retrouve le même facteur qu'aujourd'hui.

**Fini quand.** Aucune ligne de composition n'a d'unité non rattachée.

**Impact boulangerie.** Aucun : mêmes unités, mêmes facteurs.

### M3-02 — Conversions propres à l'article

**Constat.** La seule conversion entre dimensions est la densité (migration 227, masse ↔ volume). Rien pour « 1 carton = 12 pièces » ou « 1 pièce = 0,35 kg ».

**Étapes.**
1. Table `item_unit_conversions` : type d'article (ingrédient, emballage, produit), identifiant, unité source, unité cible, facteur, origine (`saisie`, `densité`, `contenant`).
2. Reprendre dedans la densité existante (`densite_kg_l`) et les contenants par ingrédient (migration 226) sous forme de lignes de conversion, sans supprimer les colonnes d'origine.
3. Reprendre le poids par pièce (`ingredients.poids_piece_kg`).
4. Onglet « Unités et conversions » sur la fiche ingrédient et la fiche produit.
5. Refuser une conversion circulaire incohérente (A→B→A ≠ 1).

**Tests.** Un ingrédient avec densité donne le même résultat par l'ancienne colonne et par la nouvelle table.

### M3-03 — Nouvelle fonction de conversion et bascule des appelants

**Constat.** `fn_unit_conv` renvoie 1 pour une conversion inconnue. Elle est ancienne : interdiction de la remplacer en production.

**Étapes.**
1. Créer `fn_convert_qty(quantité, unité_source, unité_cible, type_article, id_article)` : même dimension → facteurs de `units` ; dimensions différentes → `item_unit_conversions` ; inconnu → `NULL`.
2. Lister tous les appelants de `fn_unit_conv` (vues de coût, besoins, rendement, bons de sortie).
3. Pour chaque appelant : créer la vue ou fonction suffixée `_v2` qui utilise `fn_convert_qty`.
4. Comparer `_v1` et `_v2` sur toute la base : zéro écart attendu en boulangerie (script de comparaison ajouté au jeu de référence).
5. Basculer le code serveur sur `_v2`, un appelant par commit.
6. Laisser `fn_unit_conv` et les vues `_v1` en place un cycle de mise en production complet, puis les retirer.

**Tests.** `sql-cost-views.db.test.ts` rejoué sur `_v2` ; cas nouveau : conversion mètre → centimètre ; conversion impossible → `NULL` signalé, jamais 1.

**Fini quand.** Plus aucun appel à `fn_unit_conv` dans `server/src` et dans les vues actives.

**Impact boulangerie.** Aucun chiffre ne doit bouger. C'est le critère d'acceptation.

### M3-04 — Quantité + unité à la place des colonnes `_g` / `_kg`

**Constat.** Les colonnes de poids portent leur unité dans leur nom (`poids_cru_g`, `poids_cuit_g`…).

**Étapes.**
1. Inventorier les colonnes suffixées par une unité dans les tables de production et de recettes.
2. Pour chacune, ajouter `xxx_qty` (numérique) et `xxx_unit_id`.
3. Rattrapage : `xxx_qty = xxx_g`, unité = gramme.
4. Double écriture : le serveur écrit les deux jeux de colonnes.
5. Basculer la lecture écran par écran ; l'unité affichée est celle saisie.
6. Garder les colonnes `_g` (non supprimées) tant que des vues ou des rapports les lisent ; les marquer obsolètes en commentaire de colonne.

**Tests.** Lecture par l'ancien et le nouveau chemin : mêmes valeurs converties.

**Impact boulangerie.** Aucun ; les grammes restent affichés en grammes.

### M3-05 — Clé de répartition du coût au choix

**Constat.** Le coût d'un plan est réparti entre ses sorties au ratio de poids, ce qui n'a pas de sens pour des pièces ou des mètres.

**Étapes.**
1. Paramètre de politique `production.cost_allocation_key` (lot M1) : `poids` (défaut), `quantité`, `valeur_de_vente`, `manuelle`.
2. Le porter au niveau du type d'ordre, surchargeable par article.
3. Adapter `computePlanCost` (créé en G0-23) pour lire la clé.
4. Pour la clé manuelle : pourcentages saisis sur les sorties de la nomenclature, total contrôlé à 100 %.

**Tests.** Même plan, quatre clés : la somme des coûts répartis égale toujours le coût total.

**Impact boulangerie.** Aucun avec la valeur par défaut `poids`.

### M3-06 — Devise par helper

**Constat.** « DH » est écrit en dur dans les écrans et certains documents.

**Étapes.**
1. Créer le helper `formatMoney(montant, devise?)` côté client et côté serveur (PDF), qui lit la devise de la société.
2. Remplacer les occurrences du module Production, puis des autres modules au fil des passages (971 au total côté client).
3. Règle de lint qui signale toute nouvelle chaîne « DH » ou « MAD » en dur.

**Impact boulangerie.** Aucun : la devise de la société reste le dirham.

---

## 11. Lot 9 — M4 à M7 : production industrielle

L'ordre entre M4, M5, M6 et M7 dépend de l'industrie visée (décision ouverte).

### M4 — Nomenclature industrielle

| Tâche | Contenu | Étapes clés |
|---|---|---|
| M4-01 | Versions avec statut et validité | Statuts brouillon / active / obsolète, dates d'effet ; chaque fiche reçoit une version 1 active (après G2) |
| M4-02 | Version figée sur l'ordre | Clé de version sur l'ordre, posée à la confirmation ; les plans passés restent sans version |
| M4-03 | Approbation d'une modification | Demande de modification branchée sur le moteur d'approbation ; motif, impact, date d'effet |
| M4-04 | Plusieurs nomenclatures par article | Levée de la contrainte d'unicité ; nomenclature par défaut ; choix au lancement |
| M4-05 | Substituts | Composant de remplacement avec ratio et priorité ; proposé en cas de rupture |
| M4-06 | Co-produits déclarés | Généralisation des sorties de coupe (migration 397) ; répartition du coût par clé |
| M4-07 | Champs personnalisés | Fiches, ordres et lots branchés sur `custom_field_defs` |

### M5 — Gamme réelle

| Tâche | Contenu | Étapes clés |
|---|---|---|
| M5-01 | Opérations de gamme | Réglage, exécution, poste, contrôle ; temps machine et main-d'œuvre séparés |
| M5-02 | Instanciation sur l'ordre | `routing_id` écrit à la confirmation ; opérations copiées sur l'ordre |
| M5-03 | Reprise des étapes | Les étapes JSON de `recipes.etapes` copiées en opérations ; le JSON reste lu jusqu'à validation de la bascule |
| M5-04 | Calendrier des postes | Horaires, jours fermés, capacité ; base du TRS corrigé et de la charge |
| M5-05 | Référentiel équipement unique | Relier `production_equipements`, `work_centers` et `fixed_assets` ; arrêts liés aux interventions de maintenance |

### M6 — Consommation et stock

Prérequis : G0-18 (plus d'écrêtage silencieux) et G5-01 (stock à la date).

| Tâche | Contenu | Étapes clés |
|---|---|---|
| M6-01 | Mode de consommation par type d'ordre | Au bon de sortie (défaut actuel), à la déclaration, manuel |
| M6-02 | Emplacements | Étendre `stock_locations` (migrations 424-425) : quantité par emplacement ; économat et pesage deviennent deux emplacements ; « vers magasin / vers frigo » deviennent des destinations |
| M6-03 | Motifs de rebut | Un seul référentiel pour production, stock et boutique |
| M6-04 | Contrôle de reprise | Quantités par lot identiques avant et après, vérifiées par le jeu de référence |

### M7 — Qualité liée

| Tâche | Contenu | Étapes clés |
|---|---|---|
| M7-01 | Inspections rattachées | Clés vers l'ordre, l'opération et le lot sur `quality_inspections` |
| M7-02 | Plan de contrôle par article | Points de contrôle à la réception, en cours, final ; fréquence et échantillonnage |
| M7-03 | Le CCP comme cas particulier | Les relevés et CCP actuels (migrations 422-423) deviennent des inspections typées ; ils continuent de fonctionner tels quels |
| M7-04 | Libération du lot | Statut « en attente de libération » ; vente et consommation bloquées tant que le contrôle final n'est pas validé |
| M7-05 | Non-conformités structurées | Lien au lot, au fournisseur, à l'ordre ; cause, action corrective, responsable, échéance, vérification d'efficacité |

Les tableaux ci-dessus sont le résumé. Le détail de chaque tâche suit. Tous les constats sont **[non relus]** sauf mention contraire.

### Détail M4 — Nomenclature industrielle

#### M4-01 — Versions avec statut et validité

**Constat.** Les fiches ont des instantanés restaurables, mais ni statut, ni date d'effet.

**Étapes.**
1. Prérequis : G2 terminé (doublons fusionnés, poids cuits saisis), sinon la version 1 fige des données fausses.
2. Table `recipe_versions` : fiche, numéro, statut (`brouillon`, `active`, `obsolète`), `valid_from`, `valid_to`, motif, créée par, approuvée par.
3. Rattacher les lignes de composition, les étapes et les formats à une version (clé `version_id`).
4. Rattrapage : chaque fiche reçoit une version 1 `active`, valide depuis sa date de création, à laquelle toutes ses lignes actuelles sont rattachées.
5. Règle : une seule version active par fiche et par nomenclature à une date donnée (contrainte d'exclusion).
6. Modifier une version active crée un brouillon de la version suivante ; la version active n'est jamais modifiée en place.
7. Écran : bandeau de version sur la fiche, liste des versions, comparaison de deux versions (lignes ajoutées, retirées, quantités changées).

**Tests.** Modifier une fiche active crée une version 2 en brouillon ; l'activer rend la version 1 obsolète à la même date.

**Impact boulangerie.** Le bouton « Enregistrer » d'une fiche active devient « Créer une nouvelle version ». À expliquer au chef de production.

#### M4-02 — Version figée sur l'ordre

**Étapes.**
1. Colonne `recipe_version_id` sur les lignes d'ordre.
2. À la confirmation de l'ordre : y inscrire la version active à la date de l'ordre.
3. Les besoins, le bon de sortie et le coût lisent la version de l'ordre, plus la fiche courante.
4. Les plans passés gardent la colonne vide et continuent d'utiliser leur instantané de coût (`theo_*`, migration 261).
5. Afficher la version sur la fiche de l'ordre, avec un avertissement si une version plus récente existe.

**Tests.** Ordre confirmé avec la version 1, fiche passée en version 2 : l'ordre garde les quantités de la version 1.

#### M4-03 — Approbation d'une modification

**Étapes.**
1. Type d'objet « modification de nomenclature » dans le moteur d'approbation existant (`approval_rules`).
2. Demande : fiche, motif, description de l'impact (coût avant / après, allergènes avant / après, ordres ouverts concernés), date d'effet souhaitée.
3. L'activation d'une version exige l'approbation si une règle existe ; sans règle, activation directe (comportement actuel).
4. Notification aux responsables qualité et production.

**Impact boulangerie.** Aucun tant qu'aucune règle d'approbation n'est créée.

#### M4-04 — Plusieurs nomenclatures par article

**Constat.** Une contrainte impose une seule fiche par produit.

**Étapes.**
1. Relever la contrainte d'unicité et tous les endroits du code qui supposent « la » fiche du produit (dont `mrp.repository.ts:360`, corrigé en G0-27).
2. Colonnes `is_default` et `usage` (`fabrication`, `alternative`, `sous-traitance`) sur la fiche.
3. Remplacer la contrainte par : une seule fiche par défaut par produit.
4. Helper unique `getRecipeFor(produit, { date, usage })` ; tous les appelants passent par lui.
5. Au lancement d'un ordre : la nomenclature par défaut est proposée, une autre peut être choisie.

**Tests.** Produit à deux nomenclatures : le calcul des besoins et le coût catalogue prennent celle par défaut.

**Impact boulangerie.** Aucun : chaque produit garde sa fiche unique, marquée par défaut.

#### M4-05 — Substituts

**Étapes.**
1. Table `recipe_line_substitutes` : ligne de composition, article de remplacement, ratio, priorité, validité.
2. Au bon de sortie, en cas de rupture : proposer le substitut ; le choix est tracé sur le bon.
3. Le coût réel et la traçabilité portent l'article réellement consommé ; les allergènes de l'étiquette sont recalculés.
4. Reprendre dans ce modèle le remplacement en masse existant (migration 401) comme outil de mise à jour.

**Tests.** Substitution au bon de sortie : le lot consommé, le coût et les allergènes sont ceux du substitut.

#### M4-06 — Co-produits déclarés

**Constat.** Les sorties multiples n'existent que pour la coupe d'un cadre (migration 397, `recipe_format_outputs`, `production_item_outputs`).

**Étapes.**
1. Généraliser `recipe_format_outputs` : type de sortie (`principal`, `co-produit`, `sous-produit`, `déchet valorisé`), quantité prévue, clé de répartition du coût.
2. À la déclaration : saisir la quantité de chaque sortie ; chacune crée son lot.
3. Répartition du coût selon la clé (M3-05) ; un sous-produit peut être valorisé à prix fixe et venir en déduction.
4. Le cas de la coupe devient un paramétrage de ce modèle ; vérifier qu'il se comporte à l'identique.

**Tests.** Rejouer les plans de coupe du jeu de référence : mêmes quantités, mêmes coûts.

#### M4-07 — Champs personnalisés

**Étapes.** Déclarer les fiches techniques, les ordres et les lots comme objets du moteur existant (`custom_field_defs` + colonne JSONB) ; afficher le bloc « Champs personnalisés » sur les trois fiches ; les rendre disponibles dans le générateur de rapports et l'import.

### Détail M5 — Gamme réelle

#### M5-01 — Opérations de gamme

**Constat.** Les gammes existent (migration 388) sans temps de réglage ni distinction machine / main-d'œuvre. `routing_id` n'est jamais écrit.

**Étapes.**
1. Compléter la table des opérations de gamme : ordre, poste de charge, type (`réglage`, `exécution`, `attente`, `contrôle`), temps de réglage, temps unitaire machine, temps unitaire main-d'œuvre, quantité de base, point de contrôle associé, opération bloquante ou non.
2. Rattacher la gamme à la version de nomenclature (M4-01).
3. Écran d'édition de la gamme sur la fiche technique, à la place de la liste d'étapes JSON.

#### M5-02 — Instanciation sur l'ordre

**Étapes.**
1. Table des opérations d'ordre : copie des opérations de la gamme, avec état, heures prévues, heures réelles, opérateur, quantité bonne, quantité rebutée.
2. À la confirmation : écrire `routing_id` et créer les opérations d'ordre.
3. L'écran Atelier lit les opérations d'ordre : démarrer, mettre en pause, terminer, déclarer une quantité par opération.
4. Les temps déclarés alimentent `production_temps_travail` et le coût réel de main-d'œuvre.

**Tests.** Ordre confirmé : autant d'opérations que la gamme ; terminer la dernière opération autorise la clôture.

#### M5-03 — Reprise des étapes JSON

**Constat.** Les étapes exécutées viennent de `recipes.etapes` (JSON), présentes sur 14 fiches actives sur 52.

**Étapes.**
1. Script de reprise : chaque étape JSON devient une opération de gamme (libellé, durée, température, champs en arabe conservés).
2. Rapport de reprise : étapes sans durée, sans poste, à compléter.
3. Paramètre de bascule par atelier : `lecture des étapes = json | gamme`. Défaut : `json`.
4. Bascule atelier par atelier après validation par le chef.
5. Le JSON n'est plus écrit une fois la bascule faite, mais reste en base.

**Impact boulangerie.** Aucun tant que le paramètre reste sur `json`.

#### M5-04 — Calendrier des postes

**Étapes.** Table de calendrier par poste : plages horaires par jour de semaine, jours fermés, capacité (nombre de ressources) ; la vue de charge (`v_production_work_center_load`) compare la charge à la capacité réelle ; le TRS prend le temps d'ouverture du calendrier comme base (corrige le biais relevé en G0-28) ; le rétro-planning (migration 432) lit le calendrier.

#### M5-05 — Référentiel équipement unique

**Constat [1 lecture].** `production_equipements`, `work_centers` et `fixed_assets` ne sont pas reliés.

**Étapes.**
1. Choisir la table de référence de l'équipement physique (celle de la maintenance).
2. Ajouter les clés : poste de charge → équipements ; équipement → immobilisation.
3. Rattrapage par rapprochement de noms, validé à la main.
4. Un arrêt de production peut créer une demande d'intervention ; une intervention de maintenance crée un arrêt sur le poste.
5. Ajouter la composante qualité au TRS (pièces bonnes / pièces produites).

### Détail M6 — Consommation et stock

Prérequis : G0-18 et G5-01.

#### M6-01 — Mode de consommation par type d'ordre

**Constat.** La consommation se fait au bon de sortie, étape obligatoire.

**Étapes.**
1. Le type d'ordre (M2-01) porte le mode : `au_bon_de_sortie` (défaut), `à_la_déclaration`, `manuel`.
2. `à_la_déclaration` : à chaque déclaration de quantité produite, consommer les composants au prorata de la nomenclature figée, en FEFO.
3. `manuel` : aucune consommation automatique ; saisie libre des sorties rattachées à l'ordre.
4. Un seul chemin de code pour la consommation des emballages, quel que soit le mode (suite de G0-22).
5. Écart entre consommation théorique et réelle visible sur l'ordre.

**Tests.** Un ordre par mode : le stock final est celui attendu, sans double consommation.

**Impact boulangerie.** Aucun : le type « Plan du jour » garde le mode actuel.

#### M6-02 — Emplacements

**Constat.** Les emplacements existent (migrations 424-425) avec un lot = un emplacement. Les zones économat / pesage et les destinations magasin / frigo sont codées à part.

**Étapes.**
1. Passer à une quantité par lot **et** par emplacement (table de stock par emplacement).
2. Créer les emplacements « Économat », « Pesage », « Magasin », « Frigo » par établissement et y rattacher les stocks existants.
3. Les transferts économat → pesage deviennent des mouvements entre emplacements ; l'ancienne table de transferts reste alimentée en parallèle pendant la transition.
4. « Vers magasin » et « vers frigo » deviennent le choix d'un emplacement de destination à la déclaration.
5. Les quantités de destination acceptent les décimales.
6. Aucune stratégie de rangement automatique dans ce lot.

**Tests.** Somme des quantités par emplacement = quantité du lot, pour tous les lots.

**Impact boulangerie.** Les mêmes écrans, avec des libellés d'emplacements à la place des zones.

#### M6-03 — Motifs de rebut

**Étapes.** Inventorier les listes de motifs existantes (pertes de production, casse de pesage, invendus, ajustements de stock) ; un seul référentiel avec le domaine d'usage ; rattrapage des valeurs existantes ; les rapports de pertes lisent ce référentiel.

#### M6-04 — Contrôle de reprise

**Étapes.** Capturer le jeu de référence avant M6-02 ; le rejouer après ; `stock-lots.json` identique lot par lot ; toute différence bloque la mise en production.

### Détail M7 — Qualité liée

#### M7-01 — Inspections rattachées

**Constat.** `quality_inspections` n'a aucune clé vers un ordre ou un lot ; les non-conformités portent une référence en texte libre.

**Étapes.**
1. Colonnes sur `quality_inspections` : ordre, opération d'ordre, lot de matière, lot de produit fini, réception.
2. Rattrapage : laisser vide pour l'historique.
3. Onglet « Qualité » sur la fiche de l'ordre et sur la fiche du lot.
4. Depuis l'écran Atelier : bouton « Contrôler » sur une opération de type contrôle.

#### M7-02 — Plan de contrôle par article

**Étapes.**
1. Table du plan de contrôle : article ou famille, étape (`réception`, `en cours`, `final`), caractéristique, type (mesure avec bornes, oui / non, visuel), fréquence (chaque lot, 1 lot sur N, par quantité), taille de l'échantillon.
2. Génération automatique des inspections à faire : à la réception, à l'opération de contrôle, à la clôture de l'ordre.
3. Saisie des résultats ; verdict calculé ; hors bornes = non-conformité proposée.

**Tests.** Article avec contrôle final « chaque lot » : la clôture d'un ordre crée une inspection en attente.

#### M7-03 — Le CCP comme cas particulier

**Constat [1 lecture].** Les relevés de procédé et le blocage CCP existent (migrations 422-423).

**Étapes.** Déclarer les CCP actuels comme caractéristiques de type « mesure avec bornes, bloquant » dans le plan de contrôle ; ne pas migrer les relevés existants ; vérifier que le blocage actuel se comporte à l'identique ; un seul écran de consultation pour relevés et inspections.

**Impact boulangerie.** Aucun : les relevés et le blocage restent tels quels.

#### M7-04 — Libération du lot

**Étapes.**
1. Statut de lot `en_attente_de_libération`, posé à la création si l'article a un contrôle final.
2. Un lot non libéré n'est ni vendable, ni consommable, ni transférable (hors quarantaine).
3. Libération par un rôle qualité, automatique si toutes les inspections sont conformes et que la politique le permet.
4. S'appuyer sur la quarantaine de réception existante (migration 461) : même mécanisme pour les matières.
5. Lors d'un rappel : blocage automatique des lots concernés.

**Tests.** Lot en attente : vente refusée en caisse et au bon de livraison.

**Impact boulangerie.** Aucun tant qu'aucun article n'a de contrôle final déclaré.

#### M7-05 — Non-conformités structurées

**Constat [1 lecture].** Migration 385 : référence en texte libre, action corrective en un champ.

**Étapes.**
1. Clés vers le lot, le fournisseur, l'ordre, l'inspection d'origine, la réclamation client.
2. Champs : gravité, cause (référentiel), décision sur le lot (`accepté`, `retouché`, `déclassé`, `détruit`, `retour fournisseur`).
3. Table des actions : type (corrective, préventive), responsable, échéance, état, vérification d'efficacité avec date et résultat.
4. Liens : une non-conformité fournisseur alimente l'évaluation fournisseur (migration 362) ; une destruction crée la perte au coût de revient.
5. Tableau de bord : nombre par cause, par fournisseur, délai moyen de clôture, actions en retard.

---

## 12. Lot 10 — G6 : socle multi-client

| Tâche | Contenu | Étapes clés |
|---|---|---|
| G6-01 | Double authentification | Code à usage unique par application ; obligatoire pour les rôles d'administration et de finance ; codes de secours |
| G6-02 | Connexion d'entreprise | OpenID Connect (Google, Microsoft) ; rattachement des comptes par e-mail |
| G6-03 | Multi-société | Table des entités juridiques ; remplacer les 24 lectures de `company_settings WHERE id = 1` par l'entité du contexte ; numérotation, plan comptable et exercices par entité |
| G6-04 | Multi-client (tenant) | Colonne de tenant et règles de cloisonnement sur toutes les tables, selon le plan du 2026-09-02 ; prérequis : G1-02 et G3 |
| G6-05 | Traductions | Bibliothèque de traduction, extraction des libellés module par module, français d'abord puis arabe (sens d'écriture) et anglais |
| G6-06 | Devise et pays | Helper de devise pour les 971 « DH » du client ; pack pays pour la fiscalité et la paie |
| G6-07 | Piste d'audit générique | Déclencheur unique posé sur toutes les tables métier (33 sur 340 aujourd'hui) ; onglet « Historique » sur chaque fiche |
| G6-08 | API ouverte | Description OpenAPI générée ; événements de webhook pour commandes, factures, stock, production ; documentation publique |

---

## 13. En continu — M8, G7, M9

### M8 — Écrans de production pilotés par la configuration

- Découper `PlanDetailPage.tsx` et `ProductionLaunchModal.tsx` en panneaux inscrits dans un registre (type d'ordre + options).
- Une seule source pour les libellés et couleurs de statut.
- Vocabulaire complet, avec écran d'édition.
- Gabarits d'impression paramétrables.
- Tous les calculs remontés au serveur.

Détail des tâches (constats **[non relus]**) :

#### M8-01 — Registre de panneaux

**Constat.** `PlanDetailPage.tsx` (2 101 lignes) n'a aucun panneau conditionné ; `ProductionLaunchModal.tsx` (2 449 lignes) ne lit ni option ni vocabulaire.

**Étapes.**
1. Inventorier les blocs visuels des deux écrans (en-tête, lignes, besoins, bon de sortie, pesage, étapes, rendement, coût, pertes, qualité, activité).
2. Extraire chaque bloc dans son composant, sans changer le rendu.
3. Créer le registre : identifiant du panneau, composant, condition d'affichage (option active, étape requise par le type d'ordre, permission), ordre.
4. Les deux écrans deviennent une boucle sur le registre.
5. Comparer des captures d'écran avant / après sur dix plans de la boulangerie : identiques.

**Impact boulangerie.** Aucun changement visible ; c'est le critère d'acceptation.

#### M8-02 — Une seule source de statuts

**Étapes.** Relever toutes les tables de correspondance statut → libellé → couleur du module ; les remplacer par une définition unique dans `shared`, alignée sur la machine à états (M2-03) ; test qui échoue si un statut du serveur n'a pas de libellé.

#### M8-03 — Vocabulaire complet

**Constat.** Le vocabulaire sectoriel (migration 514) couvre les menus, pas l'intérieur des écrans.

**Étapes.** Extraire les termes métier des écrans de production (« fournée », « pâton », « vitrine »…) en clés de vocabulaire ; valeur par défaut = terme actuel ; écran d'édition Paramètres › Vocabulaire avec aperçu ; champs en arabe conservés.

#### M8-04 — Gabarits d'impression

**Étapes.** Lister les impressions du module (bon de production, bon de sortie, étiquette de lot, fiche technique) ; pour chacune, sortir du code le titre, les colonnes affichées et les mentions ; les rendre paramétrables par type d'ordre via `document_templates` ; numéros toujours fournis par le serveur (G0-25).

#### M8-05 — Calculs remontés au serveur

**Étapes.** Repérer chaque calcul métier fait dans le navigateur (coût, rendement, besoins, conversions) ; créer ou réutiliser le point d'accès serveur correspondant (`computePlanCost` de G0-23) ; le client n'affiche plus que des valeurs reçues ; même chantier côté RH pour le récapitulatif de pointage.

#### M8-06 — Extensions boulangerie

**Étapes.** Isoler les champs propres à la boulangerie (pâtons, température de base, vitrine, darija) : ils deviennent des panneaux et des champs activés par option, plus des colonnes lues sans condition par le socle ; la boulangerie les garde tous actifs.

### G7 — Finitions par module

**Finance**
- Provisions générales avec reprises.
- Approbation et pièces jointes des écritures manuelles.
- Verrou de période par journal.
- Inventaire physique des immobilisations ; amortissement dérogatoire et par composants ; immobilisations en cours.
- Tableau des flux de trésorerie au format CGNC ; ratios.
- Prélèvements clients.

**Ventes, CRM, caisse**
- Envoi des factures, devis et BL par e-mail (file `email_outbox` existante) et journal d'envoi.
- Portail client : commande et paiement en ligne.
- Variantes, options, kits et menus.
- Cartes et bons cadeaux, avoir en compte ; échéancier client.
- Balance en caisse, codes-barres poids-prix, caisse identifiée côté serveur.
- Caisse hors ligne complète (catalogue en cache, service worker).
- Écran de preuve de livraison sur mobile.
- E-facturation dès publication du calendrier de la DGI.
- Leads, segmentation, campagnes ; signature de devis.

**Achats**
- TVA, remise et double unité figées sur la ligne de bon de commande.
- Accords-cadres ; prix par palier ; échéancier de livraison par ligne.
- Avoirs fournisseurs attendus et reçus ; document de retour.
- Lecture automatique des factures (reprendre le worktree `ocr-facturation-integration`).
- Portail fournisseur ; sous-traitance.

**Stock**
- Transferts de matières entre sites, stock en transit.
- Statut « bloqué » générique.
- Codes-barres et terminal mobile.
- Numéros de série, consignation, kits.

**Production, qualité, maintenance**
- Coût standard gelé et écarts matière, rendement, main-d'œuvre.
- Pièces de rechange, entretien préventif par compteur.
- Certificats d'analyse, étalonnage.
- Capacité finie et lissage.

**RH, paie, projets**
- Travail de nuit : lever le refus `checkOut < checkIn` (`employees.validator.ts:117-122`) et brancher `check_in_at` / `check_out_at`.
- Récapitulatif de pointage servi par le serveur (`AttendanceTab.tsx:181-182, 234`).
- Provision pour congés payés ; prêts avec échéancier ; mutuelle.
- Pointeuse, badge, pointage mobile.
- Modèles de rotation d'équipes ; approbation des congés à plusieurs niveaux.
- Formation, entretiens, recrutement, accidents du travail, sanctions, notes de frais, organigramme, masse salariale prévisionnelle.
- Projets : approbation des temps, facturation des temps (alimenter `invoice_id`), dépendances, jalons, charge par personne, budget par poste.

**Socle**
- Pièces jointes génériques (sur la table `files` de G0-04).
- Fil d'activité et commentaires sur les fiches.
- Vues et filtres enregistrés.
- Envoi planifié de rapports.
- SMS et WhatsApp ; application installable.
- Droits par champ ; signature électronique.

### M9 — Plus tard

Sous-traitance de production ; numéros de série en fabrication ; nomenclature fantôme ; consommation automatique à la déclaration ; désassemblage.

---

## 14. Documents à mettre à jour

| Document | Action |
|---|---|
| `docs/audit-ventes/00_SYNTHESE.md` | Marquer « historique au 2026-11-09 » ; renvoyer à l'audit global |
| `docs/AUDIT_O2C_GAP_ANALYSIS.md` | Idem ; L0-L6 livrés |
| `docs/AUDIT_POS.md` | Idem ; N1 et N2 clos |
| `docs/AUDIT_P2P_GAP_ANALYSIS.md` | Corriger : L1 à L6 commités ; L0 partiel |
| `docs/ARCHITECTURE_LABO_DDD_VS_KALUM.md` | Corriger : lots L1-L6 livrés (migrations 422-432) |
| `docs/AUDIT_SECURITE.md` | État de chaque point après G0-08 |
| `docs/DEPLOYMENT.md` | Sauvegarde, restauration, staging (G3) |
| `docs/PLAN_PRODUCTION_PARAMETRABLE.md` | À créer : le plan M0-M9 d'origine n'est pas dans le dépôt |

---

## 15. Tableau de suivi

État : ☐ à faire · ◐ en cours · ☑ fait.

### Lot 1 — G0 + M0

| ☐ | Tâche | Objet | Change des chiffres |
|---|---|---|---|
| ☑ | G0-00 | Jeu de référence | — |
| ☑ | G0-01 | API publique : prix, validation, idempotence | non |
| ☑ | G0-02 | Limiteurs de débit | non |
| ☑ | G0-03 | Expiration du jeton de portail | non |
| ◐ | G0-04 | Stockage des fichiers | non |
| ◐ | G0-05 | Déploiement conditionné à la CI | non |
| ☑ | G0-06 | Connexion par PIN | non |
| ◐ | G0-07 | Validation des factures et des mutations | non |
| ◐ | G0-08 | Reliquats de sécurité | non |
| ◐ | G0-09 | Pointages exclus de la paie | oui (paie) |
| ☑ | G0-10 | Paie d'un mois non terminé | non |
| ◐ | G0-11 | Contrôle du SMIG | non |
| ◐ | G0-12 | Livre de paie | non |
| ◐ | G0-13 | Barème IR versionné | non |
| ☑ | G0-14 | Paiement de bulletin en transaction | non |
| ◐ | G0-15 | Amortissement dégressif | oui (immobilisations) |
| ◐ | G0-16 | Régime de TVA | oui si bascule |
| ☑ | G0-17 | TVA déductible par établissement | oui (par établissement) |
| ☑ | G0-18 | Écrêtage du stock | non (trace ajoutée) |
| ◐ | G0-19 | Plafond de remise en caisse | non |
| ☑ | G0-20 | Compteur de promotions | non |
| ☑ | G0-21 | File hors ligne | non |
| ◐ | G0-22 | Emballages consommés deux fois | oui (stock) |
| ☑ | G0-23 | Charges et coût cohérent | oui (coût) |
| ☑ | G0-24 | Saisies perdues, pertes en transaction | non |
| ☑ | G0-25 | Numéros côté serveur | non |
| ☑ | G0-26 | Conversion d'unité stricte | non |
| ☑ | G0-27 | Défauts du calcul des besoins | oui (besoins) |
| ☑ | G0-28 | Divers (date, utilisateur système, TRS) | oui (TRS) |

**Restes des tâches ◐ (au 2026-11-16).**
- **G0-04** : code livré (migration 521). Reste côté infrastructure : créer le bucket privé et poser `STORAGE_DRIVER=gcs` / `STORAGE_BUCKET` sur Cloud Run (`docs/DEPLOYMENT.md`). Écart assumé : le fichier est renvoyé en flux par la route authentifiée, sans URL signée (aucune dépendance ajoutée).
- **G0-05** : déclencheur, sondes de santé et image non root livrés. L'audit des dépendances reste en signalement (`continue-on-error`) : il échoue aujourd'hui sur `xlsx` (sans correctif) et `zod` ; à rendre bloquant après G0-08.
- **G0-07** : factures (création, modification, fusion), stock de matières et caisse validés ; garde en CI. Il reste 361 mutations héritées sans schéma, inscrites dans `server/src/__tests__/fixtures/unvalidated-mutations.json` (dont règlements échelonnés, rapprochement, réceptions, paie) : `npx tsx scripts/audit-validation-routes.ts` en donne le détail.
- **G0-08** : état de chaque point dans `docs/AUDIT_SECURITE.md`. Deux restent partiels : V3 (`xlsx` retiré, mais `zod`, `nodemailer` et trois failles modérées demandent une montée de version majeure) et V5 (lectures de marge, recettes, stock et lots encore ouvertes à tout utilisateur connecté, à traiter en M2-04 / M2-05). L'ancien format `.xls` n'est plus lu à l'import.
- **G0-09** : correctif et test livrés. Rapport de rattrapage en lecture seule : `server/scripts/diagnose-pointages-exclus-paie.sql`. Sur la base locale : 3 jours certains (repos payés perdus, 376,93 DH) et 192 jours à vérifier. Reste à l'exécuter en production avec accord, puis à décider la régularisation avec le gérant.
- **G0-11** : contrôle livré (migration 524), inactif tant que le SMIG mensuel ou horaire n'est pas saisi dans le barème (Paramètres de paie) — valeurs à fournir par le comptable de paie. L'alerte figure sur le bulletin et en bandeau de la paie mensuelle ; elle n'est pas encore reprise dans le tableau de bord RH. Le contrôle porte sur le bulletin mensuel, pas sur les paies hebdomadaires et de quinzaine prises isolément.
- **G0-12** : livre de paie livré (`GET /payroll/book`, PDF paysage et Excel, par mois ou par année ; boutons dans la paie mensuelle). Reste à faire valider la présentation par le comptable avant diffusion. Pas de colonne matricule : la fiche salarié n'en porte pas, le numéro CNSS en tient lieu.
- **G0-13** : versions datées du barème livrées (`POST /payroll/tax-scales`, bouton « Nouvelle version » dans Paramètres de paie) ; un barème déjà utilisé par un bulletin n'est plus modifiable dans ses valeurs de calcul. Reste à vérifier avec le comptable que le barème en base est bien celui de l'exercice en cours.
- **G0-14** : `withTransaction` livré (transaction ambiante, `server/src/config/database.ts`) ; les trois paiements (mensuel, hebdomadaire, quinzaine) passent dans une seule transaction, verrou de ligne compris, et la compensation manuelle est retirée. Non fait : la factorisation des trois corps de paiement en un service commun `payPayslip` ; le reclassement 4432 du mensuel reste volontairement isolé par un point de sauvegarde (son échec n'annule pas le paiement). SUITE 2026-11-18 (ffcc23e) : factorisation faite — `repositories/payslip-payment.helper.ts` (`payPayslip`) porte le verrou, la retenue d'avance, le marquage idempotent et la sortie de caisse des trois paies ; le reclassement 4432 du mensuel ne passe que si cet appel a payé.
- **G0-15** : `computeSchedule` corrigé (première annuité au prorata des mois, exercice de complément, durée respectée) et testé sur des cas chiffrés à la main. Le plan étant recalculé à chaque lecture, les immobilisations sans dotation passée prennent la règle sans reprise de données. Base locale : aucune immobilisation en dégressif, jeu de référence identique. Règle vérifiée le 2026-11-16 contre la table de référence fournie par le gérant (1er avril, 100 000 DH, 5 ans, 40 % : 30 000 / 28 000 / 16 800 / 11 200 / 11 200 / 2 800), reprise en test. Non fait : la validation formelle par l'expert-comptable ; le passage de `server/scripts/diagnose-degressif-ecart.ts` (lecture seule) sur la base de production pour chiffrer l'écart des immobilisations déjà dotées.
- **G0-16** : régime retenu par le gérant le 2026-11-16 : encaissements. `declaration()` lit `sales.vat_regime` (mode + date de bascule `since`) : la TVA des factures clients et des tickets à crédit émis depuis la bascule est déclarée au prorata des règlements (affectations de règlements, encaissement du ticket), cumul arrondi au centime ; caisse, avoirs, extournes et factures d'avant la bascule restent déclarés à la date d'écriture. Écart assumé avec les étapes 3.1 et 3.2 du plan : pas de compte d'attente ni d'écriture de bascule au règlement, le compte 4455 « TVA facturée » du plan comptable marocain joue déjà ce rôle et la déclaration calcule la part exigible ; la date de bascule remplace l'écriture de rattrapage (3.5). Non fait : le réglage lui-même (Paramètres › Devis et crédit clients › Régime de TVA, resté sur « Débit » sans date de bascule) ; la validation par l'expert-comptable du traitement des avoirs (déduits à leur date), des chèques (pris à la date du règlement, pas de l'encaissement en banque) et des avances non affectées (non taxées avant affectation) ; une facture hors période comptable ouverte ne reçoit pas d'écriture et échappe donc à la déclaration (constaté en test sur 2033).
- **G0-17** : TVA déductible, en attente et exclue filtrées par établissement, ainsi que le relevé des déductions, avec la même règle que la TVA collectée (factures de l'établissement et factures sans établissement). Conséquence à connaître : une facture sans établissement apparaît dans la déclaration de chaque établissement ; seule la vue sans filtre donne la déclaration légale de la société. Base locale : un seul établissement, toutes les factures fournisseurs y sont rattachées, aucun chiffre ne change.
- **G0-18** : table `stock_anomalies` et paramètre `stock.negative_policy` par type d'article (mig 525, valeur initiale « autoriser et tracer »), helper `applyStockOut` (`server/src/services/stock-anomaly.ts`), écran Stock › Anomalies (liste, filtre, clôture avec motif), notification au magasinier. Écrêtages branchés : consommation matière de la production (complète et partielle), `adjustProductStock`, mise au rebut et péremption d'un lot (toujours tracées, jamais refusées), expédition d'un bon de livraison ; puis, second commit : pesée d'un bon de sortie au-delà du lot, emballages (`adjustStock`), semi-finis consommés par un plan parent, pertes au frigo, et toutes les sorties de vitrine (contrôle d'ouverture, inventaire de vitrine, décisions et écarts d'invendus, destruction de périmés) via `removeFromVitrine`. Les pertes, mises au rebut et sorties de vitrine sont toujours tracées, jamais refusées ; le blocage ne concerne que les sorties « normales » (production, pesée, emballages, mouvements et transferts de produits, livraisons). Les appelants de `adjustProductStock` transmettent leur document d'origine. L'écran propose « Ajuster le stock » (ouvre l'article) puis « Clôturer » avec motif. Écarts assumés : `inventory.repository.ts:668-670` est une entrée de stock (conversion ingrédient → consommable), pas une sortie, et reste tel quel ; `adjustVitrineStock` (vente en caisse) refusait déjà la vente sans stock et n'a pas été modifié ; l'ajustement n'est pas pré-rempli depuis l'anomalie (lien vers l'article, saisie manuelle) ; la notification vise le rôle magasinier seulement. Les GREATEST des réservations, des quantités facturées et des calculs d'affichage ne sont pas des écrêtages de stock et restent tels quels.
- **G0-19** : plafond de remise extrait dans `server/src/services/discount-policy.ts` (commandes et caisse partagent la règle). En caisse, la remise manuelle en % du montant après promotions est comparée au plafond du rôle ; au-delà, le serveur répond 403 `DISCOUNT_APPROVAL_REQUIRED` et la vente ne passe qu'avec le PIN d'un gérant ou d'un administrateur dont le plafond couvre la remise (mauvais PIN compté comme un échec de connexion, compte verrouillé après cinq). La remise manuelle et le valideur sont tracés sur le ticket (mig 526 : `manual_discount_amount`, `manual_discount_pct`, `discount_approved_by`). Caisse : plafond affiché sous les deux champs de remise, fenêtre « Validation d'un responsable », pas de mise en file hors-ligne d'une remise à valider. Non fait : la vérification à l'écran du bandeau et de la fenêtre (caisse fermée sur la base de dev, session non ouverte) ; sur la base locale aucun administrateur n'a de PIN, donc une remise au-delà de 30 % ne peut être validée par personne tant qu'un administrateur n'en définit pas un ; les devis gardent leur propre contrôle dans `quote.repository.ts` (non basculé sur le service commun).
- **G0-20** : `recordApplied` prend et vérifie l'utilisation dans la même instruction (`UPDATE … WHERE max_uses IS NULL OR uses_count < max_uses RETURNING`) ; sans ligne renvoyée, erreur 409 `PROMOTION_EXHAUSTED` qui annule la vente ou la commande entière. La caisse recalcule alors le ticket sans la promotion et prévient le caissier. Écart assumé : la conversion d'un devis en commande décompte sans refuser (le prix a déjà été promis au client), le compteur peut donc dépasser le maximum dans ce seul cas. Une vente mise en file hors-ligne puis refusée pour promotion épuisée relève de G0-21 (file bloquée par la première erreur).
- **G0-21** : `offlineQueue.ts` distingue la panne (réseau, 5xx, 401, 408, 429 : le rejeu s'arrête et reprendra) du refus (autres 4xx) ; une vente refusée passe dans la liste locale « à traiter » avec son motif et le rejeu continue. Caisse : pastille « N ventes à traiter », fenêtre pour renvoyer ou abandonner avec motif (journal local des 50 derniers abandons), ticket hors ligne avec la mention et la référence provisoire `HL-` + début de la clé d'idempotence ; toute vente mise en file porte une clé. Premier test du client (`client/src/features/pos/offlineQueue.test.ts`, vitest, étape ajoutée à la CI). Non fait : la correction du contenu d'une vente refusée avant renvoi (on renvoie telle quelle, une fois la cause corrigée) ; l'abandon reste dans le navigateur de la caisse et n'est pas remonté au serveur ; le ticket hors ligne s'imprime par le navigateur, pas sur l'imprimante thermique (elle passe par le serveur) ; la vérification à l'écran (caisse fermée sur la base de dev). SUITE 2026-11-18 (647298b, mig 596) : une vente refusée se corrige avant renvoi (lignes, quantités, paiement, même référence HL-) ; les ventes abandonnées remontent au serveur (`pos_offline_abandoned_sales`) et se consultent dans Ventes.
- **G0-22** : le second bloc de consommation d'emballages de `produceItems` est supprimé ; il reste un seul bloc, sous point de sauvegarde, avec `yield_quantity > 0` et `!isSemiFinishedPlan`. Vérifié : avec un bon de sortie, les emballages sortent au prélèvement (`bon-sortie.repository.ts`) et ce bloc est sauté avec les ingrédients ; `complete()` ne traite que les articles qu'il fait lui-même passer à « produit », donc pas de troisième consommation. Portée réelle du défaut : le démarrage exige un bon de sortie livré dès qu'un plan a des besoins matière, la double consommation ne touchait donc que les plans sans besoin matière propre (produit assemblé à partir de bases). Rattrapage : `server/scripts/diagnose-emballages-double-consommation.sql` (lecture seule) ; base locale : 0 mouvement en double. Non fait : le passage du script sur la base de production et l'ajustement éventuel, après accord du gérant ; le point de sauvegarde transforme en simple avertissement un refus de la politique « bloquer » des emballages (G0-18) sur ce chemin.
- **G0-23** : constat confirmé à la lecture (les charges saisies n'étaient lues que par l'écran de paramétrage ; le tableau de bord additionnait matières + main-d'œuvre + charges, sans l'énergie). `computePlanCost(planId)` (`production-cout.repository.ts`) est la seule fonction qui calcule le coût ; `calculateAndSave` l'enregistre ; `cout_total` (colonne calculée, mig 527) est la seule définition lue par le tableau de bord, la fiche et le graphique par jour. Les emballages consommés par le plan entrent dans le coût (`cout_emballages`, détail affiché). L'écran de la fiche ne refait plus l'addition. Charges saisies : nouveau réglage « Mode de calcul » (Paramètres › Production › Coûts et prix › Charges fixes mensuelles) — « taux sur les matières » (inchangé, valeur par défaut) ou « charges mensuelles » (loyer + énergie + autres répartis au prorata des matières des plans du mois, re-répartis à chaque calcul pour que la somme égale le montant saisi). Décision à prendre par le gérant : le mode reste « taux » ; sur la base locale 42 000 DH de charges mensuelles sont saisis et ne sont donc toujours pas répartis. Non fait : les rapports de marge (`reports.controller.ts`) gardent leurs propres agrégats par produit ; les coûts déjà enregistrés ne sont pas recalculés (un plan n'intègre ses emballages qu'à son prochain calcul) ; en mode mensuel, chiffrer un plan modifie la part de charges des autres plans du mois, y compris d'un mois passé. SUITE 2026-11-18 (c24e1bd, mig 598) : répartition unique du coût du plan entre ses articles, enregistrée par le calcul (`production_cout_reel.detail_repartition`, vue `v_plan_item_cost_share`, fonctions `_v2` des lots) ; rapports de marge, menu engineering et coût figé des lots la lisent ; les pertes ne sont plus comptées deux fois ; emballages, charges et façon ajoutés au rapport des coûts. Un plan chiffré avant 598 garde l'ancienne règle jusqu'à son prochain calcul.
- **G0-24** : constat confirmé (les observations et les quantités de bases de `ProductionLaunchModal.tsx` n'étaient envoyées nulle part ; les pertes partaient dans des appels `POST /product-losses` séparés, après la déclaration). `declareProduction` (`server/src/services/production-declaration.ts`) enregistre articles produits, pertes et saisies du lancement dans une seule transaction ; la création d'une perte est extraite du contrôleur dans `services/product-loss.service.ts` (une seule implémentation). Les pertes déclarées au lancement (prévu − produit) sont rattachées à l'article du plan et ne sortent pas de stock, ces pièces n'y étant jamais entrées ; elles n'ont plus de plafond « produit − déjà déclaré », qui les faisait échouer dès que la perte dépassait la quantité produite. Observations et bases : table `production_plan_observations` (mig 528), renvoyées avec le plan (`observations`). Non fait : l'affichage des observations sur la fiche du plan ; les quantités de bases sont un constat enregistré, sans effet sur le stock de semi-finis. SUITE 2026-11-18 (f29c4d8) : observations affichées sur la fiche de l'ordre (panneau Observations, onglet Production).
- **G0-25** : constat confirmé et précisé. Le serveur attribuait déjà les numéros de lot à la confirmation du plan (`production_lot_numbers`, sous verrou consultatif) et les numéros de bon de sortie par `document_sequences` (`bon_sortie`) ; le navigateur fabriquait un numéro de repli quand il n'en trouvait pas : `LOT-AAMMJJ-001` sur l'étiquette et le ticket, `LOT-AAMMJJ-NNN` dans le tableau des articles, `BSI-AAMMJJ-001` sur le bon de sortie imprimé (toujours 001, donc en double dès le deuxième bon du jour). Ces replis sont retirés : le tableau affiche « — », le bon imprimé porte le numéro du bon de sortie du plan, et l'impression d'un ticket, d'une étiquette ou d'un bon sans numéro du serveur est refusée avec un message. Écart assumé : aucun type `lot` ni `bon_production` n'a été ajouté à `document_sequences`, les deux numérotations serveur existantes couvrant déjà le besoin.
- **G0-26** : constat confirmé (`fn_unit_conv` rend 1 hors masse et volume, et pour poids ↔ volume sans densité). `fn_unit_conv_strict` (mig 529) rend `NULL` pour une conversion inconnue ; `fn_unit_conv` n'est pas touchée (bascule des appelants en M3). La vue `v_impossible_unit_conversions` liste les lignes de fiche (`recipe_ingredients`, `recipe_components`, `recipe_format_components`) dont l'unité ne se convertit pas vers l'unité de stock ; elle est affichée dans Stock › Santé des prix, bloc « Conversions d'unité impossibles ». Base locale : liste vide. Écart assumé : il n'existait pas de « tableau de bord de qualité des données » ; le bloc est placé sur la page qui contrôle déjà les prix.
- **G0-27** : `mrp.repository.ts` — les fiches archivées sont écartées des besoins de semi-finis ; les besoins de semi-finis descendent toute la nomenclature, niveau par niveau, chaque niveau étant calculé sur ce qu'il reste à produire du niveau au-dessus après son stock (colonne `level` ajoutée au résultat) ; la génération des demandes d'achat passe dans `withTransaction`, sous verrou consultatif par établissement, et saute toute matière ayant une demande ouverte (`pending`, `assigned`, `ordered`). Précision sur le constat : un index unique impose une seule fiche par produit, le `ORDER BY id LIMIT 1` ne choisissait donc jamais entre plusieurs fiches ; il est remplacé par une jointure sur la fiche non archivée. Les besoins matière utilisaient déjà l'explosion multi-niveaux de la migration 400.
- **G0-28** : (1) `maintenance.repository.ts` : la date d'échéance est formatée par `localIsoDate` (`server/src/utils/local-date.ts`), sans passer par UTC ; testé sur Casablanca, Paris, Tokyo et New York. Sur le poste de développement, Node donne un décalage nul pour Africa/Casablanca, le recul d'un jour n'y apparaissait donc pas ; il apparaît dans tout fuseau à l'est d'UTC. (2) Utilisateur technique « Système » (mig 530 : `users.is_system`, compte inactif, un seul possible), fourni par `systemUserId()` et utilisé par la tâche planifiée d'entretien ; il est exclu de la liste des utilisateurs. (3) `routing.repository.ts`, TRS : un arrêt compte pour sa part qui chevauche la période ; les jours planifiés sont les jours où le poste a travaillé ou a été à l'arrêt, un jour d'arrêt total entre donc dans le temps planifié. Écart assumé : il n'existe pas de calendrier par poste de charge ; un jour sans production ni arrêt saisi reste hors du temps planifié.

### Lot 2 — G1 + M1

| ☐ | Tâche | Objet | Change des chiffres |
|---|---|---|---|
| ☐ | G1-01 | Séparation des tâches : avertir → bloquer | non |
| ☐ | G1-02 | Cloisonnement par établissement | non |
| ☐ | G1-03 | Suggestions d'achat | non |
| ☐ | G1-04 | Écritures de réévaluation et de frais d'approche | oui (comptabilité) |
| ☑ | G1-05 | Interrupteurs de production sans effet | non |
| ☐ | G1-06 | Garde des modules en mode strict | non |
| ◐ | G1-07 | Tâche : dotations aux amortissements | oui si activée |
| ◐ | G1-08 | Tâche : charges constatées d'avance | oui si activée |
| ☑ | G1-09 | Tâche : écritures récurrentes | oui si activée |
| ◐ | G1-10 | Tâche : péremption des lots | non |
| ☑ | G1-11 | Tâche : alertes de DLC | non |
| ☑ | G1-12 | Tâche : échéances des documents RH | non |
| ☑ | M1-01 | Inventaire des constantes en dur | non |
| ☑ | M1-02 | Résolution des paramètres à héritage | non |
| ☑ | M1-03 | Reprise des constantes | non |
| ☑ | M1-04 | Écran unique des politiques de production | non |

**Notes du lot 2 (au 2026-11-16).**
- **Tâches non codables en l'état** : G1-01 demande une revue des avertissements cas par cas avec le gérant et une date pivot ; G1-02 et G1-03 ont pour prérequis un environnement de staging (G3-01) ; G1-04 attend la validation du schéma d'écriture par le comptable ; G1-06 demande 30 jours de journal du mode `log`.
- **G1-07** : tâche `depreciation_monthly` (mig 531, `services/scheduler.ts`). Elle passe chaque jour les dotations manquantes de l'exercice du mois écoulé, de janvier à ce mois ; une période verrouillée fait échouer la tâche avec le message de la base. Livrée DÉSACTIVÉE : elle écrit en comptabilité, et la règle du dégressif (G0-15) n'est pas validée par l'expert-comptable. À activer dans Paramètres › Tâches planifiées.
- **G1-08** : tâche `prepaid_recognition` (mig 532) : constate chaque jour les mois échus des charges constatées d'avance, jusqu'au mois écoulé, par `prepaidChargeRepository.recognizeDue`. Livrée DÉSACTIVÉE, pour la même raison (écritures comptables).
- **G1-10** : constat aggravé à la lecture. `autoExpireDueLots` échouait à CHAQUE appel depuis le correctif de valorisation des pertes (commit `6b14265`) : `FOR UPDATE` sur une requête à jointure externe est refusé par Postgres, et l'erreur était avalée par `product.controller.ts`. La péremption automatique des lots de produits finis ne passait donc jamais. Corrigé (`FOR UPDATE OF pl`) ; tâche `lots_expire` (mig 533, toutes les 15 minutes) ; appel de secours retiré du contrôleur. Écart assumé : la tâche appelle `autoExpireDueLots` (perte, stock et statut) et non `markExpiredLots`, qui ne change que le statut et aurait empêché l'enregistrement de la perte. Livrée DÉSACTIVÉE : à sa première exécution elle sortira du stock tous les lots périmés accumulés. À faire avant de l'activer : passer `server/scripts/diagnose-lots-perimes-actifs.sql` (lecture seule) sur la base de production et valider le chiffrage ; base locale : 0 lot. Tant que la tâche est désactivée, aucun lot ne périme automatiquement, comme avant.
- **G1-11** : tâche `dlc_alerts` (mig 534), quotidienne et ACTIVÉE (elle ne fait que notifier). Seuils réglables : Paramètres › Production › Coûts et prix › « Alertes de DLC » (`stock.dlc_alerts`, 7 et 2 jours à la livraison, e-mail aux gérants et administrateurs en option). Une alerte par lot et par seuil (`lot_expiry_alerts`) ; une notification par établissement et par nature de lot : au magasinier pour les matières, au gérant pour les produits finis.
- **G1-12** : tâche `hr_documents_due` (mig 535), quotidienne et ACTIVÉE. Elle suit, pour les salariés actifs : la carte d'identité (`employees.cin_expires_on`), les documents datés (`employee_documents.expires_on` : visite médicale, certificat…), la fin de contrat et la fin de période d'essai du contrat actif. Seuils réglables dans Paramètres › Notifications › « Échéances du personnel » (`hr.documents_due`, 30 et 7 jours à la livraison, e-mail en option). Une alerte par échéance et par seuil (`hr_due_alerts`, la date fait partie de la clé : un document renouvelé est signalé de nouveau) ; une notification au gérant par établissement. Libellés des domaines Comptabilité, Stock et Personnel ajoutés à l'écran des tâches planifiées.
- **G1-05** : les interrupteurs Étapes, Rendement et Coût de revient valaient « désactivé » en base alors que les trois fonctions servent tous les jours ; la mig 537 les aligne d'abord sur « activé » (valeur et défaut), puis le code les lit. Coupé : le panneau correspondant est masqué sur la fiche du plan, le calcul du coût (un plan ou groupé) et la saisie du rendement sont refusés (409), et les étapes ne bloquent plus la production même si « étapes bloquantes » est à oui. Réglages en double supprimés : la majoration et les étapes bloquantes ne s'éditent plus que dans Paramètres › Production ; Production › Paramétrage les affiche en lecture seule avec un lien. Restent sans effet et sans écran : `production_frigo_enabled` et `production_calcul_inverse_enabled` (ces fonctions relèvent des options de secteur, mig 507).
- **M1-02** : table `policy_values` (mig 538, vide à la livraison) et service `services/policies.ts` — `resolvePolicy(clé, contexte)` cherche article → type d'ordre → atelier → établissement → société → défaut du catalogue et rend aussi le niveau d'origine ; `setPolicy` pose ou retire une valeur (bornes du catalogue, niveau existant), journalisée dans le journal du paramétrage. Pas de système parallèle : une politique est une entrée du catalogue des paramètres (stockage `policy`, liste `scopes`), donc visible dans Paramètres › Paramètres métier au niveau société. Chaque écriture crée une version de configuration ; une version porte désormais les politiques et sa restauration les remet en place (les versions antérieures, sans ce champ, ne les touchent pas). Cache de 30 s, vidé à l'écriture. Première politique déclarée : `production.yield_target` (90 %), pas encore lue par le code (M1-03).
- **M1-03** : constantes de l'inventaire reprises, un commit par constante, jeu de référence rejoué (`apres-m1` : zéro écart avec `apres-g028`). Politiques déclarées au catalogue avec la valeur d'avant comme défaut : `production.yield_target` (90 %, tous niveaux), `production.yield_display` (85 / 70 %), `production.fixed_charges_rate` (0,40), `production.kwh_price` (1,50), `production.margin_multiplier` (×3), `production.mrp_horizon` (14 j), `production.showcase_time` (07:00), `production.shift_cutoff` (14 h), `production.oee_thresholds` (85 / 60 %), `production.forecast_history` (56 j), `production.replenishment_history` (29 j). Cas particuliers : le taux de charges de la société reste la colonne réglée dans Production › Paramétrage (un seul endroit) et la politique ne porte que les surcharges par établissement, atelier ou type d'ordre ; les 191 heures ne sont pas une politique mais le réglage de la paie (`payroll_settings.monthly_legal_hours`), désormais lu par le coût de main-d'œuvre ; le multiplicateur ×3 ne sert plus qu'à la création d'une recette (la colonne est obligatoire, les autres replis `|| 3` sont du code mort laissé en place). Côté écrans, `usePolicies.ts` lit les valeurs résolues pour l'atelier du plan ; tant qu'elles ne sont pas chargées l'affichage est neutre, aucune valeur de repli n'est recopiée dans le client. « DH » et le fuseau restent à M3-06 et G6.
- **M1-04** : Production › Paramétrage a deux onglets, Réglages et Politiques. Politiques : choix du niveau regardé (société, établissement, atelier), une ligne par politique avec valeur effective, niveau d'origine, marque « Modifié », « Surcharger pour cet atelier / cet établissement », « Rétablir », et la liste des autres valeurs posées (dont celles par article ou type d'ordre, retirables). API `GET /production/policies` et `PUT /production/policies/:key` (droit Paramètres › Production, schéma de validation). Les surcharges par article et par type d'ordre se posent par l'API ; l'écran ne propose pas encore de les créer.
- **G1-09** : les modèles d'écritures portent une périodicité (mig 536 : mensuelle, trimestrielle, annuelle ; première échéance, dernière échéance facultative). Les échéances sont déduites de la première (ancre + n périodes) : un 31 ne glisse pas vers le 30. Écran Comptabilité › Modèles d'écritures : colonne « Périodicité » et champs dans le formulaire. Tâche `recurring_entries`, quotidienne et ACTIVÉE (inerte tant qu'aucun modèle n'a de périodicité) : une écriture par échéance, datée de l'échéance, sous verrou du modèle ; les échéances manquées sont rattrapées une à une ; une échéance sur une période comptable fermée n'est pas passée et met la tâche en erreur avec son motif.
- **Constats hors tâche, relevés en passant** : (1) le bilan prenait la valeur absolue des soldes et se déséquilibrait dès qu'un compte avait son solde du côté inhabituel (486, fournisseur débiteur) : corrigé dans un commit à part ; base locale sans écart. (2) Incohérence de fuseau NON corrigée : la DLC d'un lot « du jour » est calculée tantôt en date de la base, tantôt en date de Casablanca ; les deux diffèrent entre minuit et l'heure de décalage de la base (une heure en production si la base est en UTC, cinq heures sur le poste de développement). Deux tests (`production-workflow`, `scenarios-ventes`) échouent dans cette fenêtre et passent le reste de la journée.
- **G3-05** (étape 1, faite par nécessité) : la garde des numéros de migration tolère les six doublons historiques sur une base vierge.

### Lot 3 — G2

| ☐ | Tâche | Objet | Change des chiffres |
|---|---|---|---|
| ◐ | G2-01 | Mesurer la complétude en production | non |
| ☑ | G2-02 | Tableau de bord « Qualité des données » | non |
| ◐ | G2-03 | Fusion des ingrédients en double | oui (coût des fiches) |
| ◐ | G2-04 | Prix aberrants | oui (coût des fiches) |
| ◐ | G2-05 | Poids cuit des formats | non |
| ◐ | G2-06 | Allergènes des ingrédients | non |
| ◐ | G2-07 | Étapes des fiches | non |
| ◐ | G2-08 | Fiches à désactiver et données parasites | non |
| ◐ | G2-09 | Étiquette réglementaire | non |
| ☐ | G2-10 | Valeurs nutritionnelles (optionnel) | non |

**Notes du lot 3.**
- **G2-01** : `server/scripts/diagnose-master-data.sql` écrit (lecture seule : synthèse puis sept listes). Passé sur la base locale le 2026-11-16 : formats actifs sans poids cuit 49 / 49 ; ingrédients sans allergènes 405 / 405 ; fiches actives sans étapes 38 / 52 ; ingrédients homonymes 33 fiches en trop ; ingrédients sans prix 27 ; prix aberrants 24 sur 287 comparables ; fiches actives jamais produites 11 / 52. RESTE : le passer en production avec accord et joindre le résultat. « Prix aberrant » = plus de 5 fois la médiane des ingrédients de même catégorie et de même unité, ou moins du cinquième (catégories d'au moins 5 ingrédients valorisés).
- **G2-02** : Paramètres › Données › Qualité des données (droit de la section Données). Sept compteurs calculés en direct (à corriger, total, complétude, état Complet / À compléter / Prioritaire) et, pour chacun, la liste à corriger (200 lignes au plus) avec un lien vers la fiche technique ou la fiche de l'ingrédient. Mêmes définitions que le script de G2-01 (`repositories/master-data-quality.repository.ts`). API `GET /settings/data/quality` et `GET /settings/data/quality/:key`, lecture seule.
- **G2-03** : outil livré, AUCUNE fusion faite — le choix de la fiche à garder revient au responsable (étape 4). `repositories/ingredient-merge.repository.ts` : aperçu sans écriture puis fusion en une transaction ; les tables qui référencent `ingredients.id` sont lues dans le catalogue de la base (21 clés étrangères au 2026-11-16, plus deux colonnes non déclarées), donc une table ajoutée plus tard est couverte. Là où la cible existe déjà au même endroit, les quantités s'additionnent (ligne de recette de même unité, stock d'un établissement, ligne d'inventaire physique) ; coût de la fiche gardée = moyenne pondérée par les stocks ; journal `ingredient_merges` (mig 539). Écran : Paramètres › Qualité des données, bloc « Fusionner deux fiches » (deux champs de recherche, aperçu de l'impact, confirmation, dernières fusions). ÉCARTS ASSUMÉS : (1) la table `ingredients` n'a pas d'état archivé et 149 requêtes la lisent : la fiche en trop est archivée entière dans le journal puis retirée, au lieu d'être laissée en fiche fantôme ; (2) les deux fiches doivent avoir la même unité — une fiche « à l'unité » ne se fusionne pas dans une fiche « au kilo » tant que son unité n'est pas corrigée (cas de la troisième fiche « Beurre »). RESTE : faire choisir les fiches par le responsable, fusionner, puis rejouer le jeu de référence et expliquer l'écart de coût ligne par ligne (étape 5). Aperçu sur la base locale, Beurre 57 DH/kg dans Beurre 60,07 DH/kg : 1 fiche technique, 4 lots, 3 bons de commande, coût 60,0681 → 57,34.
- **G2-04** : outil livré, AUCUN prix corrigé — chaque correction est une décision du responsable. Stock › Santé des prix, bloc « Prix à revoir » : ingrédients sans prix ou à plus de 5 fois la médiane de leur catégorie (ou moins du cinquième), avec les trois dernières réceptions validées et une proposition (prix moyen pondéré par les quantités). « Corriger » demande le nouveau coût et un motif ; `repositories/ingredient-cost-correction.repository.ts` met à jour le coût et écrit `ingredient_cost_corrections` (mig 540 : avant, après, motif, réceptions et médiane à l'appui, auteur). Aucune écriture comptable ni modification de lot : le coût catalogue sert au coût des fiches, la valeur du stock vient des lots. Constat sur la base locale : beaucoup de prix « aberrants » sont des articles non alimentaires rangés dans la catégorie « Autre » (baignoire, grille, chemise perforée) et la proposition reprend souvent le prix suspect lui-même, saisi à la réception — la revue reste manuelle. RESTE : revue ligne par ligne par le responsable, puis rejouer le jeu de référence et expliquer l'écart de coût des fiches concernées.
- **G2-05** : étapes 1 et 2 livrées. Paramètres › Qualité des données a désormais trois onglets (Contrôles, Ingrédients en double, Poids des formats). Onglet Poids des formats : une ligne par format actif d'une fiche active, poids cru et poids cuit saisis en grammes, perte à la cuisson calculée, filtre « sans poids cuit », enregistrement de la ligne en quittant le champ ; le poids cuit ne peut pas dépasser le poids cru. Quand des pesées réelles existent sur 90 jours (poids unitaire des pâtons, masse cuite / pièces sorties, saisis au rendement), leur moyenne est proposée et un clic la reprend ; la base locale n'en a aucune. API `GET /recipes/format-weights`, `PUT /recipes/format-weights/:formatId` (`repositories/format-weights.repository.ts`). RESTE : la campagne de pesée avec le chef de production (étape 3) et le champ obligatoire à l'activation d'un nouveau format (étape 4), non fait : le formulaire de création de format de l'éditeur de nomenclature ne porte pas encore ces champs, et l'imposer maintenant bloquerait toute création.
- **G2-06** : étapes 1, 2 et 4 livrées ; AUCUN allergène enregistré — la validation ligne par ligne revient au responsable qualité. Mig 541 : `ingredients.allergen_traces` (même référentiel de 14 codes, jamais en double avec `allergens`), `allergens_reviewed_at` et `allergens_reviewed_by`. Quatre états : contient, traces, absent (fiche vérifiée), non renseigné (fiche jamais vérifiée et sans allergène) ; « aucun allergène » devient un état déclaré. Onglet Allergènes de Paramètres › Qualité des données : ingrédients en lignes (les plus utilisés d'abord), 14 allergènes en colonnes, case à trois états (C, T, vide), filtre et recherche, 40 lignes à la fois. Une fiche non renseignée arrive avec une proposition tirée de sa catégorie et de son nom (`proposeAllergens` : farines → gluten, produits laitiers → lait, œufs, fruits à coque ; noms trompeurs écartés : beurre de cacao, lait de coco, sucre semoule…), affichée en pointillé et écrite seulement à « Valider ». Le compteur de qualité et le script de G2-01 comptent désormais les fiches « non renseignées » (le script lit la nouvelle colonne par `to_jsonb` et passe aussi sur une base d'avant la 541). Étape 4 vérifiée par test : un produit dont la fiche utilise une base faite d'une autre base porte les allergènes des ingrédients du bas. RESTE : l'import des fiches fournisseurs par le module d'import générique (étape 3 : il n'a pas de type de colonne « liste d'allergènes ») ; les traces ne remontent pas encore au produit fini (vues 343 sur « contient » seulement) — à faire avec l'étiquette, G2-09.
- **G2-07** : la liste demandée existe — Paramètres › Qualité des données, contrôle « Fiches actives sans étapes », triée par nombre de lignes de plan, avec un lien vers chaque fiche. Sur la base locale, les dix plus produites sans étapes : Crème pâtissière (61 lignes de plan), Pain au chocolat (61), Pain complet (58), Brioche (55), Croissant (55), Pain aux raisins (52), Baguette normale (51), Baguette tradition sésame (50), puis les suivantes dans l'écran. RESTE : la saisie des étapes elles-mêmes, par le chef de production, sur l'éditeur de fiche existant.
- **G2-08** : contrôles faits en lecture seule sur la base locale, RIEN archivé. (1) Température de 90 °C visée par la migration 407 : il n'en reste aucune ; les seules températures d'étape des fiches actives sont cuisson 170 °C, pétrissage 24 °C et pointage 4 °C. (2) « Pâte levée feuilletée nature » NE PEUT PAS être archivée telle quelle : elle a 45 lignes de plan et sert de base à Croissant, Pain au chocolat et Pain aux raisins (6 utilisations en tout). L'archiver casserait ces trois fiches ; il faut d'abord décider par quelle base la remplacer (« Pâte levée feuilletée », jamais produite et utilisée 5 fois, est la candidate). (3) Fiches actives jamais produites : 11, listées dans Paramètres › Qualité des données ; ce sont surtout des bases (dorure, sirop, chantilly, génoise, levain…) consommées par d'autres fiches sans passer par un plan : « jamais produite » ne veut pas dire « inutile ». DÉCISIONS à prendre par le responsable avant tout archivage.
- **G2-09** : étapes 2, 3 et 5 livrées, 4 et 6 en partie. `GET /products/:id/label-data` (`repositories/product-label.repository.ts`) compose l'étiquette : ingrédients tirés de la nomenclature éclatée (`v_recipe_explosion`, semi-finis remplacés par leurs ingrédients sur tous les niveaux), triés par poids décroissant (`fn_ingredient_weight_kg` ; un ingrédient au litre sans densité ou à la pièce sans poids passe en fin de liste, avec un avertissement), ingrédients porteurs d'un allergène en majuscules, « Peut contenir des traces de » pour les allergènes présents seulement en traces, poids net (poids cuit du format), date limite (durée de conservation), conservation, mentions. `blockers` rend l'étiquette non imprimable : pas de fiche technique, aucun ingrédient, ou un ingrédient dont les allergènes ne sont pas renseignés. Mig 542 : `products.legal_name`, `storage_conditions`, `label_mentions`, enregistrés par `PUT /products/:id/label-fields`. Écran : onglet « Étiquette » de la fiche produit (blocages, mentions à compléter, saisie des trois mentions, aperçu, tableau des ingrédients avec leur part du poids, impression d'une planche A4 de huit étiquettes 99 × 67 mm, bouton inactif tant qu'un blocage subsiste). Constat sur la base locale : aucune étiquette n'est imprimable aujourd'hui (Croissant : 7 ingrédients sans allergènes) — c'est l'effet voulu de G2-06. RESTE : valider le contenu obligatoire avec le référent qualité (étape 1, ONSSA) ; petit format Niimbot (une étiquette 50 × 30 mm ne peut pas porter une liste d'ingrédients lisible : format à décider) ; version arabe (les noms d'ingrédients n'ont pas de traduction en base) ; impression depuis le lot et à la déclaration de production ; nom et adresse du fabricant sur l'étiquette.
- **G2-10** (optionnel) : non lancé. Le plan le réserve à l'après-G2-05, et aucun poids cuit n'est encore saisi : sans eux, une valeur nutritionnelle « pour 100 g de produit fini » ne se calcule pas.

### Lot 4 — G3

| ☐ | Tâche | Objet | Change des chiffres |
|---|---|---|---|
| ◐ | G3-01 | Environnement de staging | non |
| ☐ | G3-02 | Sauvegarde et restauration | non |
| ◐ | G3-03 | Observabilité | non |
| ☑ | G3-04 | Qualité de code en CI | non |
| ◐ | G3-05 | Migrations | non |
| ◐ | G3-06 | Helper de transaction | non |
| ☑ | G3-07 | SQL hors de la couche de données | non |
| ☐ | G3-08 | Fichiers géants | non |
| ☐ | G3-09 | Performance | non |
| ◐ | G3-10 | Tests du client et de bout en bout | non |
| ◐ | G3-11 | Données personnelles (loi 09-08) | non |

**Notes du lot 4.**
- **G3-01, G3-02, G3-03** : non codables depuis ce poste — ils demandent des ressources Google Cloud (second service Cloud Run et seconde instance Cloud SQL, restauration réelle, outil de suivi des erreurs). À lancer avec les accès au projet cloud. SUITE 2026-11-18 : la part codable est faite — G3-01 (cf5bca5) : `APP_ENV=staging` (bandeau, e-mails détournés vers `STAGING_MAIL_TO`, aucun envoi sans), `server/scripts/anonymize-staging.sql`, `.github/workflows/deploy-staging.yml` inactif tant que `STAGING_SERVICE_NAME` est vide ; G3-03 (a0cb850) : requêtes SQL lentes journalisées et `console.*` remplacés par le journal structuré. Les ressources cloud, l'outil de suivi des erreurs et l'exercice de restauration sont décrits dans `docs/RUNBOOK_ACTIONS_EXTERNES.md`.
- **G3-05** : étapes 1 et 4 déjà en place avant cette passe (le lanceur `src/config/migrate.ts` refuse tout nouveau numéro en double hors des six historiques ; `scripts/test-db-setup.sh` joue toutes les migrations sur une base vide à chaque intégration continue). Ajouts : test statique `migrations-numbering.test.ts` (nom des fichiers, aucun nouveau doublon, liste des doublons tolérés identique à celle du lanceur) et règles écrites dans `server/migrations/README.md` (numérotation, migration appliquée = figée, migration destructive précédée d'une sauvegarde, pas de retour arrière générique, pièges de production, application à la main). ÉTAPE 2 — FAITE le 2026-11-16 : `migrate` n'échouait plus sur la 266 mais sur les migrations 460 à 465, enregistrées dans la base de développement avec une empreinte MD5 (32 caractères) au lieu du SHA-256 attendu. Ces six MD5 étaient exactement ceux des fichiers commités : le contenu appliqué est donc identique, seul l'algorithme était faux à l'inscription. Les six empreintes ont été remplacées par le SHA-256 des mêmes fichiers (accord de l'utilisateur) ; `npm run migrate` se termine désormais sans erreur en local. La production n'est pas concernée si elle a reçu ces migrations par le lanceur.
- **G3-04** : non fait. ESLint et Prettier ne sont pas installés (le script `lint` de la racine pointe sur un outil absent) : les ajouter est une montée de dépendances de développement et un changement du fichier de verrouillage, à faire sur une branche dédiée. Les deux règles de code voulues par le plan sont tenues en attendant par des gardes de test (G0-07 validation des mutations, G3-07 SQL hors dépôts). SUITE 2026-11-18 (9cf828f) : FAIT — ESLint et Prettier en CI, bloquant sur les vrais défauts (règle des hooks React, code inatteignable…), style en avertissement ; deux hooks corrigés.
- **G3-07** : règle tenue par une garde de test plutôt que par une règle de lint (pas de dépendance nouvelle), sur le modèle de G0-07. `sql-outside-repositories-guard.test.ts` compte les appels SQL directs (`db.query`, `client.query`, `pool.query`, `db.getClient`) des contrôleurs et des fichiers de routes ; `fixtures/sql-outside-repositories.json` porte l'état au 2026-11-16 : 315 appels dans 39 fichiers (le plus chargé : `product.controller.ts`, 45). Le compteur d'un fichier ne peut que baisser : une requête ajoutée, ou un nouveau fichier qui en contient, fait échouer le test ; un fichier nettoyé oblige à baisser son compteur. La résorption se fait à chaque passage sur un fichier.
- **G3-10** : l'étape 1 est faite depuis G0-21 (Vitest côté client, test de la file hors ligne, étape d'intégration continue). Playwright et les cinq parcours demandent le staging (G3-01).
- **G3-06** : vagues 1 et 2 faites le 2026-11-16 — 75 blocs de transaction manuels passés sous `withTransaction` dans 37 dépôts de données (un commit par dépôt), 274 → 199 `BEGIN` manuels restants. Seuls les blocs de forme strictement canonique ont été réécrits, par un script : ouverture, corps sans `return` ni `ROLLBACK`, un seul `COMMIT` suivi au plus d'un `return`, capture qui annule et relance, bloc qui clôt une méthode de premier niveau. La logique est inchangée ; suites identiques et jeu de référence à zéro écart après chaque vague (`apres-g306v1`, `apres-g306v2`). Seule nuance : l'expression du `return` qui suivait le `COMMIT` s'évalue désormais avant la validation, donc une relecture qui échouerait annule la transaction au lieu de la laisser validée. RESTE, à reprendre à la main, cas par cas : les 199 blocs hors forme canonique — refus métier au milieu du corps (`ROLLBACK` puis `return`), traitement après validation (notification, écriture secondaire), blocs dans une boucle, et tout ce qui est hors des dépôts (services, contrôleurs, scripts). Les plus chargés : `accounting.repository.ts` (12), `production.repository.ts` (6), `bon-sortie.repository.ts` (5).
- **G3-08, G3-09** : non commencés. G3-08 se fait à l'occasion des lots qui touchent les fichiers géants ; G3-09 demande `pg_stat_statements` sur la base de production.
- **G3-11** : export et registre livrés, anonymisation NON faite (décision). `services/personal-data.ts` : `exportPersonalData('employee' | 'supplier', id)` rend la fiche et toutes les lignes des tables qui la référencent (lues dans le catalogue de la base : 25 tables pour un salarié, 20 pour un fournisseur), le compte utilisateur du salarié sans empreinte de mot de passe ni code PIN, ses 500 dernières connexions ; les pièces jointes sont remplacées par leur taille ; 10 000 lignes au plus par table, la troncature est signalée ; chaque export est tracé dans `auth_events` (`personal_data_export`). Routes : `GET /employees/:id/personal-data` (droit de modification sur le Personnel) et `GET /suppliers/:id/personal-data` (direction). Boutons « Exporter les données » sur la fiche salarié (onglet Documents) et sur la fiche fournisseur. Registre des traitements (clients, salariés, fournisseurs, comptes : finalité, données, destinataires, droits) dans Paramètres › Import et export. Vérifié à l'écran sur un salarié de la base locale (pointages, contrat, règlements, bulletins, plannings ; aucun secret dans le fichier). RESTE — DÉCISION : l'anonymisation d'un salarié ou d'un fournisseur personne physique n'est pas offerte. Bulletins, déclarations CNSS et pièces comptables doivent rester nominatifs pendant leur durée légale de conservation, à fixer par le responsable avec son conseil ; le registre ne porte ni durée ni base légale pour la même raison.

### Lot 5 — G4

| ☐ | Tâche | Objet | Change des chiffres |
|---|---|---|---|
| ☑ | G4-01 | Paiements fournisseurs en lot | oui (règlements, à l'exécution) |
| ☑ | G4-02 | Rapprochement bancaire par règles | oui (écritures de frais, si règles) |
| ☑ | G4-03 | Prévision de trésorerie | non |

**Notes du lot 5.**
- **G4-01** : étapes 1 à 7 livrées, sauf deux points. Mig 543 : `payment_runs`, `payment_run_lines` et — le RIB du fournisseur n'existant nulle part — `suppliers.rib` et `bank_name` (24 chiffres, clé contrôlée comme pour les salariés ; champs ajoutés à la fiche fournisseur). `repositories/payment-run.repository.ts` : sélection des factures payables jusqu'à une date (reçue, validée, non soldée, non litigieuse, sans blocage de paiement, en dirhams), campagne en brouillon avec contrôles (reste à payer, une facture dans une seule campagne ouverte sous verrou, compte bancaire et non caisse), soumission (RIB valides puis moteur d'approbation, nouveau type `payment_run` réglable par montant et nombre de factures ; sans règle applicable, approuvée directement), fichier CSV pour le portail de la banque (une ligne par fournisseur) et lettre d'ordre PDF reprise de l'ordre de virement des salaires (son objet est désormais paramétrable), exécution tout ou rien — un règlement par facture par le chemin habituel `paymentRepository.create` (écriture, lettrage automatique, reste à payer) — puis avis de paiement en file d'e-mails pour chaque fournisseur qui a une adresse, rejet bancaire d'une ligne par l'annulation de règlement existante (contre-pièce, facture de nouveau à payer). Écran : Comptabilité › Paiements en lot (liste, préparation par fournisseur avec montant partiel, fiche avec le circuit). Test du plan vert : trois factures → trois règlements, écritures équilibrées, factures soldées et lettrées ; plus les refus et le rejet bancaire. Vérifié à l'écran sur la base locale : la préparation liste les 77 factures payables ; aucun fournisseur n'a encore de RIB, l'écran le signale. Aucune campagne créée sur les données réelles. ÉCARTS : (1) le « format de la banque » est le CSV générique déjà utilisé pour les salaires (aucun format imposé par les banques marocaines ; à adapter à la banque du client) ; (2) le circuit d'approbation `payment_run` n'a aucune règle par défaut — à créer dans Paramètres › Circuits d'approbation si le client veut un seuil. RESTE : saisir les RIB des fournisseurs ; l'IBAN du compte de trésorerie est nécessaire pour la lettre d'ordre. SUITE 2026-11-18 (788ba28, mig 600) : (1) format du fichier de virement réglable par compte bancaire (délimité ou positions fixes, colonnes, décimales, date, en-tête ; générique par défaut, identique au fichier des salaires) ; (2) règle d'approbation par défaut `payment_run_default` : toute campagne va à l'administrateur (seuil à ajuster par le gérant).
- **G4-02** : étapes 1, 2, 4, 5 et 6 livrées, 3 par règle. Mig 544 : `bank_rules` (priorité, libellé contient ou expression, sens, plage de montant ; action « rapprocher » avec tolérances ou « générer l'écriture » sur un compte de contrepartie) et `bank_statement_line_matches` (une ligne de relevé solde plusieurs écritures ; reprise des rapprochements existants). `services/bank-matching.ts` : chargement en deux requêtes, appariement en mémoire en quatre passes — référence (numéro de facture, de chèque, de règlement ou de pièce lu dans le libellé, confiance 100), règles (95 si l'écriture est générée, 90 sinon), montant unique à ± 7 jours (80), regroupement de 2 à 5 écritures (70) — une écriture ne sert qu'une fois, une ligne ambiguë n'est pas proposée ; application sous verrou des lignes du relevé et des écritures candidates, écriture de frais au journal de banque. « Rapprochement auto » applique désormais les propositions ≥ 80 ; les regroupements se valident à l'écran. Écran Banque : panneau des règles, propositions avec confiance et validation en masse, « créer une règle pour ce libellé » depuis une ligne sélectionnée ; une ligne rapprochée indique sa méthode. Test du plan sur un relevé d'essai de six lignes : 2 rapprochées par l'ancien moteur, 4 proposées par le nouveau (référence, frais générés, montant, regroupement), l'ambiguë et l'inconnue laissées. Sur le relevé réel de juin (base locale, 87 lignes non rapprochées) : aucune proposition sûre sans règle — l'essentiel est fait de flux TPE nets de commission (51 lignes), de chèques (13), de versements d'espèces (6) et de frais (droits de timbre, pack) : ce sont les règles à créer par le comptable (rien n'a été créé ni validé sur les données réelles). RESTE : une règle « commission de carte » qui rapproche un flux TPE net de l'encaissement carte brut en générant la commission (écart variable) n'est pas encore exprimable — il faudrait une tolérance en pourcentage. SUITE 2026-11-18 (97c6782, mig 601) : règle « commission de carte » (`match_fee`) : remise TPE nette rapprochée des encaissements carte d'un ou plusieurs jours, écart brut − net en fourchette de % passé en 6147 au journal BQ ; une seule combinaison doit convenir. Défaire puis relancer réutilise l'écriture générée (jamais de seconde commission).
- **G4-03** : les quatre étapes livrées. `services/cash-forecast.ts` (lecture seule) projette le solde jour par jour sur 13 semaines à partir du solde au grand livre des comptes de trésorerie : ventes au comptoir (moyenne du même jour sur 8 semaines — source ajoutée au plan, c'est la première entrée d'argent du client), créances clients décalées du retard moyen de chaque client, effets en portefeuille, factures fournisseurs (ou date de leur campagne de paiement), échéancier hors factures, salaires bruts selon la périodicité, dettes au personnel (4432), CNSS (4441) le 10, TVA due (4455 − 3455) le 20, acomptes d'IS, écritures récurrentes, lignes manuelles (mig 545 `cash_forecast_lines`) ; une échéance passée tombe au premier jour. Écran Comptabilité › Rapports › Prévision de trésorerie : courbe, seuil d'alerte réglable (paramètre `accounting.cash_forecast`), scénario de retard des clients, détail par semaine et par source, lignes manuelles. Lien G4-01 : la préparation d'une campagne affiche le solde prévu à la date du virement et le point bas avec les factures sélectionnées. CONSTAT base locale : le solde de départ est négatif d'environ 730 000 DH (banque et caisse ont un solde créditeur au grand livre) — les recettes ne semblent pas toutes passées en comptabilité en développement ; la prévision reflète le grand livre tel qu'il est. LIMITES : salaires en brut (prudent), CNSS et TVA lues sur les soldes comptables, chèques fournisseurs émis non encaissés non distingués.

### Lot 6 — M2 et rôles configurables

| ☐ | Tâche | Objet | Change des chiffres |
|---|---|---|---|
| ☑ | M2-01 | Types d'ordre | non |
| ☑ | M2-02 | En-tête d'ordre | non (numéros OF ajoutés aux ordres existants) |
| ☑ | M2-03 | Une seule machine à états | non |
| ☑ | M2-04 | Référentiel des permissions | non |
| ☑ | M2-05 | Bascule des routes | non |
| ☑ | M2-06 | Droits par atelier | non |
| ☑ | M2-07 | Écran des rôles | non |
| ☑ | M2-08 | Lien commande ↔ ordre | non |

**Notes du lot 6.**
- **M2-01 / M2-02 / M2-03** : mig 546. `production_order_types` (bon de sortie, pesage, contrôle, mode de consommation, série, atelier par défaut, actif, par défaut) ; type « Plan du jour » = parcours actuel, type par défaut. En-tête sur `production_plans` : priorité (1 à 5), `planned_start`, `planned_end`, type, et le numéro d'ordre — ÉCART : colonne nommée `of_number` et non `order_number`, parce que les requêtes de plans renvoient déjà `order_number` pour la commande client jointe (le nom aurait masqué ce numéro ou l'aurait affiché comme une commande). Série `production_order` (OF-AAAA-NNNNN) dans `document_sequences` ; un déclencheur BEFORE INSERT pose type, numéro et dates sur les trois chemins de création existants. Rattrapage : 917 ordres en dev, 625 en test, numérotés par date de création, dates = date du plan. Un type sans bon de sortie : la confirmation ne génère pas de BSI, le démarrage part de « confirmé », la matière est déduite à la déclaration (même chemin qu'un plan sans BSI aujourd'hui) ; « Plan du jour » refuse de démarrer tant que le bon n'est pas clôturé. La table SQL des transitions (mig 299) est comparée à la définition TypeScript par un test (toute divergence échoue) — elle n'est pas régénérée : les deux tables étaient identiques et une régénération aurait demandé de remplacer une fonction ancienne. Pesage et contrôle sont portés par le type mais pas encore lus (M4-M7). Contrainte `CHECK` sur les statuts de ligne (6 valeurs écrites par le code). Écrans : Production › Paramétrage › Types d'ordre ; choix du type et de la priorité à la création ; numéro OF, type et priorité modifiable sur la liste et la fiche.
- **M2-04 / M2-05** : mig 547. 639 clés « module.ressource.action » dans `shared/src/constants/permissions.ts`, amorcées depuis les 943 routes gardées : chaque clé regroupe des routes qui acceptaient exactement les mêmes rôles, `defaultRoles` = ces rôles. `role_action_permissions` (rôle ↔ clé), `user_action_permissions` (exception accordée ou retirée), `permission_seeded_keys` : le serveur amorce une clé nouvelle une seule fois (chaque rôle dont le rôle de base figure dans `defaultRoles`), un retrait fait ensuite tient. Garde `can('clé')` ; un rôle créé reçoit les clés du rôle copié, un changement de rôle de base recopie les clés du nouveau rôle de base. Non-régression : les gardes sont lues à l'exécution dans la pile du routeur Express (`utils/route-rights.ts`) et comparées, route par route et rôle par rôle, à un instantané pris avant la bascule (`route-rights.snapshot.json`, 1 325 routes). Bascule par un script de réécriture (`scripts/permissions-bootstrap.ts`), un commit par module dans l'ordre du plan ; plus aucune garde `authorize` dans les routes ; test rejoué à chaque commit, scénario de bout en bout des rôles vert. ÉCARTS : libellés générés (français approximatif sur certaines clés, à corriger à la main dans le référentiel) ; pas de passage en staging (aucun environnement de staging dans ce poste).
- **M2-06** : la table d'appartenance (`production_workshop_members`, mig 511) et son rattrapage existaient. Ajout : agir sur un ordre (17 actions passant par `loadOwnedPlan`) exige d'être membre de son atelier, sauf permission `production.all_workshops` (admin et gérant par défaut, comme aujourd'hui) ; consultation ouverte ; un ordre sans atelier reste ouvert.
- **M2-07** : Utilisateurs › Rôles › Permissions par action : matrice rôle × permission repliée par module (cases partielles), recherche, enregistrement groupé, rôle administrateur verrouillé ; bouton « Dupliquer » sur un rôle ; aperçu des permissions effectives d'un utilisateur (rôles, délégations, exceptions).
- **M2-08** : mig 548 `production_plan_items.order_item_id`, posé par le sourcing d'une commande ; rattrapage des 42 lignes déjà liées en dev (même ordre et même produit, rattachement unique seulement). La fiche ordre montre la commande et le client de chaque ligne ; la fiche commande montre, sous chaque ligne, l'ordre qui la sert et son état.

### Lot 7 — G5 : planification et stock

| ☐ | Tâche | Objet | Change des chiffres |
|---|---|---|---|
| ◐ | G5-01 | Stock à la date | non |
| ☑ | G5-02 | Point de commande et stock de sécurité | non (propositions seulement en mode manuel) |
| ☑ | G5-03 | Classes ABC et inventaire tournant | non |
| ☑ | G5-04 | Calcul des besoins phasé | non (lecture seule, création à la validation) |
| ☑ | G5-05 | Plan directeur enregistré | non |
| ☑ | G5-06 | Date de disponibilité promise | non |

**Notes du lot 7.**
- **G5-01** : étapes 2 à 5 livrées, 1 partielle. Mig 549 : `fn_stock_at(date, établissement)` reconstitue quantité, coût et valeur par article à la fin d'une date en retirant du stock courant les mouvements journalisés après elle (le coût est celui en vigueur ce jour-là, relu dans le journal des fiches achats) ; `fn_stock_journal_gaps` liste les articles dont le journal n'explique pas le stock ; un déclencheur refuse tout mouvement daté dans une période de stock clôturée une fois le jour de clôture passé. Écran Stock › Clôtures : « Stock valorisé au… » avec export CSV et avertissement des articles au journal incomplet. Contrôle : au présent la valeur rejouée égale la valeur courante (183 854,71 DH contre 183 854,70 en dev). CONSTAT base locale : 174 articles sur 377 ont un journal incomplet (578 lots sur 764 sans mouvement rattaché, dérives datées d'octobre : reprises et chargements directs) ; leurs dates passées sont approximatives. Les chemins de code vérifiés (réception, ajustement, réassort, production, invendus) écrivent bien leur mouvement. RESTE (étape 1) : rattraper l'historique demande une décision (écritures de reprise datées) ; auditer les mises à jour de lots sans mouvement (pesage, ouverture de contenant).
- **G5-02** : mig 550. Le seuil d'alerte existant (`inventory.minimum_threshold`) est le point de commande — c'est déjà lui que lisent les alertes et « À commander ». Ajouts : stock de sécurité, maximum, mode manuel / calculé, dernier calcul (consommation moyenne, proposition). Calcul : consommation moyenne des 56 derniers jours × délai du fournisseur préféré (`supplier_items`, sinon délai par défaut) + stock de sécurité ; paramètres `stock.replenishment`. Tâche planifiée hebdomadaire `reorder_points` : applique en mode calculé, pose une proposition en mode manuel (jamais d'écrasement). « À commander » remonte jusqu'au maximum (à défaut, deux fois le point de commande, règle d'avant). Écran Stock › Paramétrage › Points de commande (édition, validation groupée des propositions). Permission `stock.inventory.reorder_points`.
- **G5-03** : mig 551. Classe A/B/C par article et par établissement selon la valeur consommée sur 12 mois (80 % / 95 %), fréquence de comptage par classe (30 / 90 / 180 j), campagne tournante = campagne partielle du module Inventaires limitée aux articles dus (A en tête, 40 au plus) ; `stockCountRepository.create` accepte une liste d'ingrédients. Tâche `cycle_counts` créée DÉSACTIVÉE (elle ouvrirait des campagnes sur les données réelles). Encart dans Stock › Inventaires. Aucune classe calculée ni campagne ouverte sur la base locale.
- **G5-04** : `services/mrp-phased.ts` (mig 552 : horizon, délais). Calcul pur testé à part (`planPhased`) : projection jour par jour, règles de lot (minimum, multiple), décalage par délai, explosion niveau par niveau (produit → bases → ingrédients ; sous-recettes non bases dépliées), signalement des besoins dans le délai, messages d'action avancer / retarder / annuler sur les ordres et bons de commande en cours. Chargement : prévision (ou plan directeur), commandes fermes à leur retrait, stocks finis, semi-finis et matières, ordres non produits, bons de commande ouverts à leur date de livraison prévue, délais et conditionnements fournisseurs, stock de sécurité. Validation : ordres de fabrication (un par jour de lancement) et demandes d'achat ; les bases restent informatives (leurs dépendances naissent à la confirmation de l'ordre, mécanisme existant). Écran Production › Plan directeur › Besoins phasés. Sur la base locale : 63 articles, 96 propositions en 0,3 s. CONSTAT en passant : la base est demandée dans son unité de rendement (g) alors que sa composition décrit un lot ; le facteur a été corrigé dans le nouveau moteur — le calcul « semi-finis » existant (`mrp.repository.semiFinishedNeeds`, niveaux 2 et plus) divise par le diviseur de lot et pourrait surestimer les sous-bases : à vérifier.
- **G5-05** : mig 553 `master_schedule_entries` (article × semaine × établissement). Écran Production › Plan directeur › Plan par semaine : la prévision s'affiche en indication, une case saisie la remplace dans le calcul phasé (répartie selon le profil de la prévision, à parts égales si elle est nulle), une case vidée y revient ; commandes fermes comptées en plus. Permission `production.master_schedule`.
- **G5-06** : `services/promise-date.ts` : stock libre (stock − réservé, mig 389) + production planifiée non affectée à une commande (M2-08), jour par jour ; sinon « à produire » à J + délai pour un produit fabriqué (la commande déclenche sa production), « à approvisionner » pour un produit acheté. Saisie de commande : la date s'affiche sous chaque article, en rouge si elle dépasse le retrait. LIMITE : capacité des ateliers non modélisée ; la production planifiée pour la boutique est promise aux commandes.

### Lot 8 — M3 : unités et mesures

| ☐ | Tâche | Objet | Change des chiffres |
|---|---|---|---|
| ☑ | M3-01 | Référentiel des unités par dimension | non (jeu de référence : zéro écart) |
| ☑ | M3-02 | Conversions propres à l'article | non (zéro écart) |
| ◐ | M3-03 | Nouvelle fonction de conversion et bascule des appelants | non (zéro écart) |
| ◐ | M3-04 | Quantité + unité à la place des colonnes _g / _kg | non (zéro écart) |
| ☑ | M3-05 | Clé de répartition du coût au choix | non (zéro écart) |
| ◐ | M3-06 | Devise par helper | non |

**Notes du lot 8.** Jeu de référence rejoué à chaque tâche : zéro écart (apres-g402 → apres-m305). Suite complète en base verte à la fin du lot (579 tests).
- **M3-01** : mig 554. Les unités vivaient déjà dans `ref_entries` (table « units », mig 515) : complétées plutôt que dupliquées dans une seconde table — mg, cl, dl (que `fn_unit_conv` convertissait sans les connaître), minute et heure, décimales, marque « système », douzaine = 12 pièces. Vue `v_units` (dimension en français, facteur vers l'unité de base). `unit_id` sur ingrédients, emballages, fiches (rendement) et les trois tables de lignes de composition, rattrapés par code et tenus par déclencheur ; `v_unit_unmatched`. Base locale : aucune ligne de composition non rattachée ; base de test : 41 emballages de test portent « piece » (hors référentiel, à corriger à la main). Écran Paramètres › Unités de mesure (lecture ; ajout d'unité dans Référentiels). Test : chaque couple d'unités système a exactement le facteur de `fn_unit_conv`.
- **M3-02** : mig 555 `item_unit_conversions` (« 1 source = facteur cible » par article, source = unité ou contenant ; origines saisie, densité, contenant, poids par pièce). Reprise des colonnes d'origine (404 contenants et 27 densités en dev), tenue à jour par déclencheur ; conversion inverse incohérente refusée. Panneau « Unités et conversions » sur la fiche ingrédient et la fiche produit.
- **M3-03** : mig 556. `fn_convert_factor` / `fn_convert_qty` : même dimension → référentiel ; entre dimensions → conversion de l'article ; inconnu → NULL, jamais 1. Facteurs en table indexée (`unit_factor_cache`, rafraîchie quand le référentiel change). Vues `_v2` générées depuis les définitions actuelles (15 appels remplacés) et `fn_ingredient_weight_kg_v2`. Comparaison `_v1`/`_v2` (scripts/compare-unit-views.ts, test unit-views-v2) : zéro écart en test et en dev (177 fiches, 1 166 lignes d'explosion). Bascule du code un appelant par commit : 3 dépôts à appel direct puis 7 vues/fonction. Plus aucun appel à `fn_unit_conv` dans `server/src`. COÛT : la nouvelle fonction ne peut pas être « inlinée » par PostgreSQL ; lecture complète des vues 6 à 20 fois plus lente (100-140 ms au lieu de 6-17 ms sur la base locale), négligeable sur une fiche. RESTE (étape 6) : `fn_unit_conv` et les vues d'origine restent un cycle de mise en production, puis à retirer ; `fn_unit_conv_ok` (indicateurs « conversion incertaine ») est encore lu par deux requêtes.
- **M3-04** : mig 557. `_qty` + `_unit_id` à côté de 8 colonnes de poids (formats : poids cru/cuit ; fiches et versions : poids de pièce ; contenants ; relevés de rendement). Rattrapage à l'identique ; double écriture par un déclencheur générique dans les deux sens (l'ancien code écrit l'ancienne colonne, le nouveau la quantité + unité ; conversion impossible refusée) ; anciennes colonnes marquées obsolètes. Écran basculé : grille des poids des formats (l'unité saisie, g ou kg, est conservée et affichée). RESTE : basculer les autres écrans (fiche, rendement, contenants) avant tout retrait des colonnes `_g` / `_kg`. SUITE 2026-11-18 (6e22c9a) : rendement, contenants et fiche (poids de pièce, poids cru/cuit des formats, versions et restauration) écrivent `_qty` + `_unit_id` ; un appel ancien n'envoyant que `_g`/`_kg` donne les mêmes chiffres. Côté fiche, l'API est basculée mais aucun écran ne saisit encore ces poids.
- **M3-05** : mig 558 + politique `production.cost_allocation_key` (poids par défaut, quantité, valeur de vente, parts saisies), réglable société / établissement / atelier / type d'ordre. CONSTAT : le code ne répartissait pas le coût d'un plan entre ses articles (seule la coupe répartit, au prorata des pièces équivalentes) ; la répartition est donc ajoutée (`allocate`, appelée par `computePlanCost`) ; une clé inapplicable (poids manquant, parts ≠ 100 %, aucun prix) retombe sur la quantité et le signale — c'est le cas de tous les plans locaux, faute de poids unitaires. Parts manuelles sur les articles du plan (total 100 %). Le niveau « type d'ordre » des politiques lisait `plan.type` (quotidien/hebdomadaire) : il lit maintenant le code du type d'ordre (aucune valeur n'était posée à ce niveau). Écrans : section « Répartition du coût entre les articles » du coût réel ; types d'ordre dans Paramétrage › Politiques.
- **M3-06** : `formatMoney` dans `shared` (devise de base de la table `currencies`, repli DH) ; côté client `money()` / `currencySymbol()` ; côté serveur `services/currency.ts`, utilisé par le PDF de fiche technique. Les 43 occurrences du module Production remplacées (montants désormais au format français « 1 234,50 DH »). Garde de test : aucun « DH » ni « MAD » en dur dans le module Production (vérifiée : la même règle trouve 86 occurrences dans Ventes). RESTE : les autres modules (≈ 930 occurrences), en étendant la garde à chaque module converti.

### Lot 9 — M4 à M7 : production industrielle

| ☐ | Tâche | Objet | Change des chiffres |
|---|---|---|---|
| ☑ | M4-01 | Versions de nomenclature avec statut et date d'effet | non |
| ☑ | M4-02 | Version figée sur la ligne d'ordre | non |
| ☑ | M4-03 | Activation d'une version soumise à approbation | non |
| ☑ | M4-04 | Plusieurs nomenclatures par article | non |
| ☑ | M4-05 | Substituts d'article | non |
| ☑ | M4-06 | Co-produits déclarés (coupe généralisée) | non (zéro écart sur la coupe) |
| ☑ | M4-07 | Champs personnalisés sur fiches, ordres, lots | non |
| ☑ | M5-01 | Opérations de gamme complètes | non |
| ☑ | M5-02 | Opérations instanciées sur l'ordre | non (politique « json » par défaut) |
| ◐ | M5-03 | Reprise des étapes JSON | non (rapport seul) |
| ☑ | M5-04 | Calendrier des postes | non |
| ☑ | M5-05 | Référentiel équipement unique | non |
| ☑ | M6-01 | Mode de consommation par type d'ordre | non |
| ◐ | M6-02 | Stock par lot et par emplacement | non (zéro écart lot par lot) |
| ☑ | M6-03 | Référentiel unique des motifs de rebut | non |
| ☑ | M6-04 | Contrôle de reprise | — (zéro écart avant-m602 → apres-m6) |
| ☑ | M7-01 | Inspections rattachées | non |
| ☑ | M7-02 | Plan de contrôle par article | non (aucun plan déclaré en base) |
| ☑ | M7-03 | Le CCP comme cas particulier | non (garde identique) |
| ☑ | M7-04 | Libération du lot | non (aucun article avec contrôle final) |
| ☑ | M7-05 | Non-conformités structurées | non |

**Notes du lot 9.** Migrations 559-576. Jeu de référence : zéro écart apres-m305 → apres-lot9 (sept familles, dont stock-lots lot par lot). Suite complète en base : 630 tests verts sur 632 ; les 2 échecs restants tiennent à la fenêtre de minuit (machine en heure de New York, base en UTC, métier en heure de Casablanca : DLC et « aujourd'hui » calculés dans des fuseaux différents ; même cause pour production-workflow et stock-at-date, verts en journée), pas au lot.
- **M4-01** : mig 559 `bom_versions` (instantané JSON figé de la composition), statut brouillon / active / obsolète, date d'effet, motif, comparaison, bandeau sur la fiche. ÉCART : version = instantané plutôt qu'un `version_id` sur chaque ligne de composition (30 requêtes lisent la composition vivante).
- **M4-02** : mig 560 `bom_version_id` sur la ligne d'ordre à la confirmation, avertissement si la fiche a été modifiée sans nouvelle version. FAIT (64cf723, mig 593) : une fiche modifiée sans nouvelle version est rejouée (`fn_bom_snapshot_apply`) dans un point de sauvegarde le temps du calcul des besoins (confirmation, déclaration, écart théorique), arborescence comprise ; la fiche courante reste intacte. Format supprimé depuis la version : fiche courante, signalé.
- **M4-03** : mig 561, approbation `bom_change` (écart de coût, ordres ouverts, allergènes ajoutés) ; brouillon promu ou retiré par le circuit.
- **M4-04** : mig 562, fiches alternative / sous-traitance rattachées par `alternative_for_product_id` (la fiche par défaut reste celle liée par `product_id`), choix sur la ligne d'un ordre en brouillon, `getRecipeFor`. ÉCART : pas de colonne `is_default`. CLÔTURÉ (aa0a2f0) : la fiche choisie sur la ligne est suivie par le coût prévu et théorique, le coût réel matières, le rendement, les bases semi-finies, les emballages du bon de sortie, la traçabilité et les étapes ; une alternative peut devenir la fiche par défaut.
- **M4-05** : mig 563 `recipe_line_substitutes` (ratio, priorité, validité, par fiche ou général) ; au bon de sortie, une ligne non pesée bascule sur le substitut (lot FEFO, article d'origine et motif gardés) ; allergènes réellement consommés. FAIT (c91db1a, mig 594) : le remplacement en masse prend un ratio, les fiches choisies, un mode « déclarer comme substitut » (recipe_line_substitutes) et active la nouvelle version des fiches par le circuit M4-03 ; annulation exacte (quantités ÷ ratio, substituts retirés).
- **M4-06** : mig 564, type de sortie (principal, co-produit, sous-produit, déchet valorisé), sorties déclarées sur la fiche, vue `v_production_output_cost_v2` ; sans sous-produit, identique à la vue 397.
- **M4-07** : mig 565, entités recipe / production_order / product_lot dans le moteur de champs personnalisés, bloc sur les trois fiches. FAIT (11ac522) : champs des ordres et des fiches dans la source Production du générateur, nouvelle source Lots produits (axes, filtres, sommes des champs numériques, codes revérifiés avant le SQL) ; import générique en mise à jour par nom de fiche, n° d'ordre, n° de lot (colonne de rapprochement jamais réécrite). Correctif au passage : une clé portée par plusieurs fiches est refusée au lieu d'être rattachée au hasard (toutes les entités de l'import).
- **M5-01** : mig 566, opérations de gamme (type, réglage, temps machine et MO, contrôle, bloquante), gamme rattachée à la fiche, éditeur sur la fiche technique ; coût MO standard inchangé pour les gammes existantes. FAIT (39757e8, mig 595) : la version fige la gamme (`routing_id` + opérations) ; gamme modifiée = modification non activée ; l'ordre prend la gamme de sa version et ses opérations sont copiées depuis l'instantané.
- **M5-02** : mig 567. ÉCART : les opérations d'ordre réutilisent `production_item_etapes` (lues par l'Atelier) au lieu d'une table parallèle. `routing_id` écrit à la confirmation ; instanciation au lancement si `production.steps_source` = « gamme » (défaut « json » : rien ne change) ; quantités bonnes / rebutées ; temps → `production_temps_travail` ; opération bloquante = déclaration refusée.
- **M5-03** : `scripts/etapes-to-routings.ts` (rapport ; `--apply` crée les gammes). Base de dev : 14 fiches, 33 étapes, aucune n'a de poste, 1 sans durée ; `--apply` NON lancé (validation du chef, puis bascule par atelier). FAIT (59e87d8) : les étapes JSON d'une fiche sont figées (enregistrement refusé, raison affichée) quand elle a une gamme et que tous les ateliers qui l'ont produite sur 90 jours exécutent la gamme. Reste une décision : `--apply` puis bascule atelier par atelier, après validation du chef.
- **M5-04** : mig 568 calendrier (plages × ressources, jours fermés), `fn_work_center_capacity` ; charge par plan et TRS lisent le calendrier. FAIT (0f724d8) : le rétro-planning place les étapes d'un poste à calendrier dans ses heures d'ouverture (réparties sur plusieurs plages, jours fermés exclus) et signale celles qui ne tiennent pas sur 7 jours. Les conflits restent comptés sans les ressources parallèles du calendrier.
- **M5-05** : mig 569. Référence physique = `production_equipements` (la maintenance pointait `fixed_assets` ou un libellé) : équipement → poste et immobilisation (rapprochement par noms proposé, lien validé à la main), arrêt → demande d'intervention, intervention terminée → arrêt du poste, qualité dans le TRS. CLÔTURÉ (6b7c29c) : l'équipement de production se choisit sur une intervention saisie depuis la Maintenance (immobilisation ou nom repris).
- **M6-01** : le mode du type d'ordre (stocké depuis M2-01, jamais lu) est appliqué : « manuel » = aucune sortie automatique, sorties saisies sur l'ordre ; écart théorique / réel par matière.
- **M6-02** : mig 570 `ingredient_lot_locations`, reflétée par déclencheur depuis les zones (le code existant reste la source), transferts tracés en mouvements entre emplacements, emplacements Magasin et Frigo. PIÈGE : reprise par INSERT, jamais par UPDATE sur `ingredient_lots` (déclencherait `trg_inventory_sync_lots`, qui recalcule l'inventaire). RESTE : destinations magasin / frigo côté produits finis. SUITE 2026-11-18 (6e22c9a, mig 605) : produits finis rangés par emplacement (`product_lot_locations`) à la saisie du rendement (vers magasin / vers frigo), transfert par `POST /product-lots/:id/move-location`, part rangée réduite automatiquement à la vente / perte. `vers_magasin`/`vers_frigo` restent entiers (passer en décimal casserait les calculs client) ; pas d'écran de transfert manuel.
- **M6-03** : mig 571 `scrap_reasons` (domaines d'usage, anciens codes repris) ; la contrainte figée de `product_losses` devient un contrôle par le référentiel ; écrans et registre des pertes sur le référentiel.
- **M7-01 à M7-05** : mig 572-576. Inspections rattachées (ordre, opération, lot, réception), onglet Qualité, bouton Contrôler ; plan de contrôle (réception, en cours, final ; fréquences ; échantillon) générant les inspections à faire ; CCP = ligne bloquante sur un type d'étape (garde inchangée), consultation unique relevés + inspections ; lot `pending_release` refusé en caisse et au BL, libéré à la main ou automatiquement (`quality.auto_release`) ; non-conformités structurées (causes, décision sur le lot, actions avec efficacité, note fournisseur, tableau de bord).

### Lot 10 — G6 : socle multi-client

| ☐ | Tâche | Objet | Change des chiffres |
|---|---|---|---|
| ☑ | G6-01 | Double authentification | non |
| ◐ | G6-02 | Connexion d'entreprise (OpenID Connect) | non (inactive sans identifiants) |
| ☐ | G6-03 | Multi-société | — (session dédiée) |
| ☒ | G6-04 | Multi-client (tenant) | — bloquée : prérequis G1-02 (staging) et G3 (projet Google Cloud) |
| ☐ | G6-05 | Traductions | — (session dédiée) |
| ◐ | G6-06 | Devise et pays | Devise faite client (47ea52e→62828b5) et serveur (21409f1→9dff693, mig 592) ; pack pays fiscalité/paie à faire |
| ☑ | G6-07 | Piste d'audit générique | non |
| ☑ | G6-08 | API ouverte | non |

**Notes du lot 10.** Migrations 577-579. Jeu de référence : zéro écart apres-lot9 → apres-lot10. Suites : 462 tests unitaires verts ; en base 639 / 640 (seul échec : scénario de vente FEFO dans la fenêtre de minuit, voir lot 9).
- **G6-01** : mig 577. TOTP (RFC 6238) codé avec `node:crypto` (vecteurs de la RFC en test), secret chiffré AES-256-GCM, 10 codes de secours hachés à usage unique. Connexion en deux temps : le mot de passe rend un jeton intermédiaire (clé distincte, 5 min, n'ouvre aucune route), le code ouvre la session. Paramètre `security.mfa.requiredRoles` (défaut admin, comptable, finance) : un compte de ces rôles sans double authentification doit l'activer (écran imposé, QR code, codes de secours) ; il ne peut pas la désactiver. La connexion par PIN est refusée aux comptes protégés ou soumis. IMPACT : un administrateur qui se connecte à l'application doit activer la double authentification. RESTE : écran « Sécurité » du profil (désactivation, régénération des codes) pour les rôles non soumis.
- **G6-02** : mig 579 `user_identities`. Code d'autorisation avec PKCE ; tentative (state, nonce, vérificateur) dans un cookie signé 10 min ; id_token vérifié (clés JWKS, émetteur — locataire réel pour Microsoft —, audience, nonce, expiration, RS256 seul, e-mail vérifié) ; rattachement par e-mail à un compte ACTIF, jamais de création ; double authentification conservée (retour `/login?mfa=`). Inactive tant que `OIDC_GOOGLE_*` / `OIDC_MICROSOFT_*` et `OIDC_REDIRECT_BASE` / `OIDC_FRONT_URL` ne sont pas configurés : à enregistrer chez Google / Microsoft avant mise en service. Testé avec un faux fournisseur, pas avec les vrais.
- **G6-07** : mig 578 `audit_trail` (ajout seul) + déclencheur générique `trg_audit_trail` sur 278 tables métier (33 avant) : modifications champ par champ et suppressions, auteur (`app.user_id`), colonnes sensibles masquées ; créations non tracées (la ligne les porte). Exclusions : journaux, compteurs de stock, caches, miroirs, sessions, files. Une nouvelle table se rattache par `SELECT fn_audit_attach_all()`. Onglet « Historique » sur la fiche technique et l'ordre (profils qui voient le journal d'audit). RESTE : l'auteur n'est connu que sur les écritures qui posent `app.user_id` (23 chemins) ; monter l'onglet sur les autres fiches.
- **G6-08** : description OpenAPI 3.1 générée (`/api/v1/public/openapi.json`, corps des requêtes tirés des schémas zod) et page `/api/v1/public/docs` ; catalogue unique des événements dans `shared` ; webhooks émis : commande créée, statut de commande, ordre confirmé, lot produit, ordre terminé (dans la transaction, sans jamais bloquer l'action). RESTE : événements factures et stock (non émis, donc non listés). SUITE 2026-11-18 (6a4830d) : événements factures et stock émis — facture émise, avoir émis, facture fournisseur validée, facture soldée, réception, inventaire validé.
- **G6-03, G6-05, G6-06** : refontes transversales (24 lectures de `company_settings`, extraction des libellés en trois langues, ≈ 930 « DH » et pack pays) proposées en sessions dédiées.

### M8 — Écrans pilotés par la configuration

| ☐ | Tâche | Objet | Change des chiffres |
|---|---|---|---|
| ☑ | M8-01 | Registre de panneaux de l'ordre et de la fenêtre de lancement | non |
| ☑ | M8-02 | Une seule source de statuts | non |
| ☑ | M8-03 | Vocabulaire complet | non |
| ☑ | M8-04 | Gabarits d'impression | non |
| ☑ | M8-05 | Calculs remontés au serveur | oui (récapitulatif de pointage, aligné sur le bulletin) |
| ☑ | M8-06 | Extensions boulangerie | non |

**Notes M8.** Migrations 580-583. Jeu de référence : zéro écart apres-lot10 → apres-m8 → apres-m8b → apres-m8c. Suites : 471 tests unitaires serveur verts ; en base 643 / 644 (seul échec : scénario de vente FEFO dans la fenêtre de minuit).
- **M8-03** : mig 580, clés `sector_labels` des écrans de nomenclature et de l'ordre (repli dans le code = terme boulangerie), hook `useProdTerms` ; libellés hérités du secteur de base. Écran Paramètres › Secteur et modules › Vocabulaire (mig 583 `company_label_overrides`, appliquée après le secteur ; catalogue `shared/constants/vocabulary.ts` ; aperçu en direct ; « Rétablir » = terme du secteur).
- **M8-01** : registre `planPanelRules.ts` (conditions, testées sans navigateur) + `planPanels.tsx` (rendu) pour les quatre onglets de l'ordre. Alertes de l'onglet Ingrédients (disponibilité, aucun besoin calculé) au registre. Fenêtre de lancement : `launchStepRules.ts` (étape « sous-ensembles » seulement avec des bases partagées, navigation qui saute les étapes masquées, rubrique coupe).
- **M8-02** : onglets de la liste sur les libellés partagés ; gardes serveur (machine à états ↔ libellés) et client (libellés ↔ couleurs, tons, ordre).
- **M8-04** : mig 582. `document_templates` gagne `category` ('tiers' | 'production'), `title`, `layout` ; variantes par type d'ordre (`document_template_variants`). Catalogue figé `shared/constants/print-templates.ts` (colonnes, signatures, mentions par défaut). Résolution défaut ← modèle général ← variante, champ par champ. Paramètres › Production › Impressions. Ticket de lot, bon de sortie, fiche de production et fiche technique PDF suivent le gabarit ; la fiche technique prend la raison sociale de la fiche société (plus de nom en dur). Numéros toujours fournis par le serveur.
- **M8-05** : `GET /production/:id/summary` (quantités, rendement moyen et seuil résolu au serveur, pertes, vers frigo, coût par pièce à partir du coût enregistré). En-tête de l'ordre, panneau Rendement et panneau Coûts n'additionnent plus rien. Quantité produite d'une coupe : une formule partagée `cutProducedQuantity` (le serveur recalcule et fait foi, l'aperçu l'emploie). Éditeur de gamme : aperçu de temps et de coût sur une formule partagée `routingOpMinutes`, parité vérifiée en base avec `fn_routing_op_minutes`. Récapitulatif de pointage (Personnel › Pointage) : `GET /attendance/monthly-recap`, même fonction que le bulletin (`monthAttendanceFacts`, extraite de `computeAndSavePayslip`) ; l'écran comptait les doubles 2×, les demi-journées par paires et les lignes prévues, et ignorait congés et fériés — colonne renommée « Salaire au pointage » ; test de parité récapitulatif = bulletin.
- **M8-06** : option `mode_fournee` (boulangerie) ; paramètres de pâte, coupe et rétro-planning réservés ; rôles pâtisserie réservés à la boulangerie (mig 581) ; pâtons et termes de cuisson du bilan massique sous l'option fournée, « vitrine » du calcul des besoins sous l'option vitrine. Darija déjà sous l'option fiche bilingue.

### M9 — Sous-traitance et numéros de série

| ☐ | Tâche | Objet | Change des chiffres |
|---|---|---|---|
| ☑ | M9-01 | Sous-traitance de production | non (façon = 0 hors ordres sous-traités) |
| ☑ | M9-02 | Numéros de série en fabrication | non |
| ☑ | M9-03 | Nomenclature fantôme, désassemblage | non |
| ☑ | M9-04 | Séries au lancement, statut vendu | non |

**Notes M9.** Migrations 584-585, 587-589. Jeu de référence : zéro écart apres-m8c → apres-m9. Suites : 475 tests unitaires et 650 / 650 en base.
- **M9-01** : mig 584. Type d'ordre « sous-traité » (`is_subcontracting` : ni bon de sortie ni pesage, matières consommées à la réception) ; l'ordre porte le sous-traitant et le prix de façon par unité ; bon d'envoi des composants numéroté `BES-AAAA-NNNN` (besoins de l'ordre figés à l'envoi) ; réception = déclaration de production habituelle, refusée tant que les composants ne sont pas envoyés, statut à envoyer → envoyé → reçu ; coût de façon = prix × quantité reçue, `production_cout_reel.cout_sous_traitance` inclus dans `cout_total` (colonne calculée redéfinie, valeurs existantes identiques). Panneau Sous-traitance sur l'ordre, case « Sous-traité » des types d'ordre, ligne Façon des coûts. Restent : facture du sous-traitant (passe par les factures fournisseurs ; les demandes d'achat ne portent que des ingrédients), stock physiquement chez le sous-traitant (pas d'emplacement externe).
- **M9-03** : mig 588 `recipes.is_phantom` (base seulement) : pas de dépendance ni ordre de semi-fini, composants tirés dans l'ordre parent, MRP ne le compte pas ; case dans la fiche. Mig 589 désassemblage : pièces d'un lot (arrière-boutique) défaites, `recycled_qty` (invariant conservé), matières de la nomenclature × récupération remises en lots rattachés (`source_product_lot_id`), pièce DSA, page Production › Désassemblage.
- **M9-04** : mig 587 déclencheurs sur `sale_item_lots` : numéros « vendu » à la vente, remis en stock au retour ou à la suppression ; saisie facultative des numéros dans la fenêtre de lancement.
- **M9-02** : mig 585. `products.tracking_mode` (lot | serial) ; à la déclaration, un numéro par pièce des lots d'un article suivi par série (saisis, puis `numéro de lot-0001…`), quantité entière exigée, dans la transaction de la déclaration ; `GET /production/:id/serials`, `GET /production/serials/lookup`. Champ Traçabilité de la fiche article, panneau Numéros de série de l'ordre. Restent : saisie des numéros dans la fenêtre de lancement (aujourd'hui générés), statut vendu à la vente.

### C — Configuration par industrie

| ☐ | Tâche | Objet | Change des chiffres |
|---|---|---|---|
| ☑ | C-01 | Modèle de configuration étendu | non |
| ☑ | C-02 | « Exportable et livré dans un profil » dans la définition de fini | non |
| ☑ | C-03 | Écran « Profil d'industrie » | non |
| ☑ | C-04 | Bilan de santé enrichi | non |
| ☑ | C-05 | Trois profils de référence | non (données de départ à la demande) |
| ☑ | C-06 | Test d'acceptation par profil | non |
| ☑ | C-07 | Garde « jamais le secteur » | non |
| ☑ | C-08 | Mise en route guidée étendue | non |
| ☑ | C-09 | Aperçu d'impact étendu | non |
| ☑ | C-10 | Guide « Configurer une industrie » | non |

**Notes C.** Migrations 586, 590. Jeu de référence : zéro écart apres-m9 → apres-c. Suites : 477 tests unitaires serveur, 23 client, 654 / 654 en base.
- **C-01** : modèle `kalum.config` version 2 (v1 accepté) avec les couches production (`services/industry-profile.ts`) : types d'ordre, politiques société, gabarits d'impression ; import filtré (codes, règles bon de sortie / sous-traitance, politiques validées par le catalogue, colonnes du catalogue) ; `sector_packs.profile`, appliqué par « Charger les données de départ » sans rien écraser. Restent les couches unités, gammes types, emplacements, plans de contrôle, panneaux.
- **C-05** : mig 586, profils `process`, `discret`, `atelier` bâtis sur Fabrication (modules, options, vocabulaire neutre hérités ; données de départ de Fabrication) avec types d'ordre, politiques, impressions et vocabulaire propres selon la matrice 2 ter.5. Valeurs proposées, à relire avec une personne du métier.
- **C-03** : la confirmation de bascule montre ce que le profil apporte ; aperçu des données de départ de n'importe quel profil. Restent les tuiles par couche et l'indicateur d'avancement.
- **C-04** : contrôles type d'ordre ↔ modules masqués, sous-traitance sans fournisseur, étapes « par gamme » sans gamme, termes de boulangerie affichés hors boulangerie. Complété (sans migration) par des contrôles avec gravité (bloquant / avertissement), compteur et liste des éléments en cause (200 au plus, lien vers la fiche), requêtes dans `repositories/config-health.repository.ts` : type d'ordre sans série de numérotation (bloquant) ou sans atelier actif (avertissement) ; étape exigée par un type d'ordre dont le module est masqué, sous-traitance → Achats ajoutée (bloquant) ; article dont l'unité de fabrication ne se convertit pas en unité de stock, d'après `v_impossible_unit_conversions_v2` (bloquant) ; nomenclature sans version active ; gamme sans opération ou opération sans poste actif ; poste sans calendrier ; contrôle bloquant au plan de contrôle sans utilisateur actif détenant le droit « inspections qualité » (même règle que `hasPermission`, bloquant, module Contrôle). Test `config-health-coherence.db.test.ts`.
- **C-06** : test en base : aucun terme ni option de boulangerie dans les profils livrés, couches valides, un type par défaut. Restent le déroulé complet d'un ordre par profil et le test d'écran.
- **C-07** : `never-sector-guard.test.ts`, aucune exception.
- **C-10** : `docs/GUIDE_CONFIGURATION_INDUSTRIE.md`.
- **C-01 (fin)** : mig 590, couches postes de charge (par nom) et emplacements types (par établissement) exportées, filtrées, appliquées sans écraser ; profils de référence complétés. Non exportables : gammes (rattachées à un article) et plans de contrôle (contrainte chk_qcp_target : article, matière ou catégorie de la société).
- **Écrans de fabrication** : mig 591 `production_screen_hidden`, catalogue `shared/constants/production-screens.ts` (17 éléments, règle en clair, 5 verrouillés avec leur raison) ; Production › Paramétrage › Écrans : masquer un panneau de l'ordre ou une étape du lancement pour la société ou un type d'ordre, appliqué par-dessus le registre (`visiblePanels`, `visibleLaunchSteps`) ; test qui exige que tout panneau du registre figure au catalogue. Masquer seulement (forcer l'affichage d'un panneau sans données le laisserait vide).
- **G6-06 devise (partie client)** : les ≈ 930 « DH » / « MAD » du client passent par `money()` / `currencySymbol()` (utils/money.ts, devise de base de la table currencies) ; un code ISO de logique passe par `BASE_CURRENCY` ; `fmtMoney` replie sur `currencySymbol()`. Garde `no-hardcoded-currency.test.ts` étendue à tout `client/src`, seule exception la définition de `BASE_CURRENCY`. Effet visible : format français partout, « — » au lieu de « NaN DH » / « 0,00 DH » pour un montant absent. Côté serveur (mig 592) : `fn_base_currency()` en SQL, `currencySymbol()` / `baseCurrencyCode()` synchrones dans `services/currency.ts` (chargés au démarrage, repli dirham), symbole seul dans les PDF et le ticket thermique (leurs polices n'ont pas l'espace fine insécable), catalogue des paramètres en « ¤ » remplacé au service (`withCurrency`) ; garde `currency-hardcoded-guard.test.ts` (scripts de reprise exclus, 2 exceptions justifiées). Reste : pack pays (fiscalité, paie).
- **C-02** : `profile-coverage.db.test.ts` — chaque politique de production société a une valeur dans un profil de référence ou une exception justifiée ; règle écrite dans le guide.
- **Suite (2026-11-18)** : C-08 tâches de mise en route (types d'ordre, politiques, gamme hors option fournée, plan de contrôle) ; C-03 tuiles par couche avec état et avancement (`GET /settings/profile-status`, panneau en tête de l'onglet Secteur) ; C-09 `production-impact.repository.ts` (ordres touchés par un type d'ordre ou une politique ; étapes d'un type verrouillées et refusées au serveur tant que des ordres sont en cours ; niveau « type d'ordre » rangé sous le code) ; C-06 déroulé d'un ordre par profil (`industry-profile-flow.db.test.ts`). Fix : le chargement des données de départ vide le cache des politiques qu'il écrit.

### Lots suivants

| ☐ | Lot | Tâches |
|---|---|---|
| ☐ | G1 | G1-01 à G1-12 |
| ☐ | M1 | M1-01 à M1-04 |
| ☐ | G2 | G2-01 à G2-10 |
| ☐ | G3 | G3-01 à G3-11 |
| ☐ | G4 | G4-01 à G4-03 |
| ☑ | M2 | M2-01 à M2-08 |
| ◐ | G5 | G5-01 à G5-06 |
| ◐ | M3 | M3-01 à M3-06 |
| ◐ | M4 | M4-01 à M4-07 |
| ◐ | M5 | M5-01 à M5-05 |
| ◐ | M6 | M6-01 à M6-04 |
| ☑ | M7 | M7-01 à M7-05 |
| ◐ | G6 | G6-01 à G6-08 |
| ☑ | M8 | M8-01 à M8-06 |
| ☑ | M9 | Sous-traitance, numéros de série, fantôme, désassemblage |
| ☑ | C | C-01 à C-10 |

### Jalons d'ouverture par industrie

| ☐ | Jalon | Industrie ouverte |
|---|---|---|
| ☐ | J0 | Boulangerie fiabilisée |
| ☐ | J1 | Fabricant simple (types d'ordre, règles, droits) |
| ☐ | J2 | Atelier à la commande |
| ☐ | J3 | Process |
| ☐ | J4 | Discret sur stock |
| ☐ | J5 | Profils livrés, écrans entièrement pilotés |

### Décisions à obtenir avant de commencer

| Décision | Qui | Bloque |
|---|---|---|
| Régime de TVA : débits ou encaissements | Expert-comptable | G0-16 |
| Règle de prorata du dégressif et traitement des dotations passées | Expert-comptable | G0-15 |
| Valeurs du SMIG et barème IR de l'exercice | Comptable de paie | G0-11, G0-13 |
| Contenu obligatoire de l'étiquette | Référent qualité | G2-09 |
| Accord sur chaque rattrapage chiffré (paie, emballages, immobilisations) | Gérant | G0-09, G0-15, G0-22 |
| Industrie visée en premier | Direction | ordre de M4 à M7 |
| Outil de suivi des erreurs et budget du staging | Direction | G3-01, G3-03 |
